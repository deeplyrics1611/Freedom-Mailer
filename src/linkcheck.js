const SHORTENERS = new Set([
  'bit.ly', 'bitly.com', 'tinyurl.com', 't.co', 'goo.gl', 'ow.ly', 'is.gd',
  'buff.ly', 'rebrand.ly', 'cutt.ly', 'rb.gy', 'shorturl.at', 'tiny.cc',
  'lnkd.in', 'soo.gd', 's.id', 'v.gd', 'trib.al',
]);

const RISKY_TLDS = new Set([
  'xyz', 'top', 'click', 'zip', 'review', 'country', 'gq', 'cf', 'tk', 'ml',
  'ga', 'work', 'rest', 'fit', 'quest', 'icu', 'cam', 'lol', 'cfd',
]);

const TRACKING_HOST_PARTS = [
  'mailchimp', 'list-manage', 'sendgrid.net', 'sparkpost', 'mailgun',
  'hubspotlinks', 'mandrillapp', 'constantcontact', 'klaviyo', 'convertkit',
];

export function extractUrls(htmlOrText) {
  const src = String(htmlOrText || '');
  const hrefs = [...src.matchAll(/href\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]);
  const raw = [...src.matchAll(/https?:\/\/[^\s<>"')\]]+/gi)].map((m) => m[0].replace(/[.,;]+$/, ''));
  const all = [...hrefs, ...raw]
    .map((u) => u.trim())
    .filter((u) => u && !/^mailto:/i.test(u) && !/^tel:/i.test(u) && !u.includes('{{'));
  return [...new Set(all)];
}

export function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

export function classifyUrl(url, { anchorText = '' } = {}) {
  const issues = [];
  let verdict = 'good';
  const bump = (v) => {
    const order = { good: 0, caution: 1, bad: 2 };
    if (order[v] > order[verdict]) verdict = v;
  };

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { url, host: '', verdict: 'bad', issues: ['Not a valid URL.'] };
  }

  const host = parsed.hostname.toLowerCase();
  const path = parsed.pathname || '';

  if (parsed.protocol === 'http:') {
    issues.push('Uses HTTP instead of HTTPS.');
    bump('caution');
  }
  if (SHORTENERS.has(host) || [...SHORTENERS].some((s) => host.endsWith(`.${s}`))) {
    issues.push('URL shortener — filters and recipients treat these as cloaking.');
    bump('bad');
  }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    issues.push('Raw IP address as host. Very poor for cold mail.');
    bump('bad');
  }
  const tld = host.split('.').pop();
  if (RISKY_TLDS.has(tld)) {
    issues.push(`Risky TLD (.${tld}) is over-represented in spam.`);
    bump('caution');
  }
  if (/\.(exe|zip|rar|js|apk|scr|iso)(\?|$)/i.test(path)) {
    issues.push('Link points at a downloadable executable/archive.');
    bump('bad');
  }
  if (TRACKING_HOST_PARTS.some((p) => host.includes(p))) {
    issues.push('ESP tracking redirect domain. For cold RFQs, link the real site.');
    bump('caution');
  }
  const utmCount = [...parsed.searchParams.keys()].filter((k) => /^utm_/i.test(k)).length;
  if (utmCount >= 4) {
    issues.push('Heavy UTM/query tracking on a first-touch cold link.');
    bump('caution');
  }
  if (anchorText) {
    const looksUrl = /https?:\/\//i.test(anchorText) || /^www\./i.test(anchorText);
    if (looksUrl) {
      try {
        const shown = anchorText.replace(/^https?:\/\//i, '').split('/')[0].toLowerCase();
        if (shown && shown !== host && !host.endsWith(shown) && !shown.endsWith(host)) {
          issues.push(`Display URL "${anchorText}" does not match href host ${host} (phishing pattern).`);
          bump('bad');
        }
      } catch { /* ignore */ }
    }
  }
  if (host.includes('google.com') && parsed.pathname.includes('/url')) {
    issues.push('Google redirect wrapper. Link the destination directly.');
    bump('caution');
  }
  if (!issues.length) issues.push('Looks like a direct, branded URL.');

  return { url, host, verdict, issues };
}

export function inspectAnchors(html) {
  const out = [];
  const re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(String(html || '')))) {
    const attrs = m[1] || '';
    const inner = String(m[2] || '').replace(/<[^>]+>/g, '').trim();
    const hrefM = attrs.match(/href\s*=\s*["']([^"']+)["']/i);
    if (!hrefM) continue;
    out.push({ href: hrefM[1], text: inner });
  }
  return out;
}

