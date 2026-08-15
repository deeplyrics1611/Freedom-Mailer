import { customAlphabet } from 'nanoid';
import { config } from './config.js';

const genCode = customAlphabet('abcdefghijkmnopqrstuvwxyz23456789', 8);

export const newLinkCode = () => genCode();

export function shortUrl(code, user) {
  return `${linkBaseFor(user)}/l/${code}`;
}

const RISKY_LINK_TLDS = new Set(['su', 'ru', 'xyz', 'top', 'click', 'rest', 'cfd', 'shop', 'bond', 'zip', 'mov']);

export function linkBaseFor(user) {
  const raw = String(user?.link_base_url || '').trim();
  if (raw) return raw.replace(/\/$/, '');
  return config.appBaseUrl;
}

/** Normalize a client tracking host. Must be https, public DNS, not a brand lookalike. */
export function parseLinkBase(raw) {
  const s = String(raw || '').trim();
  if (!s) return { ok: true, url: '', warnings: [] };
  let u;
  try {
    u = new URL(s.includes('://') ? s : `https://${s}`);
  } catch {
    return { ok: false, error: 'Not a valid URL. Use https://go.yourbrand.com' };
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    return { ok: false, error: 'Only http(s) tracking hosts are allowed' };
  }
  const host = u.hostname.toLowerCase();
  if (!host || host === 'localhost' || isPrivateHost(host) || isIpHost(host)) {
    return { ok: false, error: 'Use a public hostname you own, not localhost or an IP' };
  }
  if (!host.includes('.')) {
    return { ok: false, error: 'Hostname needs a real TLD (example: go.yourbrand.com)' };
  }
  const brand = lookalikeBrand(host);
  if (brand) {
    return { ok: false, error: `That host looks like a ${brand} impersonation. Use the client’s real brand.` };
  }
  if (isReservedBrandHost(host)) {
    return { ok: false, error: 'That host belongs to a major brand. Use a domain the client owns.' };
  }
  if (PUBLIC_SHORTENERS.has(host) || PUBLIC_SHORTENERS.has(registrable(host))) {
    return { ok: false, error: 'Use a hostname the client owns, not a public shortener.' };
  }
  const warnings = [];
  if (u.protocol !== 'https:') warnings.push('Use HTTPS. HTTP tracking links get rewritten or blocked.');
  const tld = host.split('.').pop();
  if (RISKY_LINK_TLDS.has(tld)) {
    warnings.push(`.${tld} is a weak TLD for email clicks. Prefer a subdomain of the client’s sending domain.`);
  }
  const url = `https://${host}`;
  return { ok: true, url, host, warnings };
}

const PRIVATE = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^0\./,
  /^169\.254\./,
  /^::1$/,
  /^fc00:/i,
  /^fe80:/i,
];

const PUBLIC_SHORTENERS = new Set([
  'bit.ly', 't.co', 'tinyurl.com', 'goo.gl', 'ow.ly', 'is.gd', 'buff.ly',
  'rebrand.ly', 'cutt.ly', 'shorturl.at', 'tiny.cc', 'rb.gy', 'lnkd.in',
]);

const BRANDS = [
  { name: 'microsoft', hosts: ['microsoft.com', 'office.com', 'office365.com', 'live.com', 'outlook.com', 'microsoftonline.com'] },
  { name: 'google', hosts: ['google.com', 'gmail.com', 'youtube.com', 'googlemail.com'] },
  { name: 'apple', hosts: ['apple.com', 'icloud.com'] },
  { name: 'paypal', hosts: ['paypal.com', 'paypal.me'] },
  { name: 'amazon', hosts: ['amazon.com', 'amazonaws.com'] },
  { name: 'docusign', hosts: ['docusign.com', 'docusign.net'] },
  { name: 'adobe', hosts: ['adobe.com', 'adobesign.com'] },
  { name: 'zoom', hosts: ['zoom.us', 'zoom.com'] },
  { name: 'dropbox', hosts: ['dropbox.com'] },
  { name: 'facebook', hosts: ['facebook.com', 'fb.com', 'meta.com'] },
  { name: 'linkedin', hosts: ['linkedin.com'] },
  { name: 'bankofamerica', hosts: ['bankofamerica.com'] },
  { name: 'wellsfargo', hosts: ['wellsfargo.com'] },
  { name: 'chase', hosts: ['chase.com'] },
];

