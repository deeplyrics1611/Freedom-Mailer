import dns from 'dns/promises';
import net from 'net';

// ---- HTML helpers -------------------------------------------------------

// Very small HTML->text stripper. Good enough for content heuristics; not a
// full parser and not meant to sanitize untrusted HTML for rendering.
export function stripHtml(html) {
  if (!html) return '';
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

// Extract every http(s) link from an HTML fragment: both href="" attributes
// and bare URLs typed directly into the text.
export function extractLinks(html) {
  if (!html) return [];
  const found = new Set();
  for (const m of html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)) {
    const href = m[1].trim();
    if (/^https?:\/\//i.test(href)) found.add(href);
  }
  for (const m of html.matchAll(/\bhttps?:\/\/[^\s"'<>)]+/gi)) {
    found.add(m[0].replace(/[.,;:!?]+$/, ''));
  }
  return [...found];
}

// Anchors whose visible text looks like a URL but points somewhere else —
// a classic phishing/spam-filter red flag ("link text mismatch").
export function findMismatchedAnchors(html) {
  if (!html) return [];
  const mismatches = [];
  for (const m of html.matchAll(/<a\s+[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = m[1].trim();
    const text = stripHtml(m[2]).trim();
    const textUrlMatch = text.match(/\bhttps?:\/\/([^\s/]+)/i);
    if (!textUrlMatch) continue;
    try {
      const hrefHost = new URL(href, 'http://x').hostname.replace(/^www\./, '').toLowerCase();
      const textHost = textUrlMatch[1].replace(/^www\./, '').toLowerCase();
      if (hrefHost && textHost && hrefHost !== textHost) {
        mismatches.push({ href, text, hrefHost, textHost });
      }
    } catch {
      // ignore unparsable hrefs
    }
  }
  return mismatches;
}

// ---- SSRF-safe network helpers -----------------------------------------
// These tools accept user-supplied URLs/domains and make outbound requests
// on the server's behalf, so we must not let a caller point us at internal
// infrastructure (localhost, cloud metadata endpoints, RFC1918 ranges, etc.)

function isPrivateIPv4(ip) {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => Number.isNaN(n))) return true;
  const [a, b] = p;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true; // link-local + cloud metadata (169.254.169.254)
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // shared/CGNAT
  return false;
}

function isPrivateIPv6(ip) {
  const low = ip.toLowerCase();
  if (low === '::1' || low === '::') return true;
  if (low.startsWith('fe80')) return true; // link-local
  if (/^f[cd][0-9a-f]{2}:/.test(low)) return true; // fc00::/7 unique local
  const mapped = low.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIPv4(mapped[1]);
  return false;
}

export function isPrivateIp(ip) {
  return net.isIPv6(ip) ? isPrivateIPv6(ip) : isPrivateIPv4(ip);
}

// Resolves a hostname and returns true only if it is safe to connect to
// (resolves publicly, doesn't resolve to internal/reserved space). Fails
// closed: unresolvable or errored lookups are treated as unsafe.
export async function isSafePublicHost(hostname) {
  const host = String(hostname || '').trim().toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) {
    return false;
  }
  if (net.isIP(host)) return !isPrivateIp(host);
  try {
    const addrs = await dns.lookup(host, { all: true, verbatim: true });
    if (!addrs.length) return false;
    return addrs.every((a) => !isPrivateIp(a.address));
  } catch {
    return false;
  }
}

// Validates a user-supplied URL is http(s), well-formed, and safe to fetch.
export async function assertSafeUrl(rawUrl) {
  let u;
  try {
    u = new URL(rawUrl);
  } catch {
    throw new Error('Invalid URL');
  }
  if (!/^https?:$/.test(u.protocol)) throw new Error('Only http/https URLs are allowed');
  if (!(await isSafePublicHost(u.hostname))) {
    throw new Error('URL resolves to a private/internal address and was blocked');
  }
  return u;
}

// Spamhaus (and most DNSBL providers) reserve 127.255.255.0/24 as *policy*
// replies, not real listings: e.g. "queried via an open/public resolver,
// which isn't authorized on the free mirror" or "too many queries, temporarily
// throttled". Treating those as real listings would flag almost every domain
// as blacklisted when running behind a shared/public DNS resolver (common in
// containers and CI), so they must be filtered out separately from genuine
// 127.0.0.x listing codes.
const DNSBL_POLICY_CODES = new Set(['127.255.255.252', '127.255.255.254', '127.255.255.255']);

// A DNS-based blocklist (DNSBL) lookup, e.g. dbl.spamhaus.org for domains or
// zen.spamhaus.org for IPs. Resolves => listed. NXDOMAIN => not listed.
// Any other error => unknown (fail-safe, never blocks the UI on network flakiness).
export async function dnsblLookup(query, zone) {
  try {
    const addrs = await dns.resolve4(`${query}.${zone}`);
    if (addrs.every((a) => DNSBL_POLICY_CODES.has(a))) {
      return { listed: null, codes: addrs, error: 'policy-response (likely queried via a public/shared resolver; result not authoritative)' };
    }
    const realCodes = addrs.filter((a) => !DNSBL_POLICY_CODES.has(a));
    return { listed: true, codes: realCodes.length ? realCodes : addrs };
  } catch (err) {
    if (err && (err.code === 'ENOTFOUND' || err.code === 'ENODATA')) {
      return { listed: false, codes: [] };
    }
    return { listed: null, codes: [], error: err.code || String(err.message || err) };
  }
}

// Small bounded concurrency pool — avoids pulling in a dependency for
// something this small, and keeps batch jobs (link/lead checks) from
// hammering the network or the event loop.
export async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      try {
        results[i] = await fn(items[i], i);
      } catch (err) {
        results[i] = { error: String(err && err.message || err) };
      }
    }
  }
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker);
  await Promise.all(workers);
  return results;
}

export function withTimeout(promise, ms, label = 'operation') {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
