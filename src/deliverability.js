import { Resolver } from 'node:dns/promises';
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

export async function lookupMx(domain, { timeoutMs = 4000 } = {}) {
  const d = String(domain || '').toLowerCase();
  if (!d) return { mx: [], error: 'empty domain' };
  try {
    const recs = await Promise.race([
      resolver.resolveMx(d),
      new Promise((_, rej) => setTimeout(() => rej(new Error('MX timeout')), timeoutMs)),
    ]);
    const mx = (recs || [])
      .sort((a, b) => a.priority - b.priority)
      .map((r) => String(r.exchange || '').replace(/\.$/, '').toLowerCase())
      .filter(Boolean);
    return { mx, error: '' };
  } catch (e) {
    const code = e.code || e.message || String(e);
    if (code === 'ENOTFOUND' || code === 'ENODATA' || /queryMx ENODATA|ENOTFOUND/i.test(String(code))) {
      return { mx: [], error: 'no_mx' };
    }
    return { mx: [], error: String(code) };
  }
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

export async function debounceEmails(text, { lookup, max = 400 } = {}) {
  const emails = parseEmailList(text).slice(0, max);
  const locals = emails.map(inspectLocal);
  const domains = [...new Set(locals.filter((r) => r.verdict !== 'invalid').map((r) => r.domain))];
  const mxByDomain = {};
  const getMx = lookup || lookupMx;
  await mapPool(domains, 8, async (domain) => {
    const rec = await getMx(domain);
    mxByDomain[domain] = rec;
  });

  const results = locals.map((r) => {
    if (r.verdict === 'invalid') {
      return { ...r, provider: 'invalid', label: 'Invalid', kind: 'none', mx: [], mx_error: '' };
    }
    const rec = mxByDomain[r.domain] || { mx: [], error: '' };
    const cls = classifyMx(r.domain, rec.mx);
    let verdict = r.verdict;
    let reason = r.reason;
    let provider = cls.provider;
    let label = cls.label;
    let kind = cls.kind;
    if (r.flags.includes('disposable')) {
      provider = 'disposable';
      label = 'Disposable';
      kind = 'none';
      verdict = 'drop';
      reason = 'Disposable address';
    } else if (!rec.mx.length) {
      verdict = 'drop';
      reason = r.suggestion
        ? `No MX — possible typo of ${r.suggestion}`
        : rec.error === 'MX timeout'
          ? 'MX lookup timed out'
          : 'No MX record — will bounce';
      if (provider !== 'no_mx') {
        provider = 'no_mx';
        label = 'No MX';
        kind = 'none';
      }
    }
    return {
      ...r,
      verdict,
      reason,
      keep: verdict === 'ok' || verdict === 'risky',
      provider,
      label,
      kind,
      mx: rec.mx,
      mx_error: rec.error || '',
    };
  });

  const groups = {};
  for (const r of results) {
    const key = r.provider || 'other';
    if (!groups[key]) {
      groups[key] = { id: key, label: r.label || key, kind: r.kind || 'none', emails: [], keep: 0, drop: 0 };
    }
    groups[key].emails.push(r.email);
    if (r.keep) groups[key].keep++;
    else groups[key].drop++;
  }

  const summary = {
    total: results.length,
    keep: results.filter((r) => r.keep).length,
    drop: results.filter((r) => !r.keep).length,
    risky: results.filter((r) => r.verdict === 'risky').length,
    providers: Object.keys(groups).length,
  };

  const sorted = Object.values(groups).sort((a, b) => b.emails.length - a.emails.length);
  return { results, groups: sorted, summary };
}

export { ROLE, DISPOSABLE, TYPOS, FREE_WEBMAIL, ISP_DOMAINS };