const BOT_MARKERS = [
  'googlebot', 'bingbot', 'slurp', 'duckduckbot', 'baiduspider',
  'facebookexternalhit', 'twitterbot', 'linkedinbot', 'slackbot',
  'preview', 'safelinks', 'protection.outlook', 'proofpoint',
  'mimecast', 'barracuda', 'messagelabs', 'forcepoint',
  'urlscan', 'virustotal', 'curl/', 'wget/', 'python-requests',
  'go-http-client', 'headlesschrome', 'phantomjs', 'puppeteer',
];

export function classifyClient(userAgent = '') {
  const u = String(userAgent).toLowerCase();
  const hit = BOT_MARKERS.find((m) => u.includes(m));
  return {
    kind: hit ? 'bot' : 'human',
    marker: hit || '',
  };
}

export function parseHttpUrl(raw) {
  const s = String(raw || '').trim();
  if (!s) throw new Error('URL is required');
  let u;
  try {
    u = new URL(s);
  } catch {
    throw new Error('Not a valid URL');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error('Only http(s) URLs are allowed');
  }
  return u;
}

function hostOf(u) {
  return String(u.hostname || '').replace(/\.$/, '').toLowerCase();
}

function isPrivateHost(host) {
  return PRIVATE.some((re) => re.test(host));
}

function isIpHost(host) {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':');
}

function registrable(host) {
  const parts = host.split('.').filter(Boolean);
  if (parts.length < 2) return host;
  return parts.slice(-2).join('.');
}

function lookalikeBrand(host) {
  const h = host.replace(/^www\./, '');
  const reg = registrable(h);
  for (const b of BRANDS) {
    const mentioned = h.includes(b.name) || reg.replace(/[-0-9]/g, '').includes(b.name);
    if (!mentioned) continue;
    const ok = b.hosts.some((real) => h === real || h.endsWith('.' + real));
    if (!ok) return b.name;
  }
  return null;
}

function isReservedBrandHost(host) {
  const h = host.replace(/^www\./, '');
  return BRANDS.some((b) => b.hosts.some((real) => h === real || h.endsWith('.' + real)));
}

function scoreOf(issues, warnings, extra = 0) {
  return Math.max(0, 100 - issues.length * 35 - warnings.length * 12 - extra);
}
function verdictOf(issues, score) {
  if (issues.length) return 'block';
  if (score < 80) return 'risky';
  return 'ok';
}

export function staticValidate(raw) {
  const issues = [];
  const warnings = [];
  let url;
  try {
    url = parseHttpUrl(raw);
  } catch (e) {
    return {
      ok: false,
      verdict: 'block',
      score: 0,
      issues: [e.message],
      warnings: [],
      url: String(raw || ''),
      host: '',
      https: false,
    };
  }

  const host = hostOf(url);
  const https = url.protocol === 'https:';

  if (isPrivateHost(host) || host === '0.0.0.0') {
    issues.push('Destination is a private or local address (blocked).');
  }
  if (isIpHost(host)) {
    issues.push('IP-literal URLs are filtered by mailbox providers.');
  }
  if (!https) {
    warnings.push('Use HTTPS. HTTP links are often rewritten or blocked in email.');
  }
  if (url.username || url.password) {
    issues.push('URL contains credentials — looks like a phishing lure.');
  }
  if (url.pathname.includes('@') || url.href.includes('%40')) {
    issues.push('“@” in the path is a classic cloaking/phishing trick.');
  }
  const brand = lookalikeBrand(host);
  if (brand) {
    issues.push(`Host looks like a ${brand} impersonation, not the real domain.`);
  }
  const reg = registrable(host);
  if (PUBLIC_SHORTENERS.has(host) || PUBLIC_SHORTENERS.has(reg)) {
    warnings.push('Public shorteners (bit.ly, t.co, …) score poorly in cold email. Use your own branded /l/ link.');
  }
  if ((url.search + url.hash).length > 400) {
    warnings.push('Very long query strings look noisy to spam filters.');
  }
  if (/\.(exe|scr|js|zip|rar|iso)(\?|$)/i.test(url.pathname)) {
    issues.push('Direct binary/download URLs are a hard fail in email.');
  }

  const score = scoreOf(issues, warnings, https ? 0 : 8);
  const verdict = verdictOf(issues, score);

  return {
    ok: verdict !== 'block',
    verdict,
    score,
    issues,
    warnings,
    url: url.href,
    host,
    https,
  };
}

