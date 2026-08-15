import { Resolver } from 'node:dns/promises';
import net from 'node:net';
import { parseLeads, isEmail } from './leads.js';

const resolver = new Resolver();
resolver.setServers(resolver.getServers());

const ROLE = new Set([
  'admin', 'administrator', 'abuse', 'postmaster', 'webmaster', 'hostmaster',
  'noreply', 'no-reply', 'donotreply', 'do-not-reply', 'mailer-daemon',
  'root', 'spam', 'support', 'sales', 'info', 'contact', 'hello', 'office',
  'enquiries', 'inquiry', 'privacy', 'legal', 'compliance', 'security',
]);

const DISPOSABLE = new Set([
  'mailinator.com', 'guerrillamail.com', 'guerrillamail.net', 'sharklasers.com',
  'grr.la', 'yopmail.com', 'yopmail.fr', 'tempmail.com', 'temp-mail.org',
  '10minutemail.com', '10minutemail.net', 'throwawaymail.com', 'trashmail.com',
  'getnada.com', 'nada.ltd', 'discard.email', 'mailnesia.com', 'maildrop.cc',
  'moakt.com', 'tempail.com', 'fakeinbox.com', 'emailondeck.com',
  'dispostable.com', 'mailcatch.com', 'mytemp.email', 'tmpmail.org',
]);

const TYPOS = {
  'gmial.com': 'gmail.com',
  'gmai.com': 'gmail.com',
  'gmal.com': 'gmail.com',
  'gmail.co': 'gmail.com',
  'gnail.com': 'gmail.com',
  'googlemail.co': 'googlemail.com',
  'hotmial.com': 'hotmail.com',
  'hotmal.com': 'hotmail.com',
  'outlok.com': 'outlook.com',
  'outloo.com': 'outlook.com',
  'yahooo.com': 'yahoo.com',
  'yaho.com': 'yahoo.com',
  'iclod.com': 'icloud.com',
  'protonmail.co': 'protonmail.com',
};

const FREE_WEBMAIL = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com',
  'yahoo.com', 'yahoo.co.uk', 'yahoo.co.jp', 'ymail.com', 'aol.com',
  'icloud.com', 'me.com', 'mac.com', 'proton.me', 'protonmail.com',
  'zoho.com', 'gmx.com', 'gmx.net', 'web.de', 'mail.com',
]);

const ISP_DOMAINS = {
  'comcast.net': 'Comcast',
  'att.net': 'AT&T',
  'sbcglobal.net': 'AT&T',
  'bellsouth.net': 'AT&T',
  'verizon.net': 'Verizon',
  'cox.net': 'Cox',
  'charter.net': 'Spectrum',
  'spectrum.net': 'Spectrum',
  'shaw.ca': 'Shaw',
  'bell.net': 'Bell',
  'rogers.com': 'Rogers',
  'btinternet.com': 'BT',
  'virginmedia.com': 'Virgin Media',
  'sky.com': 'Sky',
  'orange.fr': 'Orange',
  'wanadoo.fr': 'Orange',
  'free.fr': 'Free',
  'sfr.fr': 'SFR',
  't-online.de': 'Deutsche Telekom',
  'libero.it': 'Libero',
  'virgilio.it': 'Virgilio',
  'biglobe.ne.jp': 'Biglobe',
  'ocn.ne.jp': 'OCN',
  'ezweb.ne.jp': 'au / KDDI',
  'docomo.ne.jp': 'NTT Docomo',
  'i.softbank.jp': 'SoftBank',
};

