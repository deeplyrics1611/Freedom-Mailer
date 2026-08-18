import { registrableDomain } from './dnsx.js';

// Parses the raw source of a delivered message ("Show original" in Gmail) and
// reports what the receiving server actually decided. Static content analysis
// predicts; this is the record of what really happened, including the
// authentication verdicts, the spam score the receiver assigned, and how long
// each hop took.

/** Unfold and split RFC 5322 headers. Returns ordered [name, value] pairs. */
export function parseHeaders(raw) {
  const source = String(raw || '').replace(/\r\n/g, '\n');
  const end = source.indexOf('\n\n');
  const block = end === -1 ? source : source.slice(0, end);
  const lines = block.split('\n');
  const headers = [];
  for (const line of lines) {
    if (/^[ \t]/.test(line) && headers.length) {
      headers[headers.length - 1][1] += ` ${line.trim()}`;
    } else {
      const idx = line.indexOf(':');
      if (idx > 0) headers.push([line.slice(0, idx).trim(), line.slice(idx + 1).trim()]);
    }
  }
  return headers;
}

const get = (headers, name) =>
  headers.find(([k]) => k.toLowerCase() === name.toLowerCase())?.[1] || null;
const getAll = (headers, name) =>
  headers.filter(([k]) => k.toLowerCase() === name.toLowerCase()).map(([, v]) => v);

const addressIn = (value) => {
  const m = String(value || '').match(/<([^>]+)>/) || String(value || '').match(/([^\s<>",]+@[^\s<>",]+)/);
  return m ? m[1].toLowerCase() : null;
};

const domainOf = (addr) => (addr && addr.includes('@') ? addr.split('@').pop().toLowerCase() : null);

// Authentication-Results looks like:
//   mx.google.com; dkim=pass header.i=@example.com; spf=pass ...; dmarc=pass ...
function parseAuthResults(values) {
  const out = { spf: null, dkim: null, dmarc: null, compauth: null, raw: values };
  for (const value of values) {
    for (const method of ['dkim', 'spf', 'dmarc', 'compauth']) {
      const m = value.match(new RegExp(`\\b${method}\\s*=\\s*([a-z]+)`, 'i'));
      if (m && !out[method]) {
        const detail = value.match(new RegExp(`\\b${method}\\s*=\\s*[a-z]+([^;]*)`, 'i'))?.[1]?.trim() || '';
        out[method] = { result: m[1].toLowerCase(), detail };
      }
    }
  }
  return out;
}

// Received headers are prepended, so the list runs newest (delivery) to oldest
// (submission). Reversing gives chronological order.
function parseReceived(values) {
  const hops = values.map((value) => {
    const dateMatch = value.match(/;\s*(.+)$/);
    const date = dateMatch ? new Date(dateMatch[1].trim()) : null;
    return {
      raw: value.length > 400 ? `${value.slice(0, 400)}...` : value,
      from: value.match(/\bfrom\s+([^\s;]+)/i)?.[1] || null,
      by: value.match(/\bby\s+([^\s;]+)/i)?.[1] || null,
      ip: value.match(/\[?((?:\d{1,3}\.){3}\d{1,3})\]?/)?.[1] || null,
      tls: /\b(using|with)\b[^;]*\b(TLS|SSL)/i.test(value) || /version=TLS/i.test(value),
      date: date && !Number.isNaN(date.getTime()) ? date : null,
    };
  });
  hops.reverse();
  let previous = null;
  for (const hop of hops) {
    hop.delay_seconds = previous && hop.date ? Math.max(0, Math.round((hop.date - previous) / 1000)) : 0;
    if (hop.date) previous = hop.date;
  }
  return hops;
}

function parseSpamScore(headers) {
  const status = get(headers, 'X-Spam-Status');
  const score = get(headers, 'X-Spam-Score') || get(headers, 'X-Spam-Level');
  const barracuda = get(headers, 'X-Barracuda-Spam-Score');
  const forefront = get(headers, 'X-Forefront-Antispam-Report');
  const microsoftScl = get(headers, 'X-MS-Exchange-Organization-SCL');

  const out = {};
  if (status) {
    out.spamassassin = {
      flagged: /^yes/i.test(status),
      score: parseFloat(status.match(/score=(-?[\d.]+)/i)?.[1] ?? 'NaN'),
      required: parseFloat(status.match(/required=(-?[\d.]+)/i)?.[1] ?? 'NaN'),
      tests: (status.match(/tests=([^\s]+)/i)?.[1] || '').split(',').filter(Boolean),
    };
  }
  if (!out.spamassassin && score) {
    const numeric = parseFloat(String(score).replace(/[^\d.-]/g, ''));
    if (!Number.isNaN(numeric)) out.spamassassin = { score: numeric, tests: [] };
  }
  if (barracuda) out.barracuda = parseFloat(barracuda);
  if (microsoftScl) out.microsoft_scl = parseInt(microsoftScl, 10);
  if (forefront) {
    const scl = forefront.match(/\bSCL:(-?\d+)/i)?.[1];
    if (scl && out.microsoft_scl === undefined) out.microsoft_scl = parseInt(scl, 10);
    out.forefront = forefront.slice(0, 300);
  }
  return out;
}

