import dns from 'dns/promises';
import net from 'net';
import { mapWithConcurrency, withTimeout } from './netutils.js';

// A representative sample of disposable/temporary email domains. New ones
// appear constantly; treat this as a floor, not a complete list.
export const DISPOSABLE_DOMAINS = new Set([
  'mailinator.com', '10minutemail.com', '10minutemail.net', 'guerrillamail.com',
  'guerrillamail.info', 'guerrillamail.biz', 'guerrillamail.de', 'guerrillamailblock.com',
  'yopmail.com', 'yopmail.fr', 'yopmail.net', 'trashmail.com', 'trashmail.net',
  'tempmail.com', 'temp-mail.org', 'throwawaymail.com', 'fakeinbox.com',
  'getnada.com', 'dispostable.com', 'sharklasers.com', 'spam4.me', 'mytemp.email',
  'moakt.com', 'maildrop.cc', 'mintemail.com', 'emailondeck.com', 'mailnesia.com',
  'mohmal.com', 'tempinbox.com', 'burnermail.io', 'discard.email', 'discardmail.com',
  'mailcatch.com', 'spamgourmet.com', 'mail-temporaire.fr', 'jetable.org',
  'tempr.email', 'tmpmail.org', 'tmpmail.net', 'tmail.ws', 'inboxbear.com',
  'fakemailgenerator.com', 'crazymailing.com', 'mailpoof.com', 'emailfake.com',
  'einrot.com', '33mail.com', 'moakt.co', 'anonaddy.com', 'luxusmail.org',
  'harakirimail.com', 'objectmail.com', 'proxymail.eu', 'rcpt.at', 'trash-mail.at',
  'wegwerfemail.de', 'wegwerfmail.de', 'kurzepost.de', 'nada.email',
]);

// Local-part prefixes that indicate a shared/role mailbox rather than a
// specific person. Deliverable, but usually a worse cold-outreach target
// and often policy-filtered by the receiving org.
export const ROLE_PREFIXES = new Set([
  'info', 'admin', 'administrator', 'sales', 'support', 'contact', 'help',
  'webmaster', 'postmaster', 'noreply', 'no-reply', 'donotreply', 'marketing',
  'hello', 'office', 'billing', 'abuse', 'security', 'privacy', 'legal',
  'careers', 'jobs', 'hr', 'press', 'media', 'accounts', 'account',
  'enquiries', 'enquiry', 'inquiries', 'feedback', 'newsletter', 'team',
]);

export const FREE_PROVIDERS = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'ymail.com', 'outlook.com',
  'hotmail.com', 'live.com', 'msn.com', 'aol.com', 'icloud.com', 'me.com',
  'protonmail.com', 'proton.me', 'gmx.com', 'gmx.net', 'mail.com', 'yandex.com',
  'zoho.com', 'aim.com',
]);

// Common providers used as typo-correction targets (e.g. "gmial.com" -> "gmail.com").
const TYPO_TARGETS = [
  'gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'icloud.com',
  'aol.com', 'live.com', 'msn.com', 'protonmail.com',
];

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function suggestTypoFix(domain) {
  if (TYPO_TARGETS.includes(domain)) return null;
  let best = null;
  for (const target of TYPO_TARGETS) {
    const dist = levenshtein(domain, target);
    if (dist > 0 && dist <= 2 && (!best || dist < best.dist)) best = { target, dist };
  }
  return best ? best.target : null;
}

// RFC 5322 is famously hard to validate with a single regex; this is the
// pragmatic subset every real-world validator (and debounce/ZeroBounce-style
// tools) actually enforces.
const EMAIL_RE = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

async function resolveMailHosts(domain) {
  try {
    const mx = await dns.resolveMx(domain);
    // RFC 7505 "null MX" (exchange "." or empty) explicitly declares the
    // domain accepts no mail at all — that must NOT be treated as a valid
    // mail host, even though the DNS query itself succeeded.
    const real = mx.filter((r) => r.exchange && r.exchange !== '.');
    if (real.length) return real.sort((a, b) => a.priority - b.priority).map((r) => r.exchange);
    if (mx.length) return []; // only null-MX record(s) present: mail explicitly refused
  } catch {
    // fall through to A/AAAA fallback per RFC 5321 §5.1
  }
  try {
    await dns.resolve4(domain);
    return [domain];
  } catch { /* noop */ }
  try {
    await dns.resolve6(domain);
    return [domain];
  } catch { /* noop */ }
  return [];
}

