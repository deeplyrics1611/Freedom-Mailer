import dns from 'node:dns/promises';
import net from 'node:net';
import { isIP } from 'node:net';

const ROLE_LOCALS = new Set([
  'info', 'admin', 'administrator', 'sales', 'support', 'contact', 'hello',
  'office', 'billing', 'noreply', 'no-reply', 'donotreply', 'webmaster',
  'postmaster', 'abuse', 'marketing', 'hr', 'jobs', 'careers', 'press',
  'media', 'team', 'help', 'accounts', 'privacy', 'legal', 'security', 'root',
  'mailer-daemon', 'newsletter', 'enquiries', 'inquiry', 'inquiries',
  'customerservice', 'service', 'ops', 'operations', 'finance', 'ap', 'ar',
]);

const FREE_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.uk', 'hotmail.com',
  'outlook.com', 'live.com', 'msn.com', 'aol.com', 'icloud.com', 'me.com',
  'mac.com', 'protonmail.com', 'proton.me', 'pm.me', 'gmx.com', 'gmx.net',
  'mail.com', 'yandex.com', 'zoho.com', 'fastmail.com', 'hey.com',
  'outlook.co.uk', 'hotmail.co.uk', 'yahoo.fr', 'yahoo.de',
]);

const DISPOSABLE = new Set([
  'mailinator.com', 'guerrillamail.com', 'guerrillamail.org', 'sharklasers.com',
  '10minutemail.com', '10minutemail.net', 'tempmail.com', 'temp-mail.org',
  'throwawaymail.com', 'yopmail.com', 'trashmail.com', 'getnada.com',
  'maildrop.cc', 'discard.email', 'mailnesia.com', 'fakeinbox.com',
  'tempail.com', 'moakt.com', 'dispostable.com', 'mailcatch.com',
  'inboxkitten.com', 'tempmailo.com', 'emailondeck.com', 'mintemail.com',
  'mytemp.email', 'tmpmail.org', 'tmpmail.net', 'guerrillamailblock.com',
  'grr.la', 'pokemail.net', 'spam4.me', 'bccto.me', 'anonbox.net',
  'mailnull.com', 'spamgourmet.com', 'trashmailer.com', 'mailforspam.com',
  'getairmail.com', 'fake-mail.ml', 'throwawayemailaddress.com',
  'tempr.email', 'discardmail.com', 'mailexpire.com', 'jetable.org',
  'kasmail.com', 'spamfree24.org', 'spamspot.com', 'tempinbox.com',
  'meltmail.com', 'mailscrap.com', 'inboxbear.com', 'emailtemporario.com.br',
  'correotemporal.org', 'tmpeml.com', 'dropmail.me', 'emkei.cz',
]);

const TYPOS = {
  'gmial.com': 'gmail.com',
  'gmal.com': 'gmail.com',
  'gamil.com': 'gmail.com',
  'gnail.com': 'gmail.com',
  'gmail.co': 'gmail.com',
  'gmail.con': 'gmail.com',
  'yahooo.com': 'yahoo.com',
  'yaho.com': 'yahoo.com',
  'hotmial.com': 'hotmail.com',
  'hotmal.com': 'hotmail.com',
  'outlok.com': 'outlook.com',
  'outllok.com': 'outlook.com',
  'iclod.com': 'icloud.com',
};

const EMAIL_RE =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

export function parseEmail(raw) {
  const email = String(raw || '').trim().toLowerCase();
  const at = email.lastIndexOf('@');
  if (at < 1) return { email, local: '', domain: '' };
  return { email, local: email.slice(0, at), domain: email.slice(at + 1) };
}

export function syntaxOk(email) {
  if (!email || email.length > 254) return false;
  if (email.includes('..') || email.startsWith('.') || email.includes('@.')) return false;
  return EMAIL_RE.test(email);
}

/**
 * Debounce-style scoring:
 *  99  deliverable, corporate MX, not role/disposable
 *  80  deliverable free provider
 *  50–70  risky (role, catch-all)
 *  0–20  undeliverable
 */
