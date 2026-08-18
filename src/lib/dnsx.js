import dns from 'dns/promises';
import net from 'net';

const DEFAULT_TIMEOUT = 6000;

// dns/promises has no per-query timeout, so races are used instead.
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('DNS timeout')), ms)),
  ]);
}

// Errors that are a real answer ("this name has no such record") rather than a
// failure to get one. Anything else means the resolver could not be reached and
// is worth retrying elsewhere.
const ANSWERED = new Set(['ENODATA', 'ENOTFOUND', 'NXDOMAIN']);

// Some hosts run a resolver that refuses TCP, which breaks any response too big
// for a UDP packet — exactly the case for domains with many TXT records, which
// is where SPF lives. Rather than silently reporting "no SPF record" on those
// hosts, fall back to DNS-over-HTTPS.
//
// This is only used for ordinary lookups. Blocklist zones are never queried
// this way: they refuse queries arriving via public resolvers, and a refusal
// misread as "not listed" would be worse than no answer at all.
const DOH_ENDPOINTS = ['https://cloudflare-dns.com/dns-query', 'https://dns.google/resolve'];
let dohDisabled = false;

async function dohQuery(name, type, timeout) {
  if (dohDisabled) return null;
  for (const endpoint of DOH_ENDPOINTS) {
    try {
      const res = await fetch(`${endpoint}?name=${encodeURIComponent(name)}&type=${type}`, {
        headers: { accept: 'application/dns-json' },
        signal: AbortSignal.timeout(timeout),
      });
      if (!res.ok) continue;
      const data = await res.json();
      // NXDOMAIN (3) and NOERROR-with-no-answer are both real answers.
      if (data.Status === 3) return [];
      if (data.Status !== 0) continue;
      return (data.Answer || [])
        .filter((a) => a.type === { A: 1, NS: 2, CNAME: 5, PTR: 12, MX: 15, TXT: 16, AAAA: 28 }[type])
        .map((a) => a.data);
    } catch {
      // Try the next endpoint.
    }
  }
  return null;
}

async function lookup(name, type, timeout, systemFn, parseDoh) {
  try {
    return await withTimeout(systemFn(), timeout);
  } catch (err) {
    if (ANSWERED.has(err?.code)) return [];
    const viaDoh = await dohQuery(name, type, timeout);
    if (viaDoh === null) return [];
    return parseDoh(viaDoh);
  }
}

export const isIp = (v) => net.isIP(String(v)) !== 0;

/** Turn off the DNS-over-HTTPS fallback (for offline or air-gapped use). */
export function setDohEnabled(enabled) {
  dohDisabled = !enabled;
}

export async function resolveMx(domain, timeout = DEFAULT_TIMEOUT) {
  const records = await lookup(domain, 'MX', timeout,
    () => dns.resolveMx(domain),
    (answers) => answers.map((a) => {
      const [priority, exchange] = String(a).trim().split(/\s+/);
      return { exchange, priority: parseInt(priority, 10) || 0 };
    }));

  return records
    .filter((r) => r.exchange)
    .sort((a, b) => a.priority - b.priority)
    .map((r) => ({ host: String(r.exchange).replace(/\.$/, '').toLowerCase(), priority: r.priority }));
}

export async function resolveTxt(domain, timeout = DEFAULT_TIMEOUT) {
  // TXT records arrive as arrays of <=255-byte chunks that must be concatenated.
  return lookup(domain, 'TXT', timeout,
    async () => (await dns.resolveTxt(domain)).map((chunks) => chunks.join('')),
    (answers) => answers.map((a) => String(a).replace(/^"|"$/g, '').replace(/"\s+"/g, '')));
}

export async function resolveA(host, timeout = DEFAULT_TIMEOUT) {
  const [v4, v6] = await Promise.all([
    lookup(host, 'A', timeout, () => dns.resolve4(host), (a) => a),
    lookup(host, 'AAAA', timeout, () => dns.resolve6(host), (a) => a),
  ]);
  return [...v4, ...v6];
}

export async function reverseDns(ip, timeout = DEFAULT_TIMEOUT) {
  const names = await withTimeout(dns.reverse(ip), timeout).catch(() => []);
  return names.map((n) => n.replace(/\.$/, '').toLowerCase());
}