export function analyzeHeaders(raw) {
  const headers = parseHeaders(raw);
  if (!headers.length) {
    return { ok: false, error: 'No headers found. Paste the full message source, starting at the Received: lines.' };
  }

  const findings = [];
  const add = (severity, weight, title, detail, fix) => findings.push({ severity, weight, title, detail, fix });

  const from = get(headers, 'From');
  const fromAddr = addressIn(from);
  const fromDomain = domainOf(fromAddr);
  const returnPath = addressIn(get(headers, 'Return-Path'));
  const returnDomain = domainOf(returnPath);
  const replyTo = addressIn(get(headers, 'Reply-To'));
  const auth = parseAuthResults(getAll(headers, 'Authentication-Results'));
  const dkimSignatures = getAll(headers, 'DKIM-Signature').map((sig) => ({
    domain: sig.match(/\bd\s*=\s*([^;\s]+)/i)?.[1]?.toLowerCase() || null,
    selector: sig.match(/\bs\s*=\s*([^;\s]+)/i)?.[1] || null,
    algorithm: sig.match(/\ba\s*=\s*([^;\s]+)/i)?.[1] || null,
    canonicalization: sig.match(/\bc\s*=\s*([^;\s]+)/i)?.[1] || null,
  }));
  const hops = parseReceived(getAll(headers, 'Received'));
  const spam = parseSpamScore(headers);
  const arcSeals = getAll(headers, 'ARC-Seal').length;

  // ---- Authentication ------------------------------------------------------
  const verdict = (name, entry, weight) => {
    if (!entry) {
      add('warning', weight / 2, `No ${name.toUpperCase()} result recorded`,
        `The receiving server did not report a ${name} verdict in Authentication-Results.`,
        'If this came from Gmail, make sure you pasted the whole original message.');
      return;
    }
    const r = entry.result;
    if (r === 'pass') add('pass', 0, `${name.toUpperCase()} passed`, entry.detail || '');
    else if (r === 'none') {
      add('critical', weight, `${name.toUpperCase()} = none`,
        `No ${name} policy was found for the sending domain.`, `Publish a ${name.toUpperCase()} record.`);
    } else if (['fail', 'permerror', 'temperror', 'softfail', 'neutral', 'policy'].includes(r)) {
      add(r === 'softfail' || r === 'neutral' ? 'warning' : 'critical',
        r === 'softfail' || r === 'neutral' ? weight / 2 : weight,
        `${name.toUpperCase()} = ${r}`, entry.detail || '',
        `Fix the ${name.toUpperCase()} configuration — this alone can send the message to spam.`);
    } else {
      add('info', 0, `${name.toUpperCase()} = ${r}`, entry.detail || '');
    }
  };

  verdict('spf', auth.spf, 20);
  verdict('dkim', auth.dkim, 20);
  verdict('dmarc', auth.dmarc, 25);

  if (auth.compauth) {
    const r = auth.compauth.result;
    add(r === 'pass' ? 'pass' : 'warning', r === 'pass' ? 0 : 10,
      `Microsoft composite authentication = ${r}`, auth.compauth.detail);
  }

  // ---- Alignment -----------------------------------------------------------
  if (fromDomain && returnDomain) {
    const aligned = registrableDomain(fromDomain) === registrableDomain(returnDomain);
    add(aligned ? 'pass' : 'warning', aligned ? 0 : 8,
      aligned ? 'Return-Path is aligned with From' : 'Return-Path does not align with From',
      `From: ${fromDomain} / Return-Path: ${returnDomain}`,
      aligned ? undefined : 'SPF alignment under DMARC compares these two. Misalignment means DMARC can only pass via DKIM.');
  }

  if (fromDomain && dkimSignatures.length) {
    const aligned = dkimSignatures.some((s) => s.domain && registrableDomain(s.domain) === registrableDomain(fromDomain));
    add(aligned ? 'pass' : 'warning', aligned ? 0 : 8,
      aligned ? 'DKIM signature is aligned with From' : 'DKIM signature domain does not match From',
      `From: ${fromDomain} / signed by: ${dkimSignatures.map((s) => s.domain).join(', ')}`,
      aligned ? undefined : 'DMARC requires the DKIM d= domain to align with the From domain.');
  }

  const weakDkim = dkimSignatures.filter((s) => /rsa-sha1/i.test(s.algorithm || ''));
  if (weakDkim.length) {
    add('warning', 5, 'DKIM uses SHA-1', 'rsa-sha1 signatures are deprecated and treated as unsigned by some receivers.',
      'Re-sign with rsa-sha256.');
  }

  // ---- Bulk-sender requirements -------------------------------------------
  const listUnsub = get(headers, 'List-Unsubscribe');
  const listUnsubPost = get(headers, 'List-Unsubscribe-Post');
  if (!listUnsub) {
    add('warning', 10, 'No List-Unsubscribe header',
      'Gmail and Yahoo require one-click unsubscribe from bulk senders, and its absence pushes recipients toward the spam button instead.',
      'Send campaigns through this platform, which adds the header automatically.');
  } else if (!listUnsubPost) {
    add('warning', 5, 'List-Unsubscribe present but not one-click',
      'The RFC 8058 List-Unsubscribe-Post header is missing, so the client shows a link rather than a native unsubscribe button.',
      'Add: List-Unsubscribe-Post: List-Unsubscribe=One-Click');
  } else {
    add('pass', 0, 'One-click unsubscribe header present', listUnsub);
  }

  if (!get(headers, 'Message-ID')) {
    add('warning', 6, 'No Message-ID', 'Missing Message-ID is a strong indicator of a script-generated message.',
      'Let your mail library generate one.');
  }
  if (!get(headers, 'Date')) add('warning', 4, 'No Date header', 'Missing Date is a bulk-mailer signal.');

  const precedence = get(headers, 'Precedence');
  if (precedence && /bulk|junk/i.test(precedence)) {
    add('info', 2, `Precedence: ${precedence}`, 'Declaring the message as bulk lowers its priority in some filters.');
  }

  if (replyTo && fromDomain && domainOf(replyTo) !== fromDomain) {
    add('info', 2, 'Reply-To points to a different domain',
      `From ${fromDomain} but replies go to ${domainOf(replyTo)}. Legitimate in some setups, but a common phishing pattern.`);
  }

  // ---- Transport -----------------------------------------------------------
  const plaintextHops = hops.filter((h) => h.by && !h.tls);
  if (plaintextHops.length) {
    add('info', 2, `${plaintextHops.length} hop(s) without TLS`,
      'Part of the path was unencrypted. Gmail shows a broken-padlock warning for these.',
      'Enable TLS on your relay.');
  }
  const slow = hops.filter((h) => h.delay_seconds > 60);
  if (slow.length) {
    add('info', 2, 'Delivery was delayed',
      `${slow.map((h) => `${h.delay_seconds}s at ${h.by || 'unknown host'}`).join(', ')}. Long delays usually mean greylisting or throttling by the receiver, which is itself a reputation signal.`);
  }

  // ---- Receiver's own verdict ---------------------------------------------
  if (spam.spamassassin && Number.isFinite(spam.spamassassin.score)) {
    const s = spam.spamassassin;
    const threshold = Number.isFinite(s.required) ? s.required : 5;
    add(s.score >= threshold ? 'critical' : s.score >= threshold - 2 ? 'warning' : 'pass',
      s.score >= threshold ? 25 : s.score >= threshold - 2 ? 10 : 0,
      `SpamAssassin score ${s.score}${Number.isFinite(s.required) ? ` (threshold ${s.required})` : ''}`,
      s.tests.length ? `Rules hit: ${s.tests.join(', ')}` : 'No rule list in the header.',
      s.score >= threshold - 2 ? 'Address the rules listed above; each one has a published meaning.' : undefined);
  }
  if (Number.isFinite(spam.microsoft_scl)) {
    const scl = spam.microsoft_scl;
    add(scl >= 5 ? 'critical' : scl >= 1 ? 'info' : 'pass', scl >= 5 ? 25 : 0,
      `Microsoft SCL ${scl}`,
      scl >= 9 ? 'Treated as high-confidence spam.'
        : scl >= 5 ? 'Treated as spam and filtered.'
          : scl >= 1 ? 'Not spam, but not trusted either.'
            : 'Treated as non-spam.');
  }
  if (arcSeals) add('info', 0, `${arcSeals} ARC seal(s)`, 'The message was forwarded through an intermediary that preserved the original authentication results.');

  const penalty = findings.reduce((s, f) => s + f.weight, 0);
  const score = Math.max(0, 100 - penalty);

  return {
    ok: true,
    score,
    verdict: score >= 85 ? 'authenticated and clean' : score >= 60 ? 'delivered with warnings' : 'serious problems',
    from,
    from_domain: fromDomain,
    to: get(headers, 'To'),
    subject: get(headers, 'Subject'),
    date: get(headers, 'Date'),
    message_id: get(headers, 'Message-ID'),
    return_path: returnPath,
    reply_to: replyTo,
    auth,
    dkim_signatures: dkimSignatures,
    list_unsubscribe: listUnsub,
    one_click: !!listUnsubPost,
    spam,
    hops,
    header_count: headers.length,
    findings: findings.sort((a, b) => b.weight - a.weight),
  };
}