export async function validateEmail(raw, { smtpProbe = false } = {}) {
  const { email, local, domain } = parseEmail(raw);
  const reasons = [];
  const flags = {
    syntax: false,
    mx: false,
    disposable: false,
    role: false,
    free_provider: false,
    typo: false,
    catch_all: false,
    mailbox: null,
  };

  if (!syntaxOk(email)) {
    return finish(email, 0, 'undeliverable', ['Invalid email syntax'], flags);
  }
  flags.syntax = true;

  if (TYPOS[domain]) {
    flags.typo = true;
    reasons.push(`Possible typo — did you mean ${local}@${TYPOS[domain]}?`);
    return finish(email, 8, 'undeliverable', reasons, flags, { suggestion: `${local}@${TYPOS[domain]}` });
  }

  if (DISPOSABLE.has(domain)) {
    flags.disposable = true;
    reasons.push('Disposable / temporary mailbox domain.');
    return finish(email, 12, 'undeliverable', reasons, flags);
  }

  if (ROLE_LOCALS.has(local)) {
    flags.role = true;
    reasons.push('Role-based address (info@, sales@, …) — often shared or unattended.');
  }
  if (FREE_DOMAINS.has(domain)) flags.free_provider = true;

  let mxHosts = [];
  try {
    const mx = await dns.resolveMx(domain);
    mxHosts = (mx || []).sort((a, b) => a.priority - b.priority).map((r) => r.exchange).filter(Boolean);
  } catch {
    mxHosts = [];
  }
  if (!mxHosts.length) {
    // Some domains use a naked A record as implicit MX.
    try {
      const a = await dns.resolve(domain);
      if (a && a.length) mxHosts = [domain];
    } catch { /* no records */ }
  }
  if (!mxHosts.length) {
    reasons.push('No MX (or A) records — domain cannot receive mail.');
    return finish(email, 1, 'undeliverable', reasons, flags);
  }
  flags.mx = true;
  reasons.push(`MX found (${mxHosts[0]}).`);

  let smtp = null;
  if (smtpProbe) {
    smtp = await probeMailbox(mxHosts[0], email).catch((e) => ({ error: String(e.message || e) }));
    if (smtp && smtp.catchAll) {
      flags.catch_all = true;
      reasons.push('Domain appears to be catch-all (accepts any local part).');
    } else if (smtp && smtp.accepted === false) {
      flags.mailbox = false;
      reasons.push(smtp.code ? `Mailbox rejected (${smtp.code}).` : 'Mailbox rejected by receiving server.');
      return finish(email, 3, 'undeliverable', reasons, flags, { mx: mxHosts, smtp });
    } else if (smtp && smtp.accepted === true) {
      flags.mailbox = true;
      reasons.push('Mailbox accepted at SMTP (RCPT TO).');
    } else if (smtp && smtp.error) {
      reasons.push(`SMTP probe skipped: ${smtp.error}`);
    }
  }

  let score = 99;
  if (flags.free_provider) score = 80;
  if (flags.role) score = Math.min(score, 55);
  if (flags.catch_all) score = Math.min(score, 62);
  if (smtp && smtp.accepted === true && !flags.catch_all && !flags.role && !flags.free_provider) score = 99;
  if (smtp && smtp.accepted === true && flags.free_provider && !flags.role) score = 90;

  let result = 'deliverable';
  if (score < 25) result = 'undeliverable';
  else if (score < 70) result = 'risky';

  if (result === 'deliverable' && !smtpProbe) {
    reasons.push('MX-verified. Enable SMTP probe for mailbox-level checks (port 25 must be open).');
  }

  return finish(email, score, result, reasons, flags, { mx: mxHosts, smtp });
}

export async function validateMany(emails, opts = {}) {
  const list = [...new Set((emails || []).map((e) => String(e).trim().toLowerCase()).filter(Boolean))];
  const results = [];
  // Modest concurrency so DNS stays friendly.
  const queue = [...list];
  const workers = Array.from({ length: Math.min(8, queue.length || 1) }, async () => {
    while (queue.length) {
      const email = queue.shift();
      results.push(await validateEmail(email, opts));
    }
  });
  await Promise.all(workers);
  results.sort((a, b) => list.indexOf(a.email) - list.indexOf(b.email));
  return results;
}