export async function hasMx(domain) {
  const mx = await resolveMx(domain);
  if (mx.length) return { hasMx: true, mx };
  // A domain with an A record but no MX still accepts mail per RFC 5321 §5.1.
  const a = await resolveA(domain);
  return { hasMx: a.length > 0, mx: a.length ? [{ host: domain, priority: 0, implicit: true }] : [] };
}

// ---- Authentication records -------------------------------------------------

export async function getSpf(domain) {
  const txt = await resolveTxt(domain);
  const records = txt.filter((r) => /^v=spf1\b/i.test(r.trim()));
  if (!records.length) return { found: false, record: null, all: null, lookups: 0, issues: ['No SPF record published.'] };
  const issues = [];
  if (records.length > 1) issues.push('Multiple SPF records found — receivers treat this as a permerror.');
  const record = records[0];
  const all = (record.match(/([-~+?])all\b/i) || [])[1] || null;
  if (all === '+') issues.push('`+all` allows the entire internet to send as your domain.');
  if (!all) issues.push('No `all` mechanism — the policy has no default, which weakens SPF.');
  // Each of these mechanisms costs a DNS lookup; the RFC 7208 limit is 10.
  const lookups = (record.match(/\b(include|a|mx|ptr|exists|redirect)[:=]?/gi) || []).length;
  if (lookups > 10) issues.push(`About ${lookups} DNS-lookup mechanisms — the limit is 10 and exceeding it fails SPF.`);
  if (/\bptr\b/i.test(record)) issues.push('The `ptr` mechanism is deprecated and slow; remove it.');
  return { found: true, record, all, lookups, issues };
}

export async function getDmarc(domain) {
  const txt = await resolveTxt(`_dmarc.${domain}`);
  const record = txt.find((r) => /^v=DMARC1\b/i.test(r.trim()));
  if (!record) {
    return {
      found: false,
      record: null,
      policy: null,
      pct: null,
      rua: null,
      issues: ['No DMARC record. Gmail and Yahoo require one for bulk senders.'],
    };
  }
  const tag = (name) => (record.match(new RegExp(`\\b${name}\\s*=\\s*([^;]+)`, 'i')) || [])[1]?.trim() || null;
  const policy = (tag('p') || '').toLowerCase() || null;
  const pct = tag('pct') ? parseInt(tag('pct'), 10) : 100;
  const issues = [];
  if (!policy) issues.push('DMARC record has no `p=` policy tag.');
  if (policy === 'none') issues.push('Policy is `p=none` (monitor only) — move to quarantine or reject once aligned.');
  if (pct !== null && pct < 100) issues.push(`Only ${pct}% of mail is covered by the policy (pct=${pct}).`);
  if (!tag('rua')) issues.push('No `rua=` aggregate-report address, so you get no DMARC feedback.');
  return { found: true, record, policy, pct, rua: tag('rua'), sp: tag('sp'), adkim: tag('adkim'), aspf: tag('aspf'), issues };
}

// Gmail signs with the selector shown in the DKIM-Signature header. Without the
// header we can only probe well-known selectors.
export const COMMON_DKIM_SELECTORS = [
  'google', 'default', 'selector1', 'selector2', 'k1', 'k2', 'mail', 'dkim',
  's1', 's2', 'smtp', 'mandrill', 'sendgrid', 'zoho', 'protonmail', 'fm1',
];

export async function findDkim(domain, selectors = COMMON_DKIM_SELECTORS) {
  const found = [];
  await Promise.all(
    selectors.map(async (sel) => {
      const txt = await resolveTxt(`${sel}._domainkey.${domain}`, 4000);
      const record = txt.find((r) => /(^|;)\s*(v=DKIM1|k=|p=)/i.test(r));
      if (record) {
        const p = (record.match(/\bp\s*=\s*([^;]*)/i) || [])[1]?.trim() || '';
        found.push({
          selector: sel,
          revoked: p === '',
          // A 1024-bit RSA key base64-encodes to roughly 216 characters.
          weakKey: p.length > 0 && p.length < 250,
        });
      }
    })
  );
  return found;
}

// ---- Blocklists -------------------------------------------------------------

