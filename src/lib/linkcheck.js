import { URL_SHORTENERS } from './address-data.js';
import { checkDomainBlocklists, domainAge, registrableDomain, resolveA, checkIpBlocklists } from './dnsx.js';
import { config } from '../config.js';

const MAX_REDIRECTS = 8;
const FETCH_TIMEOUT = 10_000;
const UA = 'Mozilla/5.0 (compatible; FreedomMailer-LinkCheck/1.0; +link-safety-check)';

function safeUrl(input) {
  try {
    const u = new URL(String(input).trim());
    if (!/^https?:$/.test(u.protocol)) return null;
    return u;
  } catch {
    return null;
  }
}

// Follow the redirect chain by hand so every hop can be inspected: cloaked
// links and open redirects are only visible in the intermediate hops.
async function traceRedirects(startUrl) {
  const chain = [];
  let current = startUrl;
  let finalResponse = null;

  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    let res;
    try {
      res = await fetch(current, {
        method: i === 0 ? 'HEAD' : 'GET',
        redirect: 'manual',
        headers: { 'user-agent': UA, accept: '*/*' },
        signal: AbortSignal.timeout(FETCH_TIMEOUT),
      });
    } catch (err) {
      const message = String(err.message || err);
      chain.push({ url: current, status: 0, error: message });
      return { chain, final: current, response: null, error: message };
    }

    // Some hosts reject HEAD; retry the first hop as GET before giving up.
    if (i === 0 && (res.status === 405 || res.status === 501)) {
      try {
        res = await fetch(current, {
          method: 'GET',
          redirect: 'manual',
          headers: { 'user-agent': UA, accept: 'text/html,*/*' },
          signal: AbortSignal.timeout(FETCH_TIMEOUT),
        });
      } catch (err) {
        chain.push({ url: current, status: 0, error: String(err.message || err) });
        return { chain, final: current, response: null, error: String(err.message || err) };
      }
    }

    const location = res.headers.get('location');
    chain.push({ url: current, status: res.status, location: location || null });

    if (res.status >= 300 && res.status < 400 && location) {
      const next = safeUrl(new URL(location, current).toString());
      if (!next) return { chain, final: current, response: res, error: 'Redirects to a non-HTTP scheme' };
      current = next.toString();
      continue;
    }

    finalResponse = res;
    break;
  }

  return { chain, final: current, response: finalResponse, truncated: chain.length > MAX_REDIRECTS };
}

// Meta-refresh and immediate JS navigation are the usual way a "clean" landing
// page forwards to somewhere else after the filter has looked at it.
async function detectClientRedirect(url) {
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': UA, accept: 'text/html' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT),
    });
    const type = res.headers.get('content-type') || '';
    if (!/text\/html/i.test(type)) return null;
    const body = (await res.text()).slice(0, 60_000);
    const meta = body.match(/<meta[^>]+http-equiv=["']?refresh["']?[^>]*content=["'][^"']*url=([^"';\s]+)/i);
    if (meta) return { kind: 'meta-refresh', target: meta[1] };
    const js = body.match(/(?:window\.)?location(?:\.href)?\s*=\s*["'](https?:\/\/[^"']+)["']/i);
    if (js) return { kind: 'javascript', target: js[1] };
    return null;
  } catch {
    return null;
  }
}