// Best-effort SMTP handshake probe: connect to the MX, EHLO, MAIL FROM, then
// RCPT TO — and disconnect *before* DATA, so no message is ever sent. Many
// networks (including most cloud/CI egress) block or heavily throttle
// outbound port 25, and plenty of mail servers accept-all at RCPT time and
// only bounce later ("catch-all") — so this is inherently best-effort, not
// a guarantee. Treat it as a bonus signal layered on top of MX/syntax
// checks, never as the sole source of truth.
async function smtpProbe(mxHost, email, { timeoutMs = 6000, heloDomain = 'verify.local', mailFrom = 'verify@verify.local' } = {}) {
  return new Promise((resolve) => {
    let stage = 'connect';
    let buffer = '';
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      try { socket.destroy(); } catch { /* noop */ }
      resolve(result);
    };
    const socket = net.createConnection({ host: mxHost, port: 25 });
    socket.setTimeout(timeoutMs);
    socket.on('timeout', () => finish({ attempted: true, accepted: null, note: 'Connection/response timed out (port 25 may be blocked on this network).' }));
    socket.on('error', (err) => finish({ attempted: true, accepted: null, note: `Connection error: ${err.code || err.message}` }));
    socket.on('data', (chunk) => {
      buffer += chunk.toString();
      if (!buffer.endsWith('\n')) return; // wait for full line(s)
      const code = parseInt(buffer.slice(0, 3), 10);
      buffer = '';
      if (stage === 'connect') {
        if (code === 220) { socket.write(`EHLO ${heloDomain}\r\n`); stage = 'ehlo'; }
        else finish({ attempted: true, accepted: null, note: `Unexpected banner code ${code}` });
      } else if (stage === 'ehlo') {
        if (code === 250) { socket.write(`MAIL FROM:<${mailFrom}>\r\n`); stage = 'mail'; }
        else finish({ attempted: true, accepted: null, note: `EHLO rejected (${code})` });
      } else if (stage === 'mail') {
        if (code === 250) { socket.write(`RCPT TO:<${email}>\r\n`); stage = 'rcpt'; }
        else finish({ attempted: true, accepted: null, note: `MAIL FROM rejected (${code})` });
      } else if (stage === 'rcpt') {
        socket.write('QUIT\r\n');
        if (code === 250) finish({ attempted: true, accepted: true, code, note: 'Mailbox accepted the address.' });
        else if (code >= 500) finish({ attempted: true, accepted: false, code, note: 'Mailbox explicitly rejected the address.' });
        else finish({ attempted: true, accepted: null, code, note: `Ambiguous/greylisted response (${code}).` });
      }
    });
  });
}

// Validate a single email address. `opts.smtp` enables the best-effort live
// mailbox probe (slow, and frequently blocked by network egress rules —
// results degrade gracefully to the MX-based verdict when it can't run).
export async function validateEmail(rawEmail, opts = {}) {
  const email = String(rawEmail || '').trim();
  const lower = email.toLowerCase();
  const result = {
    email,
    syntaxValid: false,
    domain: null,
    disposable: false,
    roleBased: false,
    freeProvider: false,
    typoSuggestion: null,
    mxFound: false,
    mxHosts: [],
    smtp: { attempted: false, accepted: null, note: null },
    status: 'invalid',
    score: 0,
  };

  if (!lower || !EMAIL_RE.test(lower) || lower.length > 254) {
    result.status = 'invalid';
    result.reason = 'Malformed email address.';
    return result;
  }
  result.syntaxValid = true;

  const [local, domain] = lower.split('@');
  result.domain = domain;
  result.roleBased = ROLE_PREFIXES.has(local.replace(/[+].*$/, ''));
  result.freeProvider = FREE_PROVIDERS.has(domain);
  result.typoSuggestion = suggestTypoFix(domain);

  if (DISPOSABLE_DOMAINS.has(domain)) {
    result.disposable = true;
    result.status = 'disposable';
    result.score = 10;
    result.reason = 'Domain is a known disposable/temporary email provider.';
    return result;
  }

  const mxHosts = await resolveMailHosts(domain);
  result.mxFound = mxHosts.length > 0;
  result.mxHosts = mxHosts.slice(0, 3);

  if (!result.mxFound) {
    result.status = 'invalid';
    result.reason = 'Domain has no mail server (no MX, A, or AAAA record) — mail cannot be delivered.';
    result.score = 0;
    return result;
  }

  if (opts.smtp && mxHosts.length) {
    try {
      result.smtp = await withTimeout(smtpProbe(mxHosts[0], lower, opts.smtpOptions), (opts.smtpOptions?.timeoutMs || 6000) + 1000, 'SMTP probe');
    } catch (err) {
      result.smtp = { attempted: true, accepted: null, note: String(err.message || err) };
    }
  }

  // Scoring: start from MX-confirmed baseline, then adjust for every signal.
  let score = 70;
  if (result.smtp.accepted === true) score = 97;
  if (result.smtp.accepted === false) score = 5;
  if (result.roleBased) score -= 15;
  if (result.typoSuggestion) score -= 20;
  score = Math.max(0, Math.min(99, score));
  result.score = score;

  if (result.smtp.accepted === false) {
    result.status = 'invalid';
    result.reason = 'Mail server explicitly rejected this mailbox.';
  } else if (result.roleBased) {
    result.status = 'risky';
    result.reason = 'Role-based mailbox (info@, sales@, etc.) — deliverable but a weaker cold-outreach target.';
  } else if (result.typoSuggestion) {
    result.status = 'risky';
    result.reason = `Domain looks like a typo of "${result.typoSuggestion}".`;
  } else if (result.smtp.accepted === true) {
    result.status = 'valid';
    result.reason = 'Syntax, MX and live mailbox check all passed.';
  } else {
    result.status = 'valid';
    result.reason = opts.smtp
      ? `Syntax + MX passed; live mailbox check was inconclusive (${result.smtp.note || 'no response'}).`
      : 'Syntax and MX records passed (live mailbox probe not requested).';
  }

  return result;
}

export async function validateBatch(emails, opts = {}) {
  const concurrency = opts.smtp ? 5 : 20;
  const results = await mapWithConcurrency(emails, concurrency, (e) => validateEmail(e, opts));
  const summary = { total: results.length, valid: 0, invalid: 0, risky: 0, disposable: 0 };
  for (const r of results) {
    if (r.status === 'valid') summary.valid++;
    else if (r.status === 'risky') summary.risky++;
    else if (r.status === 'disposable') summary.disposable++;
    else summary.invalid++;
  }
  return { results, summary };
}