export const IP_BLOCKLISTS = [
  { zone: 'zen.spamhaus.org', name: 'Spamhaus ZEN' },
  { zone: 'bl.spamcop.net', name: 'SpamCop' },
  { zone: 'b.barracudacentral.org', name: 'Barracuda' },
  { zone: 'dnsbl.sorbs.net', name: 'SORBS' },
];

export const DOMAIN_BLOCKLISTS = [
  { zone: 'dbl.spamhaus.org', name: 'Spamhaus DBL' },
  { zone: 'multi.surbl.org', name: 'SURBL' },
  { zone: 'multi.uribl.com', name: 'URIBL' },
];

const reverseIpv4 = (ip) => ip.split('.').reverse().join('.');

// Public DNS resolvers are blocked by Spamhaus and friends, which answer with
// 127.255.255.x instead of a real verdict. Reporting that as "clean" would be
// wrong, so it is surfaced as an unavailable check.
function classify(answers) {
  const codes = answers.filter((a) => a.startsWith('127.'));
  if (!codes.length) return { listed: false, codes: [] };
  const blocked = codes.every((c) => /^127\.255\.255\./.test(c));
  if (blocked) return { listed: false, unavailable: true, codes };
  return { listed: true, codes };
}

// Blocklist zones are queried through the system resolver only — never the
// DoH fallback, because these zones deliberately refuse queries that arrive via
// public resolvers and that refusal must not be mistaken for "not listed".
async function queryZone(query, zone, timeout) {
  try {
    const answers = await withTimeout(dns.resolve4(`${query}.${zone}`), timeout);
    if (!answers.length) return { listed: false, codes: [] };
    return classify(answers);
  } catch (err) {
    // A name that is not in the zone is the normal "clean" answer.
    if (ANSWERED.has(err?.code)) return { listed: false, codes: [] };
    return { unavailable: true, listed: false, codes: [], error: err?.code || String(err.message || err) };
  }
}

export async function checkIpBlocklists(ip, timeout = 5000) {
  if (net.isIPv4(ip) === false) {
    return IP_BLOCKLISTS.map((b) => ({ ...b, listed: false, unsupported: true }));
  }
  const q = reverseIpv4(ip);
  return Promise.all(
    IP_BLOCKLISTS.map(async (b) => ({ ...b, ...(await queryZone(q, b.zone, timeout)) }))
  );
}

export async function checkDomainBlocklists(domain, timeout = 5000) {
  return Promise.all(
    DOMAIN_BLOCKLISTS.map(async (b) => ({ ...b, ...(await queryZone(domain, b.zone, timeout)) }))
  );
}

// ---- Registration data ------------------------------------------------------

// Domain age matters for cold outreach: filters distrust links on domains
// registered days ago. RDAP is the successor to WHOIS and is queryable over
// plain HTTPS.
export async function domainAge(domain) {
  try {
    const res = await fetch(`https://rdap.org/domain/${encodeURIComponent(domain)}`, {
      headers: { accept: 'application/rdap+json' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return { known: false, reason: `RDAP lookup returned ${res.status}` };
    const data = await res.json();
    const event = (data.events || []).find((e) => e.eventAction === 'registration');
    if (!event?.eventDate) return { known: false, reason: 'RDAP record has no registration date' };
    const registered = new Date(event.eventDate);
    const days = Math.floor((Date.now() - registered.getTime()) / 86_400_000);
    return { known: true, registered: registered.toISOString().slice(0, 10), days };
  } catch (err) {
    return { known: false, reason: String(err.message || err) };
  }
}

// Strip a hostname down to its registrable domain. This uses a short list of
// common multi-label suffixes rather than the full Public Suffix List, so it is
// approximate for unusual TLDs.
const MULTI_LABEL_SUFFIXES = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'com.au', 'net.au', 'org.au', 'co.nz',
  'co.jp', 'co.za', 'com.br', 'com.mx', 'com.sg', 'com.hk', 'co.in', 'co.kr',
]);

export function registrableDomain(hostname) {
  const parts = String(hostname || '').toLowerCase().replace(/\.$/, '').split('.');
  if (parts.length <= 2) return parts.join('.');
  const lastTwo = parts.slice(-2).join('.');
  if (MULTI_LABEL_SUFFIXES.has(lastTwo)) return parts.slice(-3).join('.');
  return lastTwo;
}
