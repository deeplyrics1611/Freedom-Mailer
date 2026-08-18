import { db } from '../db.js';
import { config } from '../config.js';
import { hasMx, registrableDomain } from './dnsx.js';
import { probeRecipients, randomLocalPart } from './smtp-probe.js';
import {
  DISPOSABLE_DOMAINS, FREE_DOMAINS, ROLE_PREFIXES, PROCUREMENT_ROLES,
  ACCEPT_ALL_PROVIDERS, suggestDomain,
} from './address-data.js';

const CACHE_TTL_HOURS = 24 * 7;

// Deliberately stricter than RFC 5322 (which permits quoted strings and other
// forms nobody uses in practice) because anything exotic in a lead list is a
// data-entry mistake.
const SYNTAX = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/;

export function parseAddress(input) {
  const email = String(input || '').trim().replace(/^mailto:/i, '');
  const at = email.lastIndexOf('@');
  if (at < 1) return { email, valid: false };
  return {
    email,
    local: email.slice(0, at),
    domain: email.slice(at + 1).toLowerCase(),
    valid: true,
  };
}

// Canonical form used for de-duplication only — never for sending, since some
// providers do treat dots and tags as significant.
export function canonicalize(email) {
  const { local, domain, valid } = parseAddress(email);
  if (!valid) return String(email || '').toLowerCase();
  let l = local.toLowerCase();
  const d = domain === 'googlemail.com' ? 'gmail.com' : domain;
  if (d === 'gmail.com') l = l.split('+')[0].replace(/\./g, '');
  else if (['outlook.com', 'hotmail.com', 'live.com', 'yahoo.com'].includes(d)) l = l.split('+')[0];
  return `${l}@${d}`;
}

function cachedDomain(domain) {
  const row = db.prepare('SELECT * FROM domain_cache WHERE domain = ?').get(domain);
  if (!row) return null;
  const ageHours = (Date.now() - new Date(`${row.checked_at.replace(' ', 'T')}Z`).getTime()) / 3_600_000;
  if (Number.isFinite(ageHours) && ageHours > CACHE_TTL_HOURS) return null;
  return { ...row, mx: JSON.parse(row.mx || '[]') };
}

function storeDomain(domain, { mx, has_mx, catch_all }) {
  db.prepare(
    `INSERT INTO domain_cache (domain, mx, has_mx, catch_all, checked_at)
     VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT(domain) DO UPDATE SET
       mx = excluded.mx,
       has_mx = excluded.has_mx,
       catch_all = COALESCE(excluded.catch_all, domain_cache.catch_all),
       checked_at = excluded.checked_at`
  ).run(domain, JSON.stringify(mx || []), has_mx ? 1 : 0, catch_all === undefined ? null : catch_all);
}

function acceptAllProvider(mxHosts) {
  for (const host of mxHosts) {
    for (const p of ACCEPT_ALL_PROVIDERS) if (p.match.test(host)) return p.name;
  }
  return null;
}

/**
 * Validate a single address.
 *
 * Returns `{ status, score, reason, checks }` where status is one of
 * valid | invalid | risky | catch_all | unknown. `unknown` is used honestly:
 * when the SMTP conversation cannot be completed (blocked port 25, greylisting,
 * a provider that accepts everything) we say so instead of guessing.
 */
