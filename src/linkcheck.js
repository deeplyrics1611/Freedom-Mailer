import dns from 'dns/promises';
import { assertSafeUrl, dnsblLookup, withTimeout, mapWithConcurrency } from './netutils.js';

// Domains that shorten/mask a destination URL. These are heavily penalized
// by spam filters on cold/first-touch email (they hide the real domain and
// are a top phishing vector), so we flag them regardless of the actual
// destination's safety.
export const URL_SHORTENERS = new Set([
  'bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'ow.ly', 'is.gd', 'buff.ly',
  'rebrand.ly', 'cutt.ly', 'tiny.cc', 'shorte.st', 'adf.ly', 'bl.ink',
  'rb.gy', 'shorturl.at', 's.id', 'lnkd.in', 'soo.gd', 'clck.ru', 'v.gd',
  'tr.im', 'qr.ae', 'x.co', 'chilp.it', 'db.tt', 'link.ly', 'shrtco.de',
  'mcaf.ee', 'po.st', 'scrnch.me', 'filoops.info', 'vzturl.com', 'u.to',
]);

const MAX_REDIRECTS = 5;
const FETCH_TIMEOUT_MS = 6000;

async function followRedirects(url) {
  const chain = [url];
  let current = url;
  for (let i = 0; i < MAX_REDIRECTS; i++) {
    await assertSafeUrl(current); // re-validate at every hop (protects against redirect-based SSRF)
    let res;
    try {
      res = await withTimeout(fetch(current, { method: 'HEAD', redirect: 'manual' }), FETCH_TIMEOUT_MS, 'HEAD request');
    } catch (err) {
      // Some servers reject HEAD; retry once with GET before giving up on this hop.
      try {
        res = await withTimeout(fetch(current, { method: 'GET', redirect: 'manual' }), FETCH_TIMEOUT_MS, 'GET request');
      } catch (err2) {
        throw err2;
      }
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      const nextUrl = new URL(res.headers.get('location'), current).toString();
      chain.push(nextUrl);
      current = nextUrl;
      continue;
    }
    return { chain, finalUrl: current, finalStatus: res.status };
  }
  return { chain, finalUrl: current, finalStatus: null, truncated: true };
}

// Checks a single URL for cold-email "safety" signals: shortener usage,
// resolvability, HTTPS, redirect-chain length, and DNSBL domain reputation.
// Returns a verdict + reasons rather than a bare boolean, since none of
// these signals alone is conclusive.
export async function checkLink(rawUrl) {
  const issues = [];
  let hostname = null;
  let parsed = null;

  try {
    parsed = new URL(rawUrl);
    hostname = parsed.hostname.toLowerCase();
  } catch {
    return { url: rawUrl, verdict: 'invalid', issues: ['Not a valid URL.'] };
  }

  if (!/^https?:$/.test(parsed.protocol)) {
    return { url: rawUrl, hostname, verdict: 'invalid', issues: ['Only http/https links are supported.'] };
  }

  const bareDomain = hostname.replace(/^www\./, '');
  const isShortener = URL_SHORTENERS.has(bareDomain);
  if (isShortener) {
    issues.push(`"${bareDomain}" is a link-shortening service — filters flag these heavily on cold/first-touch email because they hide the real destination.`);
  }

  if (parsed.protocol !== 'https:') {
    issues.push('Link uses plain HTTP, not HTTPS — many filters and mail clients treat this as lower trust.');
  }

  let resolvable = false;
  try {
    const addrs = await dns.lookup(hostname, { all: true });
    resolvable = addrs.length > 0;
  } catch {
    resolvable = false;
  }
  if (!resolvable) {
    issues.push('Domain does not resolve — this link would appear broken to recipients.');
  }

  let redirectInfo = null;
  let blocked = false;
  if (resolvable) {
    try {
      await assertSafeUrl(rawUrl);
      redirectInfo = await followRedirects(rawUrl);
      const hops = redirectInfo.chain.length - 1;
      if (hops >= 3) {
        issues.push(`${hops} redirect hops before landing — long redirect chains are a common spam/cloaking signal.`);
      } else if (hops >= 1 && isShortener) {
        issues.push(`Redirects ${hops} time(s) after the shortener, ending at ${(() => { try { return new URL(redirectInfo.finalUrl).hostname; } catch { return redirectInfo.finalUrl; } })()}.`);
      }
      if (redirectInfo.truncated) {
        issues.push(`Exceeded ${MAX_REDIRECTS} redirects without resolving — treat as unsafe.`);
      }
      if (redirectInfo.finalStatus && redirectInfo.finalStatus >= 400) {
        issues.push(`Final destination returned HTTP ${redirectInfo.finalStatus}.`);
      }
    } catch (err) {
      blocked = true;
      issues.push(`Could not verify reachability (${err.message}). If this is an internal/staging link that's expected; otherwise check it manually.`);
    }
  }

  const dbl = await dnsblLookup(bareDomain, 'dbl.spamhaus.org');
  if (dbl.listed) {
    issues.push('Domain is listed on the Spamhaus Domain Block List (DBL) — this will actively hurt or block delivery.');
  } else if (dbl.listed === null) {
    issues.push(`Domain blocklist check was inconclusive (${dbl.error || 'DNS lookup failed'}) — verify manually.`);
  }

  let verdict = 'safe';
  const hasHardIssue = !resolvable || dbl.listed === true;
  const hasSoftIssue = isShortener || (redirectInfo && redirectInfo.chain.length - 1 >= 3) || parsed.protocol !== 'https:';
  if (hasHardIssue) verdict = 'risky';
  else if (hasSoftIssue || blocked) verdict = 'caution';

  return {
    url: rawUrl,
    hostname,
    isShortener,
    https: parsed.protocol === 'https:',
    resolvable,
    redirectHops: redirectInfo ? redirectInfo.chain.length - 1 : null,
    finalUrl: redirectInfo ? redirectInfo.finalUrl : null,
    blacklisted: dbl.listed,
    verdict, // 'safe' | 'caution' | 'risky' | 'invalid'
    issues,
  };
}

export async function checkLinks(urls) {
  return mapWithConcurrency(urls, 5, checkLink);
}