const MX_RULES = [
  { id: 'gmail', label: 'Gmail', kind: 'free_webmail', re: /aspmx\.l\.google|gmail-smtp|googlemail\.com/i },
  { id: 'google_workspace', label: 'Google Workspace', kind: 'workspace', re: /google\.com|googlemail\.com|aspmx/i },
  { id: 'microsoft365', label: 'Microsoft 365', kind: 'workspace', re: /protection\.outlook\.com|outlook\.com|microsoft\.com|office365/i },
  { id: 'yahoo', label: 'Yahoo', kind: 'free_webmail', re: /yahoodns\.net|yahoo\.com|yahoomx/i },
  { id: 'apple', label: 'Apple iCloud', kind: 'free_webmail', re: /icloud\.com|apple\.com|me\.com/i },
  { id: 'proton', label: 'Proton', kind: 'free_webmail', re: /protonmail|proton\.me/i },
  { id: 'zoho', label: 'Zoho', kind: 'workspace', re: /zoho\.com|zoho\.eu/i },
  { id: 'ovh', label: 'OVH', kind: 'workspace', re: /ovh\.net|ovh\.com/i },
  { id: 'proofpoint', label: 'Proofpoint', kind: 'filtering_mx', re: /pphosted\.com|proofpoint/i },
  { id: 'mimecast', label: 'Mimecast', kind: 'filtering_mx', re: /mimecast/i },
  { id: 'barracuda', label: 'Barracuda', kind: 'filtering_mx', re: /barracuda/i },
  { id: 'godaddy', label: 'GoDaddy', kind: 'workspace', re: /secureserver\.net|godaddy/i },
  { id: 'amazon', label: 'Amazon SES / WorkMail', kind: 'workspace', re: /amazonaws\.com|amail\.com|inbound-smtp/i },
  { id: 'fastmail', label: 'Fastmail', kind: 'free_webmail', re: /fastmail|messagingengine/i },
  { id: 'yandex', label: 'Yandex', kind: 'free_webmail', re: /yandex/i },
  { id: 'mailru', label: 'Mail.ru', kind: 'free_webmail', re: /mail\.ru/i },
];

export function splitEmail(addr) {
  const s = String(addr || '').trim().toLowerCase();
  const i = s.lastIndexOf('@');
  if (i < 1) return { local: '', domain: '', email: s };
  return { local: s.slice(0, i), domain: s.slice(i + 1), email: s };
}

export function syntaxOk(email) {
  if (!isEmail(email)) return false;
  const { local, domain } = splitEmail(email);
  if (!local || !domain) return false;
  if (local.startsWith('.') || local.endsWith('.') || local.includes('..')) return false;
  if (domain.startsWith('-') || !domain.includes('.')) return false;
  return true;
}

export function inspectLocal(email) {
  const { local, domain, email: addr } = splitEmail(email);
  const flags = [];
  let verdict = 'ok';
  let suggestion = '';

  if (!syntaxOk(addr)) {
    return {
      email: addr,
      local,
      domain,
      verdict: 'invalid',
      reason: 'Bad syntax',
      flags: ['syntax'],
      suggestion: '',
      keep: false,
    };
  }
  if (DISPOSABLE.has(domain)) {
    flags.push('disposable');
    verdict = 'drop';
  }
  if (ROLE.has(local)) {
    flags.push('role');
    if (verdict === 'ok') verdict = 'risky';
  }
  if (TYPOS[domain]) {
    flags.push('typo');
    suggestion = `${local}@${TYPOS[domain]}`;
    verdict = 'risky';
  }
  if (FREE_WEBMAIL.has(domain)) flags.push('free_webmail');
  if (ISP_DOMAINS[domain]) flags.push('isp');

  return {
    email: addr,
    local,
    domain,
    verdict,
    reason: flags.includes('disposable')
      ? 'Disposable address'
      : flags.includes('typo')
        ? `Possible typo of ${TYPOS[domain]}`
        : flags.includes('role')
          ? 'Role account'
          : '',
    flags,
    suggestion,
    keep: verdict !== 'invalid' && verdict !== 'drop',
  };
}

export function classifyMx(domain, mxHosts = []) {
  const hosts = mxHosts.map((h) => String(h || '').toLowerCase());
  const joined = hosts.join(' ');
  const d = String(domain || '').toLowerCase();

  if (ISP_DOMAINS[d]) {
    return { provider: slug(ISP_DOMAINS[d]), label: ISP_DOMAINS[d], kind: 'isp', mx: hosts };
  }
  if (d === 'gmail.com' || d === 'googlemail.com') {
    return { provider: 'gmail', label: 'Gmail', kind: 'free_webmail', mx: hosts };
  }
  if (['outlook.com', 'hotmail.com', 'live.com', 'msn.com'].includes(d)) {
    return { provider: 'microsoft365', label: 'Microsoft consumer', kind: 'free_webmail', mx: hosts };
  }
  if (d.endsWith('yahoo.com') || d.endsWith('yahoo.co.jp') || d.endsWith('ymail.com')) {
    return { provider: 'yahoo', label: d.includes('.co.jp') ? 'Yahoo Japan' : 'Yahoo', kind: 'free_webmail', mx: hosts };
  }

  for (const rule of MX_RULES) {
    if (rule.id === 'gmail') continue;
    if (rule.re.test(joined)) {
      if (rule.id === 'google_workspace' && (d === 'gmail.com' || d === 'googlemail.com')) continue;
      return { provider: rule.id, label: rule.label, kind: rule.kind, mx: hosts };
    }
  }

  if (!hosts.length) {
    return { provider: 'no_mx', label: 'No MX', kind: 'none', mx: [] };
  }

  const mx0 = hosts[0] || '';
  const ispGuess = mx0.split('.').slice(-2).join('.');
  return {
    provider: 'other',
    label: `Other (${ispGuess || 'MX'})`,
    kind: 'workspace',
    mx: hosts,
  };
}