function finish(email, score, result, reasons, flags, extra = {}) {
  return {
    email,
    score,
    result,
    reason: reasons[0] || '',
    reasons,
    flags,
    ...extra,
  };
}

/**
 * Lightweight SMTP RCPT probe. Many hosts (including this cloud) block
 * outbound port 25 — caller should treat errors as "unknown", not invalid.
 */
export function probeMailbox(mxHost, recipient, { timeoutMs = 8000, from = 'probe@localhost' } = {}) {
  if (isIP(mxHost) === 4 && mxHost.startsWith('127.')) {
    return Promise.resolve({ error: 'refused loopback MX' });
  }
  return new Promise((resolve) => {
    const sock = net.connect({ host: mxHost, port: 25 });
    let buf = '';
    const lines = [];
    let stage = 'banner';
    let accepted;
    const timer = setTimeout(() => {
      sock.destroy();
      resolve({ error: 'timeout connecting to MX:25' });
    }, timeoutMs);

    const send = (cmd) => sock.write(cmd + '\r\n');

    sock.setEncoding('utf8');
    sock.on('error', (err) => {
      clearTimeout(timer);
      resolve({ error: err.message });
    });
    sock.on('data', (chunk) => {
      buf += chunk;
      const parts = buf.split(/\r?\n/);
      buf = parts.pop() || '';
      for (const line of parts) {
        if (!line) continue;
        lines.push(line);
        const cont = /^\d{3}-/.test(line);
        if (cont) continue;
        const code = parseInt(line.slice(0, 3), 10);
        if (stage === 'banner') {
          if (code >= 400) { done({ error: line }); return; }
          stage = 'helo';
          send('HELO validate.local');
        } else if (stage === 'helo') {
          stage = 'mail';
          send(`MAIL FROM:<${from}>`);
        } else if (stage === 'mail') {
          stage = 'rcpt';
          send(`RCPT TO:<${recipient}>`);
        } else if (stage === 'rcpt') {
          accepted = code >= 200 && code < 300;
          stage = 'quit';
          send('QUIT');
          done({ accepted, code, line });
        }
      }
    });

    function done(result) {
      clearTimeout(timer);
      try { sock.end(); } catch { /* ignore */ }
      resolve(result);
    }
  });
}

export function parseEmailList(text) {
  const raw = String(text || '');
  const fromCsv = raw.includes(',') && raw.includes('\n')
    ? parseCsvEmails(raw)
    : [];
  const matches = raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
  return [...new Set([...fromCsv, ...matches].map((e) => e.toLowerCase()))];
}

function parseCsvEmails(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const header = lines[0].split(',').map((h) => h.trim().toLowerCase().replace(/^"|"$/g, ''));
  const idx = header.findIndex((h) => h === 'email' || h === 'e-mail' || h === 'mail');
  if (idx < 0) return [];
  const out = [];
  for (const line of lines.slice(1)) {
    const cols = splitCsvLine(line);
    if (cols[idx]) out.push(cols[idx].trim());
  }
  return out;
}

export function splitCsvLine(line) {
  const cols = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { cols.push(cur); cur = ''; }
    else cur += ch;
  }
  cols.push(cur);
  return cols.map((c) => c.trim());
}

export function parseContactCsv(text) {
  const lines = String(text || '').split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const header = splitCsvLine(lines[0]).map((h) => h.toLowerCase().replace(/\s+/g, '_'));
  const rows = [];
  for (const line of lines.slice(1)) {
    const cols = splitCsvLine(line);
    const obj = {};
    header.forEach((h, i) => { obj[h] = cols[i] || ''; });
    const email = (obj.email || obj.e_mail || obj.mail || '').trim().toLowerCase();
    if (!email) continue;
    rows.push({
      email,
      first_name: obj.first_name || obj.firstname || obj.first || '',
      last_name: obj.last_name || obj.lastname || obj.last || '',
      name: obj.name || obj.full_name || '',
      company: obj.company || obj.account || obj.organization || '',
      title: obj.title || obj.job_title || obj.role || '',
      phone: obj.phone || obj.mobile || '',
    });
  }
  return rows;
}

export { ROLE_LOCALS, FREE_DOMAINS, DISPOSABLE, TYPOS };