export async function verifyEmail(input, opts = {}) {
  const deep = opts.deep !== false && config.verification.smtpProbe;
  const started = Date.now();
  const { email, local, domain, valid: parsed } = parseAddress(input);

  const checks = {
    syntax: false,
    domain: domain || null,
    canonical: null,
    mx: [],
    has_mx: false,
    disposable: false,
    free: false,
    role: false,
    procurement_role: false,
    high_risk_role: false,
    suggestion: null,
    catch_all: null,
    smtp: null,
    accept_all_provider: null,
  };

  const done = (status, score, reason, notes = []) => ({
    email,
    status,
    score,
    reason,
    notes,
    checks,
    ms: Date.now() - started,
  });

  if (!parsed || !SYNTAX.test(email) || email.length > 254 || local.length > 64) {
    return done('invalid', 0, 'syntax_error', ['The address is not a valid email address.']);
  }
  checks.syntax = true;
  checks.canonical = canonicalize(email);

  const notes = [];
  const localLower = local.toLowerCase();
  checks.disposable = DISPOSABLE_DOMAINS.has(domain) || DISPOSABLE_DOMAINS.has(registrableDomain(domain));
  checks.free = FREE_DOMAINS.has(domain);
  checks.role = ROLE_PREFIXES.has(localLower);
  checks.procurement_role = PROCUREMENT_ROLES.has(localLower);
  checks.high_risk_role = ['abuse', 'postmaster', 'spam', 'noreply', 'no-reply', 'mailer-daemon'].includes(localLower);
  checks.suggestion = suggestDomain(domain);

  if (checks.suggestion) notes.push(`Possible typo — did you mean @${checks.suggestion}?`);

  // ---- DNS -----------------------------------------------------------------
  let cache = cachedDomain(domain);
  if (cache) {
    checks.mx = cache.mx;
    checks.has_mx = !!cache.has_mx;
    checks.catch_all = cache.catch_all === null ? null : !!cache.catch_all;
  } else {
    const mxResult = await hasMx(domain);
    checks.mx = mxResult.mx;
    checks.has_mx = mxResult.hasMx;
    storeDomain(domain, { mx: mxResult.mx, has_mx: mxResult.hasMx });
    cache = cachedDomain(domain);
  }

  if (!checks.has_mx) {
    return done('invalid', 2, 'no_mx', ['The domain has no mail server, so it cannot receive email.']);
  }

  if (checks.disposable) {
    return done('invalid', 10, 'disposable', [
      'Throwaway inbox provider — the address will stop working and may be a spam trap.',
    ]);
  }

  if (checks.high_risk_role) {
    notes.push(`"${localLower}@" is an abuse/automation address — mailing it invites complaints.`);
  } else if (checks.role) {
    notes.push(
      checks.procurement_role
        ? `Shared "${localLower}@" mailbox — a normal destination for a quote request, but no individual owns it.`
        : `Shared "${localLower}@" mailbox rather than a person.`
    );
  }
  if (checks.free) notes.push('Consumer mailbox provider rather than a company domain.');

  const mxHosts = checks.mx.map((m) => m.host);
  checks.accept_all_provider = acceptAllProvider(mxHosts);

  // ---- SMTP ----------------------------------------------------------------
  if (!deep) {
    return score(done, 'unknown', 'dns_only', [...notes, 'DNS checks only — mailbox existence was not tested.'], checks);
  }

  if (checks.accept_all_provider) {
    // These providers answer 250 for every recipient at RCPT time, so probing
    // them produces a confident-looking answer that means nothing.
    notes.push(
      `${checks.accept_all_provider} accepts every recipient during the SMTP conversation, so mailbox existence cannot be confirmed this way.`
    );
    checks.catch_all = true;
    storeDomain(domain, { mx: checks.mx, has_mx: true, catch_all: 1 });
    return score(done, 'unknown', 'provider_accepts_all', notes, checks);
  }

  const probeOpts = {
    heloName: config.verification.heloName,
    mailFrom: config.verification.mailFrom,
    timeout: config.verification.timeoutMs,
  };

  const needCatchAll = checks.catch_all === null;
  const decoy = `${randomLocalPart()}@${domain}`;
  const targets = needCatchAll ? [email, decoy] : [email];
  const probe = await probeRecipients(mxHosts[0], targets, probeOpts);
  checks.smtp = {
    host: mxHosts[0],
    ok: probe.ok,
    error: probe.error || null,
    port_blocked: !!probe.portBlocked,
    ...(probe.results[email] || {}),
  };

  if (!probe.ok && probe.portBlocked) {
    notes.push(
      'Could not reach the mail server on port 25 — this host blocks outbound SMTP, so mailbox existence could not be verified.'
    );
    return score(done, 'unknown', 'smtp_unreachable', notes, checks);
  }

  if (needCatchAll && probe.results[decoy]) {
    const decoyVerdict = probe.results[decoy].verdict;
    if (decoyVerdict === 'accepted') {
      checks.catch_all = true;
      storeDomain(domain, { mx: checks.mx, has_mx: true, catch_all: 1 });
    } else if (decoyVerdict === 'rejected') {
      checks.catch_all = false;
      storeDomain(domain, { mx: checks.mx, has_mx: true, catch_all: 0 });
    }
  }

  const verdict = probe.results[email]?.verdict || 'unknown';

  if (verdict === 'rejected') {
    return done('invalid', 3, 'mailbox_not_found', [
      ...notes,
      `The mail server rejected this recipient: ${checks.smtp.message || 'no such mailbox'}`,
    ]);
  }
  if (verdict === 'deferred') {
    notes.push('The server replied with a temporary error (greylisting or rate limiting). Re-check later.');
    return score(done, 'unknown', 'greylisted', notes, checks);
  }
  if (verdict === 'blocked') {
    notes.push('The server refused the conversation on policy grounds, so the mailbox could not be tested.');
    return score(done, 'unknown', 'smtp_blocked', notes, checks);
  }
  if (verdict !== 'accepted') {
    return score(done, 'unknown', 'no_answer', [...notes, 'The mail server gave no usable answer.'], checks);
  }

  if (checks.catch_all) {
    notes.push('The domain accepts mail for every address, so a successful reply does not prove this mailbox exists.');
    return score(done, 'catch_all', 'catch_all_domain', notes, checks);
  }

  return score(done, 'valid', 'mailbox_exists', [...notes, 'The mail server confirmed this recipient.'], checks);
}

// Turn the verdict plus the softer signals into a 0-100 confidence score.
function score(done, status, reason, notes, checks) {
  let s = { valid: 95, catch_all: 55, unknown: 45, risky: 40, invalid: 5 }[status] ?? 40;

  if (status === 'unknown') {
    // Without an SMTP answer the DNS-level signals are all we have.
    if (reason === 'dns_only' || reason === 'smtp_unreachable' || reason === 'provider_accepts_all') {
      s = checks.has_mx ? 60 : 10;
      if (checks.accept_all_provider) s = 55;
    }
    if (reason === 'greylisted') s = 50;
  }

  if (checks.high_risk_role) s -= 25;
  else if (checks.role && !checks.procurement_role) s -= 8;
  if (checks.free) s -= 5;
  if (checks.suggestion) s -= 10;

  s = Math.max(0, Math.min(100, Math.round(s)));

  // A role address on an otherwise fine domain is deliverable but carries
  // complaint risk, which "risky" describes better than "valid".
  let finalStatus = status;
  if (status === 'valid' && checks.high_risk_role) finalStatus = 'risky';

  return { ...done(finalStatus, s, reason, notes), score: s, status: finalStatus };
}

// Run `worker` over `items` with a bounded number of concurrent operations.
export async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let index = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (index < items.length) {
      const i = index++;
      try {
        results[i] = await worker(items[i], i);
      } catch (err) {
        results[i] = { error: String(err.message || err) };
      }
    }
  });
  await Promise.all(runners);
  return results;
}