function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

function withTimeout(promise, timeoutMs, label) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error(label || 'timeout')), timeoutMs)),
  ]);
}

export function isRoutableIp(ip) {
  const kind = net.isIP(ip);
  if (kind === 4) {
    const p = String(ip).split('.').map((n) => parseInt(n, 10));
    if (p.length !== 4 || p.some((n) => Number.isNaN(n))) return false;
    if (p[0] === 0 || p[0] === 10 || p[0] === 127 || p[0] >= 224) return false;
    if (p[0] === 169 && p[1] === 254) return false;
    if (p[0] === 192 && p[1] === 168) return false;
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return false;
    return true;
  }
  if (kind === 6) {
    const s = String(ip).toLowerCase();
    if (s === '::1' || s === '::') return false;
    if (s.startsWith('fe80:') || s.startsWith('fc') || s.startsWith('fd')) return false;
    if (s.startsWith('::ffff:')) return isRoutableIp(s.slice(7));
    return true;
  }
  return false;
}

export async function lookupMx(domain, { timeoutMs = 8000 } = {}) {
  const d = String(domain || '').toLowerCase();
  if (!d) return { mx: [], records: [], null_mx: false, error: 'empty domain' };
  try {
    const recs = await withTimeout(resolver.resolveMx(d), timeoutMs, 'MX timeout');
    const records = (recs || [])
      .sort((a, b) => a.priority - b.priority)
      .map((r) => ({
        exchange: String(r.exchange || '').replace(/\.$/, '').toLowerCase(),
        priority: r.priority,
      }));
    const nullMx = records.length === 1 && (records[0].exchange === '' || records[0].exchange === '.');
    const mx = nullMx ? [] : records.map((r) => r.exchange).filter(Boolean);
    return { mx, records: nullMx ? records : records.filter((r) => r.exchange), null_mx: nullMx, error: nullMx ? 'null_mx' : '' };
  } catch (e) {
    const code = e.code || e.message || String(e);
    if (code === 'ENOTFOUND' || code === 'ENODATA' || /queryMx ENODATA|ENOTFOUND/i.test(String(code))) {
      return { mx: [], records: [], null_mx: false, error: 'no_mx' };
    }
    return { mx: [], records: [], null_mx: false, error: String(code) };
  }
}

export async function lookupIps(host, { timeoutMs = 5000 } = {}) {
  const h = String(host || '').replace(/\.$/, '').toLowerCase();
  if (!h) return [];
  try {
    const [v4, v6] = await withTimeout(
      Promise.all([resolver.resolve4(h).catch(() => []), resolver.resolve6(h).catch(() => [])]),
      timeoutMs,
      'IP timeout'
    );
    return [...new Set([...(v4 || []), ...(v6 || [])])];
  } catch {
    return [];
  }
}

export function probeSmtpBanner(host, { port = 25, timeoutMs = 3000 } = {}) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    let buf = '';
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      try {
        socket.write('QUIT\r\n');
      } catch {
        /* closed */
      }
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs);
    socket.on('timeout', () => finish({ ok: false, error: 'timeout', host, port, refused: false }));
    socket.on('error', (err) => {
      const code = err.code || err.message || String(err);
      finish({
        ok: false,
        error: String(code),
        host,
        port,
        refused: code === 'ECONNREFUSED' || code === 'EHOSTUNREACH' || code === 'ENETUNREACH',
      });
    });
    socket.on('data', (chunk) => {
      buf += chunk.toString('ascii');
      const line = (buf.split(/\r?\n/).find((l) => l.trim()) || '').trim();
      if (/^\d{3}\b/.test(line)) {
        const ok = /^220\b/.test(line);
        finish({ ok, banner: line.slice(0, 180), host, port, error: ok ? '' : line.slice(0, 80), refused: false });
      }
    });
  });
}

