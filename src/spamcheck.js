import { extractPlaceholders } from './placeholders.js';

const SPAM_WORDS = [
  'act now', 'apply now', 'buy now', 'call now', 'click here', 'click below',
  'congratulations', 'dear friend', 'double your', 'earn extra', 'free money',
  'guaranteed', 'increase sales', 'limited time', 'make money', 'million dollars',
  'no obligation', 'once in a lifetime', 'order now', 'priority mail',
  'risk free', 'special promotion', 'this is not spam', 'urgent', 'winner',
  'viagra', 'cialis', 'casino', 'crypto giveaway', 'wire transfer',
  'you have been selected', 'work from home', 'weight loss',
];

const SHORTENERS = [
  'bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'ow.ly', 'is.gd', 'buff.ly',
  'rebrand.ly', 'cutt.ly', 'rb.gy', 'shorturl.at', 'tiny.cc', 'lnkd.in',
];

function textFromHtml(html) {
  return String(html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function issue(severity, code, message, points) {
  return { severity, code, message, points };
}

/**
 * Heuristic spam / filter check (SpamAssassin-style points, lower is better).
 * Not a live filter verdict — flags patterns that commonly trip Gmail/Outlook.
 */
export function checkSpam({ subject = '', html = '', text = '', fromName = '', fromEmail = '' } = {}) {
  const issues = [];
  const htmlStr = String(html || '');
  const textStr = String(text || '').trim() || textFromHtml(htmlStr);
  const sub = String(subject || '');
  const combined = `${sub} ${textStr}`.toLowerCase();

  let points = 0;
  const add = (sev, code, message, pts) => {
    issues.push(issue(sev, code, message, pts));
    points += pts;
  };

  if (!sub.trim()) add('high', 'no_subject', 'Missing subject line.', 2.5);
  if (sub.length > 120) add('medium', 'subject_long', 'Subject is very long (>120 chars). Filters and mobile previews punish this.', 0.8);
  if (sub.length > 0 && sub.length < 8) add('low', 'subject_short', 'Subject is very short; add a specific RFQ detail.', 0.3);
  if (sub === sub.toUpperCase() && /[A-Z]/.test(sub) && sub.length > 8) {
    add('high', 'subject_caps', 'Subject is ALL CAPS — a classic spam signal.', 2.0);
  }
  if ((sub.match(/!/g) || []).length >= 2) add('medium', 'subject_bang', 'Multiple exclamation marks in the subject.', 1.2);
  if (/\$|free|winner|urgent|act now/i.test(sub)) {
    add('high', 'subject_spammy', 'Subject uses words/symbols that spam filters weight heavily (free, urgent, $, winner).', 1.8);
  }
  if (/re:\s|fwd:/i.test(sub)) add('medium', 'fake_thread', 'Subject looks like a fake reply/forward. Cold RFQs should not impersonate a thread.', 1.5);

  const spamHits = SPAM_WORDS.filter((w) => combined.includes(w));
  if (spamHits.length) {
    add('high', 'spam_phrases', `Spam-trigger phrases: ${spamHits.slice(0, 6).join(', ')}.`, Math.min(3, spamHits.length * 0.7));
  }

  if (!textStr || textStr.length < 40) add('high', 'too_short', 'Body is very short. Image-only or one-liners often land in spam.', 1.5);
  if (htmlStr && !String(text || '').trim()) {
    add('medium', 'no_text_part', 'No plain-text alternative. Provide a text part for better inbox placement.', 0.8);
  }

  const imgCount = (htmlStr.match(/<img\b/gi) || []).length;
  if (imgCount >= 5) add('medium', 'many_images', `Many images (${imgCount}). Keep RFQs mostly text.`, 1.0);
  if (imgCount && textStr.length < 80) add('high', 'image_heavy', 'Image-heavy with little text — looks like a blast.', 1.6);

  if (/<script/i.test(htmlStr)) add('high', 'javascript', 'JavaScript in HTML is blocked by almost every filter.', 3.0);
  if (/<form/i.test(htmlStr)) add('high', 'html_form', 'HTML forms in email are a spam/phishing signal.', 2.5);
  if (/<iframe/i.test(htmlStr)) add('high', 'iframe', 'iframes in email are not allowed.', 2.5);
  if (/javascript:/i.test(htmlStr)) add('high', 'js_url', 'javascript: URLs are treated as malicious.', 3.0);

  if (/color\s*:\s*#fff|color\s*:\s*white|font-size\s*:\s*[0-4]px/i.test(htmlStr)) {
    add('high', 'hidden_text', 'Hidden/tiny/white-on-white text is a hard spam rule.', 2.2);
  }

  const hrefs = [...htmlStr.matchAll(/href\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]);
  const shortHits = hrefs.filter((h) => SHORTENERS.some((s) => h.toLowerCase().includes(s)));
  if (shortHits.length) add('high', 'short_urls', 'URL shorteners are heavily penalized in cold mail. Use the full destination URL.', 2.0);
  if (hrefs.length > 8) add('medium', 'many_links', `High link count (${hrefs.length}). Cold RFQs should have 1–3 links max.`, 1.0);

  const httpLinks = hrefs.filter((h) => /^http:\/\//i.test(h));
  if (httpLinks.length) add('medium', 'http_links', 'Non-HTTPS links look untrustworthy.', 0.6);

  if (/dear (friend|sir|madam|customer)/i.test(textStr)) {
    add('medium', 'generic_greeting', 'Generic greeting ("Dear friend/sir"). Use {{first_name}}.', 0.8);
  }

  const ph = extractPlaceholders(`${sub}\n${htmlStr}\n${textStr}`);
  if (!ph.includes('first_name') && !ph.includes('name') && !ph.includes('company')) {
    add('low', 'no_personalization', 'No name/company placeholders — personalized RFQs place better and convert better.', 0.2);
  }

  if (fromName && /http|www\.|\d{5,}/i.test(fromName)) {
    add('medium', 'odd_from_name', 'From name looks promotional or includes a URL/number dump.', 0.7);
  }
  if (fromEmail && /noreply|no-reply|donotreply/i.test(fromEmail)) {
    add('medium', 'noreply', 'noreply@ from-addresses hurt replies and look automated.', 0.6);
  }

  const redFlags = (htmlStr.match(/!\s*!/g) || []).length;
  if (redFlags >= 3) add('low', 'punctuation', 'Excessive punctuation in the HTML.', 0.4);

  const score = Math.round(Math.min(15, points) * 10) / 10;
  let verdict = 'pass';
  if (score >= 5) verdict = 'fail';
  else if (score >= 2) verdict = 'warn';

  return {
    score,
    verdict,
    label: verdict === 'pass' ? 'Looks clean' : verdict === 'warn' ? 'Needs cleanup' : 'Likely filtered',
    issues,
    stats: {
      subjectLength: sub.length,
      textLength: textStr.length,
      images: imgCount,
      links: hrefs.length,
      placeholders: ph,
    },
  };
}