async function safeBrowsing(urls) {
  if (!config.safeBrowsingKey) return { enabled: false, matches: [] };
  try {
    const res = await fetch(
      `https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${config.safeBrowsingKey}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: AbortSignal.timeout(8000),
        body: JSON.stringify({
          client: { clientId: 'freedom-mailer', clientVersion: '1.0' },
          threatInfo: {
            threatTypes: ['MALWARE', 'SOCIAL_ENGINEERING', 'UNWANTED_SOFTWARE', 'POTENTIALLY_HARMFUL_APPLICATION'],
            platformTypes: ['ANY_PLATFORM'],
            threatEntryTypes: ['URL'],
            threatEntries: urls.map((u) => ({ url: u })),
          },
        }),
      }
    );
    if (!res.ok) return { enabled: true, error: `Safe Browsing returned ${res.status}`, matches: [] };
    const data = await res.json();
    return { enabled: true, matches: data.matches || [] };
  } catch (err) {
    return { enabled: true, error: String(err.message || err), matches: [] };
  }
}

/**
 * Assess one URL for use in cold email: where it really goes, whether the
 * destination domain is blocklisted, how old the domain is, and whether the
 * link itself carries patterns that filters penalise.
 */
export async function checkLink(input, opts = {}) {
  const { sendingDomain = '' } = opts;
  const parsed = safeUrl(input);
  const findings = [];
  const flag = (severity, points, title, detail, fix) =>
    findings.push({ severity, points, title, detail, fix });

  if (!parsed) {
    return {
      url: String(input),
      ok: false,
      score: 0,
      verdict: 'unusable',
      findings: [{ severity: 'critical', points: 10, title: 'Not a valid HTTP(S) URL', detail: 'Only http and https links can be checked.' }],
    };
  }

  const startHost = parsed.hostname.toLowerCase();
  const startRoot = registrableDomain(startHost);

  if (parsed.protocol === 'http:') {
    flag('warning', 1.5, 'Link is not HTTPS',
      'Plain HTTP links reduce trust scores and browsers warn on them.',
      'Serve the page over HTTPS.');
  }

  if (URL_SHORTENERS.has(startRoot)) {
    flag('critical', 3, 'Link shortener',
      `${startRoot} hides the destination. Shorteners are so widely abused that some filters block them regardless of where they point.`,
      'Use the full destination URL on your own domain.');
  }

  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(startHost)) {
    flag('critical', 3.5, 'Link points at a bare IP address',
      'Almost all legitimate links use a hostname; raw IPs are a phishing hallmark.',
      'Use a proper hostname with a valid certificate.');
  }

  if (parsed.username || parsed.password) {
    flag('critical', 3.5, 'Credentials embedded in the URL',
      'The user:pass@host form is used to disguise the real hostname.',
      'Remove the embedded credentials.');
  }

  if (/[^\x00-\x7F]/.test(startHost) || /^xn--/.test(startHost)) {
    flag('warning', 1.5, 'Internationalised domain name',
      'Non-ASCII domains are used for homograph attacks and are treated with suspicion.',
      'Use an ASCII domain for outreach links.');
  }

  if (parsed.href.length > 200) {
    flag('info', 0.5, 'Very long URL',
      `${parsed.href.length} characters. Long tracking-parameter strings look like campaign spam.`,
      'Shorten the query string to what you actually need.');
  }

  // Tracking parameters that embed the recipient's address leak personal data
  // to whoever the link is forwarded to.
  const emailInUrl = /[?&][^=]*=[^&]*%40|[?&][^=]*=[^&]*@[^&]*\./i.test(parsed.href);
  if (emailInUrl) {
    flag('warning', 1, 'Recipient address appears in the URL',
      'Embedding the email address in a link exposes it if the message is forwarded or the page leaks its referrer.',
      'Use an opaque per-recipient token instead.');
  }

  // ---- Live checks ---------------------------------------------------------
  const trace = await traceRedirects(parsed.toString());
  const finalUrl = trace.final;
  const finalParsed = safeUrl(finalUrl);
  const finalHost = finalParsed?.hostname.toLowerCase() || startHost;
  const finalRoot = registrableDomain(finalHost);
  const status = trace.response?.status ?? 0;

  if (trace.error) {
    flag('critical', 3, 'The link could not be reached',
      trace.error,
      'A dead link in a cold email wastes the send and looks broken to the recipient.');
  } else if (status >= 400) {
    flag('critical', 3, `Destination returns HTTP ${status}`,
      'The page is missing or erroring.', 'Fix or remove the link before sending.');
  } else if (status >= 200 && status < 300) {
    flag('pass', 0, `Destination responds ${status}`, `Final URL: ${finalUrl}`);
  }

  const hops = trace.chain.filter((c) => c.status >= 300 && c.status < 400).length;
  if (hops >= 3) {
    flag('warning', 1.5, `${hops} redirects before the destination`,
      trace.chain.map((c) => `${c.status} ${c.url}`).join(' -> '),
      'Long redirect chains are a cloaking signal. Link directly to the destination.');
  } else if (hops > 0) {
    flag('info', 0.3, `${hops} redirect${hops > 1 ? 's' : ''}`,
      trace.chain.map((c) => `${c.status} ${c.url}`).join(' -> '),
      'Linking directly avoids the extra hop.');
  }

  if (finalRoot && startRoot && finalRoot !== startRoot) {
    flag('warning', 1, 'Redirects to a different domain',
      `${startRoot} forwards to ${finalRoot}.`,
      'Filters compare the visible domain with the destination; keep them the same.');
  }

  const clientRedirect = status >= 200 && status < 300 ? await detectClientRedirect(finalUrl) : null;
  if (clientRedirect) {
    flag('critical', 2.5, `Page forwards again via ${clientRedirect.kind}`,
      `The landing page immediately sends the visitor to ${clientRedirect.target}.`,
      'Server-side redirects that a filter cannot see are treated as cloaking.');
  }

  // ---- Reputation ----------------------------------------------------------
  const [blocklists, age, ips, sb] = await Promise.all([
    checkDomainBlocklists(finalRoot),
    domainAge(finalRoot),
    resolveA(finalHost),
    safeBrowsing([parsed.toString(), finalUrl].filter((v, i, a) => a.indexOf(v) === i)),
  ]);

  const listed = blocklists.filter((b) => b.listed);
  const unavailable = blocklists.filter((b) => b.unavailable);
  if (listed.length) {
    flag('critical', 5, `Domain is on ${listed.length} blocklist${listed.length > 1 ? 's' : ''}`,
      listed.map((b) => `${b.name} (${b.codes.join(', ')})`).join('; '),
      'Do not send this link. Request delisting first — a blocklisted URL will bury the whole campaign.');
  } else if (blocklists.length && unavailable.length === blocklists.length) {
    flag('info', 0, 'Blocklist lookups unavailable',
      'The blocklist zones refused queries from this host\'s DNS resolver, which public resolvers such as 8.8.8.8 are blocked from using. This is not a clean result.',
      'Run the check from a host with its own recursive resolver for a real answer.');
  } else {
    flag('pass', 0, 'Not on the domain blocklists checked',
      blocklists.filter((b) => !b.unavailable).map((b) => b.name).join(', ') || 'none available');
  }

  let ipBlocklists = [];
  if (ips.length) {
    ipBlocklists = await checkIpBlocklists(ips[0]);
    const ipListed = ipBlocklists.filter((b) => b.listed);
    if (ipListed.length) {
      flag('warning', 2, `Hosting IP is listed on ${ipListed.map((b) => b.name).join(', ')}`,
        `${ips[0]} appears on IP blocklists, which often means noisy shared hosting.`,
        'Move the landing page to reputable hosting.');
    }
  }

  if (age.known) {
    if (age.days < 30) {
      flag('critical', 3, `Domain registered ${age.days} day${age.days === 1 ? '' : 's'} ago`,
        `Registered ${age.registered}. Brand-new domains are the single strongest URL-reputation penalty because throwaway domains are how spam operations survive blocklisting.`,
        'Warm the domain for a few weeks before putting it in cold email.');
    } else if (age.days < 90) {
      flag('warning', 1.5, `Domain is ${age.days} days old`,
        `Registered ${age.registered}. Under about three months, filters still treat a domain as unproven.`,
        'Expect reduced placement until the domain has history.');
    } else {
      flag('pass', 0, `Domain registered ${age.registered}`, `${Math.floor(age.days / 365)} years, ${age.days % 365} days old.`);
    }
  } else {
    flag('info', 0, 'Domain age unknown', age.reason || 'No RDAP data available.');
  }

  if (sb.enabled && sb.matches.length) {
    flag('critical', 6, 'Google Safe Browsing flags this URL',
      sb.matches.map((m) => m.threatType).join(', '),
      'Do not send. Resolve the listing with Google Search Console first.');
  } else if (sb.enabled && !sb.error) {
    flag('pass', 0, 'Clean on Google Safe Browsing', 'No threat matches.');
  }

  if (sendingDomain) {
    const sendRoot = registrableDomain(sendingDomain);
    if (sendRoot && finalRoot && sendRoot !== finalRoot) {
      flag('info', 0.3, 'Link domain differs from your sending domain',
        `Sending from ${sendRoot}, linking to ${finalRoot}. Alignment between the two is a mild positive signal.`,
        'Where possible, link to a page on the domain you send from.');
    } else if (sendRoot) {
      flag('pass', 0, 'Link domain matches your sending domain', `Both are ${sendRoot}.`);
    }
  }

  const deductions = findings.reduce((s, f) => s + f.points, 0);
  const score = Math.max(0, Math.min(10, 10 - deductions));
  const verdict =
    score >= 8.5 ? 'safe for cold outreach'
      : score >= 6.5 ? 'usable with caveats'
        : score >= 4 ? 'risky'
          : 'do not send';

  return {
    url: parsed.toString(),
    ok: !trace.error && status > 0 && status < 400,
    final_url: finalUrl,
    status,
    redirects: trace.chain,
    host: finalHost,
    domain: finalRoot,
    ips,
    domain_age: age,
    blocklists,
    ip_blocklists: ipBlocklists,
    safe_browsing: sb,
    score: Number(score.toFixed(1)),
    verdict,
    findings: findings.sort((a, b) => b.points - a.points),
  };
}

export async function checkLinks(urls, opts = {}) {
  const unique = [...new Set(urls.map((u) => String(u).trim()).filter(Boolean))].slice(0, 25);
  const results = [];
  // Sequential: each check makes several DNS and HTTP requests, and hammering
  // blocklist zones in parallel gets the resolver rate-limited.
  for (const url of unique) results.push(await checkLink(url, opts));
  return results;
}