export function normalizeMxRecord(rec) {
  if (!rec || typeof rec !== 'object') {
    return {
      mx: [],
      records: [],
      error: 'empty',
      deliverable: false,
      null_mx: false,
      implicit: false,
      smtp: null,
      mx_live: false,
    };
  }
  const mx = Array.isArray(rec.mx) ? rec.mx.map((h) => String(h || '').toLowerCase()).filter(Boolean) : [];
  const smtp = rec.smtp || null;
  const timeout = rec.error === 'MX timeout' || rec.error === 'timeout';
  const deliverable = rec.deliverable !== undefined ? !!rec.deliverable : mx.length > 0 && !rec.null_mx && !timeout;
  return {
    mx,
    records: rec.records || mx.map((exchange, i) => ({ exchange, priority: i, ips: rec.ips || [] })),
    error: rec.error || '',
    null_mx: !!rec.null_mx,
    implicit: !!rec.implicit,
    smtp,
    deliverable,
    mx_live: rec.mx_live !== undefined ? !!rec.mx_live : !!(smtp && smtp.ok),
  };
}

export async function inspectMailDomain(domain, { probe = true, lookupMxFn = lookupMx, lookupIpsFn = lookupIps, probeFn = probeSmtpBanner } = {}) {
  const d = String(domain || '').toLowerCase();
  const dns = await lookupMxFn(d);
  if (dns.null_mx) {
    return {
      mx: [],
      records: dns.records || [],
      error: 'null_mx',
      null_mx: true,
      implicit: false,
      smtp: null,
      deliverable: false,
      mx_live: false,
    };
  }
  if (dns.error === 'MX timeout') {
    return {
      mx: [],
      records: [],
      error: 'MX timeout',
      null_mx: false,
      implicit: false,
      smtp: null,
      deliverable: false,
      mx_live: false,
    };
  }

  let records = (dns.records || []).filter((r) => r.exchange && r.exchange !== '.');
  let implicit = false;
  if (!records.length) {
    const ips = (await lookupIpsFn(d)).filter(isRoutableIp);
    if (ips.length) {
      implicit = true;
      records = [{ exchange: d, priority: 0, ips }];
    } else {
      return {
        mx: [],
        records: [],
        error: dns.error || 'no_mx',
        null_mx: false,
        implicit: false,
        smtp: null,
        deliverable: false,
        mx_live: false,
      };
    }
  } else {
    for (const rec of records) {
      rec.ips = ((await lookupIpsFn(rec.exchange)) || []).filter(isRoutableIp);
    }
    const withIps = records.filter((r) => r.ips.length);
    if (!withIps.length) {
      return {
        mx: records.map((r) => r.exchange),
        records,
        error: 'mx_host_dead',
        null_mx: false,
        implicit: false,
        smtp: null,
        deliverable: false,
        mx_live: false,
      };
    }
  }

  let smtp = null;
  if (probe) {
    const hosts = (records.filter((r) => r.ips?.length).concat(records)).filter(
      (r, i, arr) => arr.findIndex((x) => x.exchange === r.exchange) === i
    );
    for (const rec of hosts.slice(0, 3)) {
      smtp = await probeFn(rec.exchange);
      if (smtp?.ok) break;
      // Timeouts usually mean outbound port 25 is filtered — don't burn 3 hosts.
      if (!smtp?.refused) break;
    }
  }

  const mx = records.map((r) => r.exchange);
  return {
    mx,
    records,
    error: implicit ? 'implicit_mx' : '',
    null_mx: false,
    implicit,
    smtp,
    deliverable: true,
    mx_live: !!(smtp && smtp.ok),
  };
}