async function fetchOnce(url, redirect) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect,
      signal: ctrl.signal,
      headers: { 'User-Agent': 'FreedomMailer-LinkCheck/1.0' },
    });
    return res;
  } finally {
    clearTimeout(t);
  }
}

export async function probeUrl(raw, { maxHops = 5 } = {}) {
  const base = staticValidate(raw);
  const hops = [];
  if (!base.ok) return { ...base, hops, final_url: base.url, status: 0 };

  let current = base.url;
  let status = 0;
  let contentType = '';
  try {
    for (let i = 0; i < maxHops; i++) {
      const hopCheck = staticValidate(current);
      if (!hopCheck.ok) {
        base.issues.push(...hopCheck.issues);
        base.verdict = 'block';
        base.ok = false;
        break;
      }
      const res = await fetchOnce(current, 'manual');
      status = res.status;
      contentType = res.headers.get('content-type') || '';
      const loc = res.headers.get('location');
      hops.push({ url: current, status, location: loc || '' });
      if (status >= 300 && status < 400 && loc) {
        current = new URL(loc, current).href;
        continue;
      }
      break;
    }
  } catch (e) {
    base.warnings.push(`Could not fetch destination (${e.name === 'AbortError' ? 'timeout' : e.message}).`);
    if (base.verdict === 'ok') base.verdict = 'risky';
  }

  if (hops.length > 3) {
    base.warnings.push(`Long redirect chain (${hops.length} hops) is a spam-filter signal.`);
  }
  if (status && status >= 400) {
    base.issues.push(`Destination returned HTTP ${status}.`);
    base.verdict = 'block';
    base.ok = false;
  }

  const extra = Math.max(0, hops.length - 1) * 5;
  base.score = scoreOf(base.issues, base.warnings, extra);
  base.verdict = verdictOf(base.issues, base.score);
  base.ok = base.verdict !== 'block';

  return {
    ...base,
    hops,
    final_url: hops.length ? hops[hops.length - 1].url : base.url,
    status,
    content_type: contentType,
  };
}

export function extractUrls(html) {
  const out = [];
  const re = /https?:\/\/[^\s"'<>]+/gi;
  let m;
  const src = String(html || '');
  while ((m = re.exec(src))) out.push(m[0].replace(/[),.;]+$/, ''));
  return [...new Set(out)];
}

export function landingHtml({ title, destination, continueUrl }) {
  let host = destination;
  try {
    host = new URL(destination).hostname;
  } catch {
    /* keep */
  }
  const t = title || 'Continue';
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="0;url=${escapeAttr(continueUrl)}">
<title>${escapeHtml(t)}</title>
<style>
  body{font-family:system-ui,sans-serif;background:#f4f1ea;color:#1c1917;margin:0;display:grid;place-items:center;min-height:100vh}
  .card{background:#fffaf3;border:1px solid #e7e0d4;border-radius:16px;padding:32px;max-width:420px;text-align:center}
  a{display:inline-block;margin-top:16px;background:#1e3a5f;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:700}
  p{color:#57534e}
</style></head>
<body><div class="card">
  <h1>${escapeHtml(t)}</h1>
  <p>You are opening <b>${escapeHtml(host)}</b>.</p>
  <a href="${escapeAttr(continueUrl)}">Continue</a>
</div></body></html>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function escapeAttr(s) {
  return escapeHtml(s).replace(/'/g, '&#39;');
}