/**
 * Static + optional live redirect check for cold-mailing safety.
 * Live fetch is bounded (timeout, max redirects) and never follows to files.
 */
export async function checkLinks({ html = '', text = '', follow = true } = {}) {
  const anchors = inspectAnchors(html);
  const urls = extractUrls(`${html}\n${text}`);
  const byUrl = new Map();
  for (const a of anchors) {
    if (!byUrl.has(a.href)) byUrl.set(a.href, a.text);
  }

  const results = [];
  for (const url of urls) {
    const staticR = classifyUrl(url, { anchorText: byUrl.get(url) || '' });
    if (follow && /^https?:\/\//i.test(url) && staticR.verdict !== 'bad') {
      try {
        const live = await followRedirects(url);
        staticR.redirects = live.redirects;
        staticR.finalUrl = live.finalUrl;
        staticR.status = live.status;
        if (live.redirects.length >= 3) {
          staticR.issues.push(`Long redirect chain (${live.redirects.length} hops).`);
          staticR.verdict = staticR.verdict === 'good' ? 'caution' : staticR.verdict;
        }
        const finalHost = hostOf(live.finalUrl);
        if (finalHost && finalHost !== staticR.host && SHORTENERS.has(staticR.host)) {
          staticR.issues.push(`Resolves to ${finalHost}.`);
        }
        if (live.status >= 400) {
          staticR.issues.push(`Destination returned HTTP ${live.status}.`);
          staticR.verdict = 'bad';
        }
      } catch (err) {
        staticR.issues.push(`Could not fetch URL: ${String(err.message || err).slice(0, 120)}`);
        if (staticR.verdict === 'good') staticR.verdict = 'caution';
      }
    }
    results.push(staticR);
  }

  const bad = results.filter((r) => r.verdict === 'bad').length;
  const caution = results.filter((r) => r.verdict === 'caution').length;
  let summary = 'good';
  if (bad) summary = 'bad';
  else if (caution) summary = 'caution';
  if (results.length > 5 && summary === 'good') {
    summary = 'caution';
    results.push({
      url: '(count)',
      host: '',
      verdict: 'caution',
      issues: [`${results.length} links in one cold email is a lot. Keep 1–3.`],
    });
  }

  return {
    summary,
    count: results.length,
    links: results,
    advice: coldMailLinkAdvice(summary, results.length),
  };
}

function coldMailLinkAdvice(summary, count) {
  if (count === 0) {
    return 'No links found. For RFQs that is often fine — a reply-only CTA places well.';
  }
  if (summary === 'good') return 'Links look suitable for a first-touch RFQ (direct HTTPS, no shorteners).';
  if (summary === 'caution') return 'Fix warnings before sending: prefer one HTTPS link to your real domain, no shorteners or wrappers.';
  return 'Do not send as-is. Shorteners, IP hosts, mismatched display URLs, or dead links will tank placement and trust.';
}

async function followRedirects(url, maxHops = 5) {
  const redirects = [];
  let current = url;
  let status = 0;
  for (let i = 0; i < maxHops; i++) {
    const res = await fetch(current, {
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(6000),
      headers: { 'User-Agent': 'FreedomMailer-LinkCheck/1.0' },
    });
    status = res.status;
    if (status >= 300 && status < 400) {
      const loc = res.headers.get('location');
      if (!loc) break;
      const next = new URL(loc, current).toString();
      redirects.push({ from: current, to: next, status });
      current = next;
      continue;
    }
    break;
  }
  return { finalUrl: current, status, redirects };
}