export function applyMxToLocal(local, rec) {
  if (local.verdict === 'invalid') {
    return {
      ...local,
      provider: 'invalid',
      label: 'Invalid',
      kind: 'none',
      mx: [],
      mx_error: '',
      deliverable: false,
      mx_live: false,
      implicit: false,
    };
  }
  const mx = normalizeMxRecord(rec);
  const cls = classifyMx(local.domain, mx.mx);
  let verdict = local.verdict;
  let reason = local.reason;
  let provider = cls.provider;
  let label = cls.label;
  let kind = cls.kind;
  let deliverable = mx.deliverable;
  let keep = true;

  if (local.flags.includes('disposable')) {
    provider = 'disposable';
    label = 'Disposable';
    kind = 'none';
    verdict = 'drop';
    reason = 'Disposable address';
    deliverable = false;
    keep = false;
  } else if (mx.null_mx) {
    verdict = 'undeliverable';
    reason = 'Null MX — this domain refuses mail';
    provider = 'no_mx';
    label = 'Null MX';
    kind = 'none';
    deliverable = false;
    keep = false;
  } else if (mx.error === 'MX timeout') {
    verdict = 'unknown';
    reason = 'MX lookup timed out — run again';
    provider = 'timeout';
    label = 'MX timeout';
    kind = 'none';
    deliverable = false;
    keep = false;
  } else if (!mx.mx.length || mx.error === 'no_mx' || mx.error === 'mx_host_dead') {
    verdict = 'undeliverable';
    reason = local.suggestion
      ? `No live MX — possible typo of ${local.suggestion}`
      : mx.error === 'mx_host_dead'
        ? 'MX hosts do not resolve on the public internet'
        : 'No MX record — will bounce';
    provider = 'no_mx';
    label = mx.error === 'mx_host_dead' ? 'Dead MX' : 'No MX';
    kind = 'none';
    deliverable = false;
    keep = false;
  } else if (mx.implicit) {
    if (verdict === 'ok') verdict = 'risky';
    reason = reason || 'No MX; mail would use the domain A record (legacy, often bounces)';
  } else if (mx.mx_live) {
    reason = reason || 'MX live (SMTP 220)';
  } else if (mx.smtp && mx.smtp.refused && !mx.mx_live) {
    if (verdict === 'ok') verdict = 'risky';
    reason = reason || 'MX found but SMTP banner refused — domain may still accept mail';
  } else if (mx.smtp && mx.smtp.error === 'timeout') {
    reason = reason || 'MX found; SMTP probe timed out (port 25 is often blocked from cloud hosts)';
  } else {
    reason = reason || 'MX found — domain can receive mail';
  }

  keep = verdict === 'ok' || verdict === 'risky';
  return {
    ...local,
    verdict,
    reason,
    keep,
    deliverable,
    mx_live: mx.mx_live,
    implicit: mx.implicit,
    provider,
    label,
    kind,
    mx: mx.mx,
    mx_records: mx.records,
    mx_error: mx.error || '',
    smtp: mx.smtp,
  };
}

export function parseEmailList(text) {
  const fromLeads = parseLeads(text);
  const extra = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = line.match(/[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}/gi) || [];
    extra.push(...m);
  }
  const seen = new Set();
  const emails = [];
  for (const e of [...fromLeads.leads.map((l) => l.email), ...extra.map((x) => x.toLowerCase())]) {
    if (!e || seen.has(e)) continue;
    seen.add(e);
    emails.push(e);
  }
  return emails;
}

function mapPool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  }
  const n = Math.min(limit, items.length) || 1;
  return Promise.all(Array.from({ length: n }, worker)).then(() => out);
}

export async function debounceEmails(text, { lookup, max = 500, probe = true, inspect, onDomain } = {}) {
  const emails = (
    Array.isArray(text)
      ? [...new Set(text.map((e) => String(e || '').toLowerCase().trim()).filter(Boolean))]
      : parseEmailList(text)
  ).slice(0, max);
  const locals = emails.map(inspectLocal);
  const domains = [...new Set(locals.filter((r) => r.verdict !== 'invalid').map((r) => r.domain))];
  const mxByDomain = {};
  const inspectFn =
    inspect ||
    (async (domain) => {
      if (lookup) return normalizeMxRecord(await lookup(domain));
      return inspectMailDomain(domain, { probe });
    });
  await mapPool(domains, 3, async (domain) => {
    const rec = await inspectFn(domain);
    mxByDomain[domain] = rec;
    if (onDomain) onDomain(domain, rec);
  });

  const results = locals.map((r) => applyMxToLocal(r, mxByDomain[r.domain]));

  const groups = {};
  for (const r of results) {
    const key = r.provider || 'other';
    if (!groups[key]) {
      groups[key] = { id: key, label: r.label || key, kind: r.kind || 'none', emails: [], keep: 0, drop: 0, deliverable: 0 };
    }
    groups[key].emails.push(r.email);
    if (r.keep) groups[key].keep++;
    else groups[key].drop++;
    if (r.deliverable) groups[key].deliverable++;
  }

  const summary = {
    total: results.length,
    keep: results.filter((r) => r.keep).length,
    drop: results.filter((r) => !r.keep).length,
    risky: results.filter((r) => r.verdict === 'risky').length,
    deliverable: results.filter((r) => r.deliverable).length,
    undeliverable: results.filter((r) => r.verdict === 'undeliverable' || r.verdict === 'drop' || r.verdict === 'invalid').length,
    mx_live: results.filter((r) => r.mx_live).length,
    unknown: results.filter((r) => r.verdict === 'unknown').length,
    providers: Object.keys(groups).length,
    domains: domains.length,
  };

  const sorted = Object.values(groups).sort((a, b) => b.emails.length - a.emails.length);
  return { results, groups: sorted, summary };
}

export { ROLE, DISPOSABLE, TYPOS, FREE_WEBMAIL, ISP_DOMAINS };
