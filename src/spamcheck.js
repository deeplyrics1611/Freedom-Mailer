// Flag copy that lands in junk or looks like credential theft.
// Scrub replaces risky phrases with milder wording. It does not hide mail from filters.

const PUBLIC_SHORTENERS = new Set([
  'bit.ly', 't.co', 'tinyurl.com', 'goo.gl', 'ow.ly', 'is.gd', 'buff.ly',
  'rebrand.ly', 'cutt.ly', 'shorturl.at', 'tiny.cc', 'rb.gy', 'lnkd.in',
]);

const BLOCK_RULES = [
  {
    id: 'verify-brand-account',
    re: /verify\s+your\s+(microsoft|office\s*365|google|gmail|apple|icloud|paypal|amazon|docusign|adobe|zoom|bank)\s+account/i,
    note: 'Asking people to verify a third-party account is credential theft copy.',
  },
  {
    id: 'confirm-password',
    re: /confirm\s+your\s+(password|login|credentials)|enter\s+your\s+(password|pin|ssn|social\s+security)/i,
    note: 'Password / credential harvest language is blocked.',
  },
  {
    id: 'account-locked',
    re: /your\s+(microsoft|office\s*365|google|apple|paypal|amazon|bank)\s+account\s+(has\s+been\s+)?(suspended|locked|compromised|disabled)/i,
    note: 'Fake account-lock scare copy impersonates another brand.',
  },
  {
    id: 'docusign-clone',
    re: /docusign\s+(is\s+)?waiting|documents?\s+awaiting\s+your\s+signature.*(docusign|adobe\s*sign)|review\s+and\s+sign\s+in\s+docusign/i,
    note: 'DocuSign / Adobe Sign clone wording is blocked.',
  },
  {
    id: 'prize-claim',
    re: /claim\s+your\s+(prize|reward|inheritance|unclaimed\s+funds)|you('ve| have)\s+(been\s+)?selected\s+(as\s+)?(a\s+)?winner|dear\s+beneficiary/i,
    note: 'Prize / inheritance claim copy is treated as fraud.',
  },
  {
    id: 'wire-gift',
    re: /pay\s+(by\s+)?(wire\s+transfer|gift\s+cards?)|buy\s+gift\s+cards?\s+(and|to)\s+(send|pay)|western\s+union\s+(payment|transfer)/i,
    note: 'Wire / gift-card payment requests are blocked.',
  },
  {
    id: 'crypto-giveaway',
    re: /crypto\s+giveaway|send\s+(eth|btc|usdt|bitcoin)|double\s+your\s+(btc|bitcoin|crypto)/i,
    note: 'Crypto giveaway / double-your-coin copy is blocked.',
  },
];

const RISKY_PHRASES = [
  { id: 'act-now', re: /\bact\s+now\b/i, phrase: 'act now', replace: 'when you have a moment', note: 'Urgency bait.' },
  { id: 'limited-time', re: /\blimited\s+time(\s+offer)?\b/i, phrase: 'limited time', replace: 'this period', note: 'Scarcity bait.' },
  { id: 'click-here', re: /\bclick\s+here\b/i, phrase: 'click here', replace: 'open this link', note: '“Click here” is a classic junk-mail phrase.' },
  { id: 'buy-now', re: /\bbuy\s+now\b/i, phrase: 'buy now', replace: 'view details', note: 'Hard-sell CTA.' },
  { id: 'order-now', re: /\border\s+now\b/i, phrase: 'order now', replace: 'place an order', note: 'Hard-sell CTA.' },
  { id: 'apply-now', re: /\bapply\s+now\b/i, phrase: 'apply now', replace: 'apply', note: 'Urgency CTA.' },
  { id: 'congratulations', re: /\bcongratulations\b/i, phrase: 'congratulations', replace: 'good news', note: 'Prize-style opener.' },
  { id: 'winner', re: /\b(you\s+are\s+a\s+)?winner\b/i, phrase: 'winner', replace: 'selected', note: 'Lottery-style wording.' },
  { id: 'guaranteed', re: /\bguaranteed\b/i, phrase: 'guaranteed', replace: 'we expect', note: 'Absolute claims trip filters.' },
  { id: 'risk-free', re: /\brisk[\s-]?free\b/i, phrase: 'risk free', replace: 'no pressure', note: 'Promo cliché.' },
  { id: '100-free', re: /\b100%\s*free\b/i, phrase: '100% free', replace: 'no charge', note: '“100% free” is a junk trigger.' },
  { id: 'absolutely-free', re: /\babsolutely\s+free\b/i, phrase: 'absolutely free', replace: 'no charge', note: 'Promo cliché.' },
  { id: 'free-gift', re: /\bfree\s+gift\b/i, phrase: 'free gift', replace: 'included extra', note: 'Free-gift bait.' },
  { id: 'free-money', re: /\bfree\s+money\b/i, phrase: 'free money', replace: 'funding', note: 'Too-good-to-be-true phrasing.' },
  { id: 'urgent', re: /\burgent\b/i, phrase: 'urgent', replace: 'time-sensitive', note: 'Urgency bait.' },
  { id: 'immediately', re: /\bimmediately\b/i, phrase: 'immediately', replace: 'soon', note: 'Pressure wording.' },
  { id: 'as-seen-on', re: /\bas\s+seen\s+on\b/i, phrase: 'as seen on', replace: '', note: 'Infomercial phrasing.' },
  { id: 'extra-income', re: /\bextra\s+income\b/i, phrase: 'extra income', replace: 'additional revenue', note: 'Get-rich phrasing.' },
  { id: 'make-money', re: /\bmake\s+money\b/i, phrase: 'make money', replace: 'grow revenue', note: 'Get-rich phrasing.' },
  { id: 'cash-bonus', re: /\bcash\s+bonus\b/i, phrase: 'cash bonus', replace: 'bonus', note: 'Promo bait.' },
  { id: 'not-spam', re: /\bthis\s+is\s+not\s+spam\b/i, phrase: 'this is not spam', replace: '', note: 'Saying it is not spam is a spam signal.' },
  { id: 'dear-friend', re: /\bdear\s+friend\b/i, phrase: 'dear friend', replace: 'hello', note: 'Generic blast greeting.' },
  { id: 'once-lifetime', re: /\bonce\s+in\s+a\s+lifetime\b/i, phrase: 'once in a lifetime', replace: 'unusual', note: 'Hype phrasing.' },
  { id: 'no-credit', re: /\bno\s+credit\s+check\b/i, phrase: 'no credit check', replace: '', note: 'Credit-offer bait.' },
  { id: 'double-your', re: /\bdouble\s+your\b/i, phrase: 'double your', replace: 'grow your', note: 'Hype claim.' },
  { id: 'lowest-price', re: /\blowest\s+price\b/i, phrase: 'lowest price', replace: 'current price', note: 'Superative pricing claim.' },
  { id: 'increase-sales', re: /\bincrease\s+sales\b/i, phrase: 'increase sales', replace: 'grow sales', note: 'Blast-offer phrasing.' },
  { id: 'miracle', re: /\bmiracle\b/i, phrase: 'miracle', replace: '', note: 'Miracle claims trip health/promo filters.' },
  { id: 'weight-loss', re: /\bweight[\s-]?loss\b/i, phrase: 'weight loss', replace: '', note: 'Health-spam category.' },
  { id: 'pharma', re: /\b(viagra|cialis|levitra|phentermine)\b/i, phrase: 'pharma', replace: '', note: 'Pharmaceutical spam category.' },
  { id: 'casino', re: /\b(casino|jackpot|lottery\s+winner)\b/i, phrase: 'casino/lottery', replace: '', note: 'Gambling spam category.' },
  { id: 'unsub-subject', re: /\bunsubscribe\b/i, phrase: 'unsubscribe', replace: null, note: '“Unsubscribe” in the subject looks like a blast.', where: 'subject' },
];

function stripTags(html) {
  return String(html || '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function mapHtmlText(html, fn) {
  return String(html || '')
    .split(/(<[^>]+>)/g)
    .map((part) => (part.startsWith('<') ? part : fn(part)))
    .join('');
}

function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function extractUrls(text) {
  return String(text || '').match(/https?:\/\/[^\s"'<>]+/gi) || [];
}

function pushHit(hits, hit) {
  if (hits.some((h) => h.id === hit.id && h.where === hit.where && h.phrase === hit.phrase)) return;
  hits.push(hit);
}

function scanField(hits, where, value) {
  const text = String(value || '');
  if (!text) return;
  for (const rule of BLOCK_RULES) {
    if (rule.re.test(text)) {
      pushHit(hits, {
        id: rule.id,
        severity: 'block',
        where,
        phrase: (text.match(rule.re) || [rule.id])[0],
        note: rule.note,
      });
    }
  }
  for (const rule of RISKY_PHRASES) {
    if (rule.where && rule.where !== where) continue;
    if (rule.re.test(text)) {
      pushHit(hits, {
        id: rule.id,
        severity: 'risky',
        where,
        phrase: rule.phrase,
        note: rule.note,
        replace: rule.replace,
      });
    }
  }
}

function structureHits(html, where = 'html') {
  const hits = [];
  const raw = String(html || '');
  if (!raw) return hits;
  if (/<script\b/i.test(raw) || /javascript\s*:/i.test(raw) || /\son\w+\s*=/i.test(raw)) {
    hits.push({
      id: 'html-script',
      severity: 'risky',
      where,
      phrase: 'script / event handler',
      note: 'Scripts and on* handlers in HTML are stripped by many filters and look hostile.',
    });
  }
  if (/<iframe\b/i.test(raw) || /<object\b/i.test(raw) || /<embed\b/i.test(raw)) {
    hits.push({
      id: 'html-embed',
      severity: 'risky',
      where,
      phrase: 'iframe / embed',
      note: 'Embedded frames are rarely needed in a letter and often blocked.',
    });
  }
  if (/display\s*:\s*none/i.test(raw) || /font-size\s*:\s*0/i.test(raw) || /visibility\s*:\s*hidden/i.test(raw)) {
    hits.push({
      id: 'hidden-text',
      severity: 'risky',
      where,
      phrase: 'hidden text',
      note: 'Hidden text is a filter-evasion signal.',
    });
  }
  const imgs = raw.match(/<img\b/gi) || [];
  const textLen = stripTags(raw).length;
  if (imgs.length >= 2 && textLen < 80) {
    hits.push({
      id: 'image-heavy',
      severity: 'risky',
      where,
      phrase: 'image-heavy letter',
      note: 'Mostly images with little text scores like a blast.',
    });
  }
  const links = raw.match(/<a\b[^>]*href=/gi) || [];
  if (links.length > 8) {
    hits.push({
      id: 'too-many-links',
      severity: 'risky',
      where,
      phrase: `${links.length} links`,
      note: 'More than eight links looks like a newsletter blast.',
    });
  }
  if (/<input[^>]+type\s*=\s*["']?password/i.test(raw)) {
    hits.push({
      id: 'password-field',
      severity: 'block',
      where,
      phrase: 'password field',
      note: 'A password field in email HTML is credential harvest UI.',
    });
  }
  for (const url of extractUrls(raw)) {
    const host = hostOf(url);
    const root = host.split('.').slice(-2).join('.');
    if (PUBLIC_SHORTENERS.has(host) || PUBLIC_SHORTENERS.has(root)) {
      hits.push({
        id: 'public-shortener',
        severity: 'risky',
        where,
        phrase: host,
        note: 'Public shorteners (bit.ly, t.co, …) score poorly. Use a host you own.',
      });
      break;
    }
  }
  return hits;
}

function subjectStyleHits(subject) {
  const hits = [];
  const s = String(subject || '');
  if (!s) return hits;
  const letters = s.replace(/[^A-Za-z]/g, '');
  const upper = letters.replace(/[^A-Z]/g, '');
  if (letters.length >= 8 && upper.length / letters.length >= 0.7) {
    hits.push({
      id: 'all-caps-subject',
      severity: 'risky',
      where: 'subject',
      phrase: s,
      note: 'ALL-CAPS subjects look like blasts.',
      replace: s.replace(/[A-Z]/g, (ch, i, str) => (i === 0 || str[i - 1] === ' ' ? ch : ch.toLowerCase())),
    });
  }
  const bangs = (s.match(/!/g) || []).length;
  if (bangs >= 3) {
    hits.push({
      id: 'too-many-bangs',
      severity: 'risky',
      where: 'subject',
      phrase: '!'.repeat(bangs),
      note: 'Repeated exclamation marks are a junk signal.',
      replace: s.replace(/!{2,}/g, '!').replace(/!/g, (ch, i, str) => (str.indexOf('!') === i ? '!' : '')),
    });
  }
  if ((s.match(/\$/g) || []).length >= 3 || /\$\$+/.test(s)) {
    hits.push({
      id: 'money-symbols',
      severity: 'risky',
      where: 'subject',
      phrase: '$$$',
      note: 'Stacked $ signs look like promo spam.',
    });
  }
  return hits;
}

export function analyzeContent({ subject = '', html = '', text = '', attachments = [], attachment_html = [] } = {}) {
  const hits = [];
  scanField(hits, 'subject', subject);
  scanField(hits, 'html', stripTags(html));
  scanField(hits, 'text', text);
  hits.push(...subjectStyleHits(subject));
  hits.push(...structureHits(html, 'html'));

  const extraHtml = [
    ...attachment_html.map(String),
    ...htmlFromMaybe(attachments),
  ];
  extraHtml.forEach((chunk, i) => {
    const where = `attachment:${i + 1}`;
    scanField(hits, where, stripTags(chunk));
    hits.push(...structureHits(chunk, where));
  });

  const block = hits.filter((h) => h.severity === 'block');
  const risky = hits.filter((h) => h.severity === 'risky');
  const score = block.length * 100 + risky.length * 10;
  let verdict = 'ok';
  if (block.length) verdict = 'block';
  else if (risky.length) verdict = 'risky';

  return {
    verdict,
    score,
    ok: verdict === 'ok',
    can_send: verdict !== 'block',
    hits,
    block_count: block.length,
    risky_count: risky.length,
    summary:
      verdict === 'block'
        ? 'Blocked: this copy looks like credential theft or fraud. Rewrite it.'
        : verdict === 'risky'
          ? `Risky: ${risky.length} phrase(s) often land in junk. Strip or rewrite them.`
          : 'No common junk phrases found.',
  };
}

function htmlFromMaybe(list) {
  const out = [];
  for (const a of list || []) {
    const type = String(a.content_type || a.contentType || '');
    if (!type.includes('html') && !/\.html?$/i.test(a.filename || '')) continue;
    const raw = a.content || a.content_base64;
    if (!raw) continue;
    try {
      out.push(Buffer.from(String(raw).replace(/^data:[^;]+;base64,/, ''), 'base64').toString('utf8'));
    } catch {
      /* skip */
    }
  }
  return out;
}

export function scrubContent({ subject = '', html = '', text = '' } = {}) {
  const replaced = [];

  function apply(value, where) {
    let next = String(value || '');
    for (const rule of RISKY_PHRASES) {
      if (rule.replace == null) continue;
      if (rule.where && rule.where !== where) continue;
      if (!rule.re.test(next)) continue;
      next = next.replace(rule.re, rule.replace);
      if (!replaced.some((r) => r.id === rule.id)) {
        replaced.push({ id: rule.id, phrase: rule.phrase, replace: rule.replace, where });
      }
    }
    return next;
  }

  let nextSubject = apply(subject, 'subject');
  const style = subjectStyleHits(subject);
  for (const hit of style) {
    if (hit.id === 'all-caps-subject' && hit.replace) {
      nextSubject = hit.replace;
      replaced.push({ id: hit.id, phrase: 'ALL CAPS', replace: hit.replace, where: 'subject' });
    }
    if (hit.id === 'too-many-bangs') {
      nextSubject = nextSubject.replace(/!{2,}/g, '!').replace(/!(?=.*!)/g, '');
      replaced.push({ id: hit.id, phrase: '!!!', replace: '!', where: 'subject' });
    }
    if (hit.id === 'money-symbols') {
      nextSubject = nextSubject.replace(/\$+/g, '');
      replaced.push({ id: hit.id, phrase: '$$$', replace: '', where: 'subject' });
    }
  }

  const nextHtml = mapHtmlText(html, (part) => apply(part, 'html'));
  const nextText = apply(text, 'text');
  const after = analyzeContent({ subject: nextSubject, html: nextHtml, text: nextText });

  return {
    subject: nextSubject,
    html: nextHtml,
    text: nextText,
    replaced,
    report: after,
  };
}

export function sendBlockError(report) {
  if (!report || report.can_send) return null;
  const first = report.hits.find((h) => h.severity === 'block');
  return first?.note || report.summary;
}
