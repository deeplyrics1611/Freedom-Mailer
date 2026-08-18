import * as cheerio from 'cheerio';
import { URL_SHORTENERS } from './address-data.js';
import { registrableDomain } from './dnsx.js';

// Static analysis of an email before it is sent: the content heuristics that
// SpamAssassin-style filters and the big providers react to, plus the HTML
// compatibility problems that make a message render badly (which itself hurts
// engagement and therefore placement).
//
// This predicts problems; it cannot predict a specific provider's decision.
// Reputation, list quality and engagement matter more than any of these rules.

// Phrases weighted by how strongly they correlate with filtered mail. Money,
// urgency and "act now" language are the classic clusters.
const SPAM_PHRASES = [
  [2.0, /\b(viagra|cialis|pharmacy online|xanax|valium)\b/i, 'pharmaceutical spam terms'],
  [2.0, /\b(nigerian prince|inheritance fund|unclaimed funds|beneficiary of)\b/i, 'advance-fee fraud language'],
  [1.5, /\b(make money fast|get rich quick|earn \$\d|\$\d+[,\d]* per (day|week|hour)|double your (income|money))\b/i, 'income claims'],
  [1.5, /\b(100% (free|guaranteed|satisfied)|risk[- ]free|no (cost|fees|catch|obligation)|money[- ]back guarantee)\b/i, 'too-good-to-be-true guarantees'],
  [1.2, /\b(act now|urgent|immediate(ly)?|expires? (today|tomorrow|soon)|limited time|don'?t (delay|miss)|last chance|final notice|hurry)\b/i, 'artificial urgency'],
  [1.2, /\b(winner|you'?ve won|congratulations you|claim your prize|free gift|prize|lottery)\b/i, 'prize/winner language'],
  [1.0, /\b(click here|click below|click this link|open (this )?attachment)\b/i, 'vague "click here" calls to action'],
  [1.0, /\b(no credit check|bad credit|credit repair|consolidate (your )?debt|refinance|lower your (mortgage|rate))\b/i, 'credit/loan offers'],
  [1.0, /\b(work from home|be your own boss|extra income|financial freedom|passive income|multi[- ]level marketing)\b/i, 'work-from-home offers'],
  [0.8, /\b(this is not spam|not a scam|this isn'?t spam|remove me|opt[- ]?out below)\b/i, 'protesting that it is not spam'],
  [0.8, /\b(dear (friend|sir|madam|customer|user|valued)|to whom it may concern)\b/i, 'generic impersonal salutation'],
  [0.8, /\b(increase (sales|traffic|revenue) (by )?\d+%|guaranteed results|#1 (ranked|rated))\b/i, 'unverifiable performance claims'],
  [0.6, /\b(cheap|discount|lowest price|best price|save (up to )?\$?\d+%?|special promotion|order now|buy (now|direct))\b/i, 'hard-sell price language'],
  [0.6, /\b(bulk email|mass email|email marketing|opt[- ]in list|subscribers? list for sale)\b/i, 'bulk-mailing terminology'],
  [0.5, /\b(crypto(currency)?|bitcoin|forex|investment opportunity|high return|guaranteed profit)\b/i, 'speculative investment terms'],
  [0.5, /\b(unsecured (loan|credit)|pre[- ]?approved|apply (now|online) )\b/i, 'pre-approval language'],
];

const SUBJECT_SPAM = [
  [1.5, /^\s*(re|fw|fwd)\s*:/i, 'Fake "Re:" or "Fwd:" prefix on a first-contact email'],
  [1.0, /[!?]{2,}/, 'Repeated exclamation or question marks'],
  [1.0, /\$\$|\$\d|£\d|€\d/, 'Currency amounts in the subject line'],
  [0.8, /\b(free|urgent|winner|cash|guaranteed|act now|limited time)\b/i, 'Classic trigger word in the subject line'],
  [0.6, /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u, 'Emoji in the subject line'],
];

const HIDDEN_STYLE = /(display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0(\.0+)?\b|font-size\s*:\s*0(px|pt)?\b|text-indent\s*:\s*-\d{3,})/i;
const WHITE_TEXT = /color\s*:\s*(#f{3,6}\b|white|rgb\(\s*255\s*,\s*255\s*,\s*255\s*\))/i;

const UNSUPPORTED_CSS = [
  ['display:flex', /display\s*:\s*(inline-)?flex/i, 'Flexbox is ignored by Outlook on Windows.'],
  ['display:grid', /display\s*:\s*(inline-)?grid/i, 'CSS Grid is ignored by Outlook on Windows.'],
  ['position', /position\s*:\s*(absolute|fixed|sticky)/i, 'Positioning is unsupported in Outlook and Gmail strips it.'],
  ['float', /float\s*:\s*(left|right)/i, 'Floats are unreliable in Outlook; use table cells.'],
  ['background-image', /background-image\s*:/i, 'Background images need VML fallbacks to show in Outlook.'],
  ['@media', /@media/i, 'Media queries are ignored in a few clients (Gmail app with non-Gmail accounts).'],
  ['transform', /transform\s*:/i, 'CSS transforms are unsupported in most email clients.'],
  ['animation', /(animation|@keyframes|transition)\s*:?/i, 'Animations are unsupported or stripped in most clients.'],
  ['custom-properties', /var\(--/i, 'CSS custom properties are unsupported in Outlook.'],
];

const px = (v) => parseInt(String(v).replace(/[^\d]/g, ''), 10) || 0;

export function extractLinks(html = '', text = '') {
  const urls = new Map();
  if (html) {
    const $ = cheerio.load(html);
    $('a[href]').each((_, a) => {
      const href = ($(a).attr('href') || '').trim();
      if (!/^https?:\/\//i.test(href)) return;
      if (!urls.has(href)) urls.set(href, { url: href, anchorText: $(a).text().trim().slice(0, 120) });
    });
  }
  for (const m of String(text || '').matchAll(/https?:\/\/[^\s<>"')\]]+/gi)) {
    const href = m[0].replace(/[.,;:]+$/, '');
    if (!urls.has(href)) urls.set(href, { url: href, anchorText: '' });
  }
  return [...urls.values()];
}

function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/**
 * Analyse a message body. `mode` is 'outreach' for cold email (where CAN-SPAM
 * identification rules apply and a plain, link-light message performs best) or
 * 'optin' for mail to a confirmed list.
 */
export function analyzeContent(input = {}) {
  const {
    subject = '', html = '', text = '', fromName = '', fromEmail = '',
    postalAddress = '', mode = 'outreach', sendingDomain = '',
  } = input;

  const issues = [];
  const add = (severity, points, id, title, detail, fix) =>
    issues.push({ id, severity, points: Number(points.toFixed(2)), title, detail, fix });

  const $ = html ? cheerio.load(html) : null;
  const htmlText = $ ? $.root().text().replace(/\s+/g, ' ').trim() : '';
  const bodyText = (text || '').trim();
  const readable = htmlText || bodyText;
  const words = readable ? readable.split(/\s+/).filter(Boolean) : [];
  const links = extractLinks(html, text);
  const images = $ ? $('img').toArray() : [];
  const htmlBytes = Buffer.byteLength(html || '', 'utf8');

  const stats = {
    words: words.length,
    characters: readable.length,
    html_bytes: htmlBytes,
    links: links.length,
    images: images.length,
    subject_length: subject.length,
    has_html: !!html,
    has_text: !!bodyText,
    reading_seconds: Math.round((words.length / 200) * 60),
  };

  // ---- Compliance ----------------------------------------------------------
  const combined = `${html}\n${text}`;
  const hasUnsub = /unsubscribe|opt[- ]?out|stop receiving|remove me from/i.test(combined);
  if (!hasUnsub) {
    add('critical', 2.5, 'no_unsubscribe', 'No opt-out mechanism',
      'Nothing in the message tells the recipient how to stop hearing from you.',
      'Add a visible unsubscribe link. This platform appends one automatically for campaigns; keep it in place.');
  } else {
    add('pass', 0, 'unsubscribe_ok', 'Opt-out present', 'The message offers a way to stop receiving mail.');
  }

  if (mode === 'outreach') {
    const hasAddress = postalAddress.trim().length > 8 ||
      /\d{1,5}\s+\w+.*\b(st|street|ave|avenue|rd|road|blvd|suite|ste|floor|fl|unit|way|lane|ln|dr|drive)\b/i.test(combined);
    if (!hasAddress) {
      add('critical', 1.5, 'no_postal_address', 'No physical postal address',
        'CAN-SPAM requires a valid physical postal address in every commercial email, and its absence is a filter signal.',
        'Set a postal address on the campaign so it is added to the footer.');
    } else {
      add('pass', 0, 'postal_ok', 'Postal address present', 'A physical address is included, as CAN-SPAM requires.');
    }
  }

  // ---- Subject -------------------------------------------------------------
  if (!subject.trim()) {
    add('critical', 2, 'no_subject', 'Empty subject line', 'Messages with no subject are filtered almost universally.',
      'Write a short, specific subject.');
  } else {
    if (subject.length > 70) {
      add('warning', 0.5, 'subject_long', 'Subject line is long',
        `${subject.length} characters — mobile clients show roughly the first 35-40.`,
        'Aim for 30-50 characters and put the specific ask first.');
    } else if (subject.length < 15) {
      add('info', 0.2, 'subject_short', 'Very short subject line',
        `${subject.length} characters can read as low effort or automated.`,
        'Say what you want, e.g. "Quote request: 500x M8 stainless bolts".');
    } else {
      add('pass', 0, 'subject_length_ok', 'Subject length is reasonable', `${subject.length} characters.`);
    }

    const letters = subject.replace(/[^A-Za-z]/g, '');
    const caps = subject.replace(/[^A-Z]/g, '');
    if (letters.length > 6 && caps.length / letters.length > 0.6) {
      add('warning', 1.2, 'subject_caps', 'Subject is mostly capital letters',
        'Shouting in the subject line is one of the oldest and most reliable spam signals.',
        'Use sentence case.');
    }
    for (const [points, re, label] of SUBJECT_SPAM) {
      if (re.test(subject)) {
        const critical = /Fake "Re:"/.test(label);
        add(critical ? 'critical' : 'warning', points, `subject_${label.slice(0, 12).replace(/\W+/g, '_').toLowerCase()}`,
          label,
          critical
            ? 'Faking a reply to a conversation that never happened is deceptive under CAN-SPAM and is heavily penalised.'
            : 'This pattern is common in filtered mail.',
          critical ? 'Remove the Re:/Fwd: prefix and write an honest subject.' : 'Rewrite the subject in plain language.');
      }
    }
  }

  // ---- Body copy -----------------------------------------------------------
  let phraseHits = [];
  for (const [points, re, label] of SPAM_PHRASES) {
    const m = combined.match(re);
    if (m) phraseHits.push({ points, label, example: m[0].slice(0, 60) });
  }
  if (phraseHits.length) {
    const total = Math.min(4, phraseHits.reduce((s, h) => s + h.points, 0));
    add(total >= 2 ? 'critical' : 'warning', total, 'spam_phrases',
      `${phraseHits.length} spam-associated phrase${phraseHits.length > 1 ? 's' : ''}`,
      phraseHits.map((h) => `"${h.example}" — ${h.label}`).join('; '),
      'Rewrite these in plain, specific business language.');
  } else {
    add('pass', 0, 'phrases_ok', 'No spam-associated phrases', 'The copy avoids the usual trigger vocabulary.');
  }

  const exclamations = (combined.match(/!/g) || []).length;
  if (exclamations > 3) {
    add('warning', Math.min(1, exclamations * 0.15), 'exclamations',
      `${exclamations} exclamation marks`, 'Heavy exclamation use correlates strongly with promotional spam.',
      'Keep at most one.');
  }

  if (words.length && words.length < 30) {
    add('warning', 0.6, 'too_short', 'Very little text',
      `${words.length} words. Short image-led or link-only messages give filters nothing legitimate to weigh.`,
      'Write at least a few sentences of real text.');
  } else if (words.length > 400) {
    add('info', 0.3, 'too_long', 'Long message',
      `${words.length} words (~${Math.round(words.length / 200)} min read). Cold emails that get replies are usually 50-150 words.`,
      'Cut to the ask.');
  } else if (words.length) {
    add('pass', 0, 'length_ok', 'Body length is reasonable', `${words.length} words.`);
  }

  const capsWords = (readable.match(/\b[A-Z]{4,}\b/g) || []).filter((w) => !/^(RFQ|ASAP|FYI|CEO|CTO|COO|USA|VAT|ISO|OEM|MOQ|EXW|FOB|CIF|SKU|PDF|URL|HTML|GST|EIN)$/.test(w));
  if (capsWords.length > 3) {
    add('warning', 0.6, 'body_caps', 'Shouted words in the body',
      `${capsWords.length} all-capital words such as ${capsWords.slice(0, 3).map((w) => `"${w}"`).join(', ')}.`,
      'Use normal sentence case; bold the important line instead.');
  }

  if (!/\{\{/.test(combined)) {
    add('info', 0, 'no_merge_fields', 'No merge fields used',
      'Every recipient gets identical text, which is easier for filters to cluster as bulk mail.',
      'Personalise with {{first_name}}, {{company}} or a line referencing their business.');
  } else {
    add('pass', 0, 'merge_fields_ok', 'Message is personalised', 'Merge fields vary the message per recipient.');
  }

  // ---- Structure -----------------------------------------------------------
  if (html && !bodyText) {
    add('critical', 1.5, 'no_text_part', 'No plain-text alternative',
      'HTML-only messages score worse everywhere and break in text-only clients.',
      'Provide a plain-text version — the campaign editor can generate one.');
  } else if (html && bodyText) {
    const ratio = bodyText.length / Math.max(1, htmlText.length);
    if (ratio < 0.3) {
      add('warning', 0.5, 'text_part_thin', 'Plain-text part is much shorter than the HTML',
        'Mismatched alternatives look like an attempt to show filters different content than readers.',
        'Keep the text part a faithful copy of the HTML.');
    } else {
      add('pass', 0, 'multipart_ok', 'Both HTML and plain-text parts present', 'Good multipart structure.');
    }
  }

  if (htmlBytes > 102_000) {
    add('warning', 1, 'html_too_large', 'HTML is over 102 KB',
      `${(htmlBytes / 1024).toFixed(0)} KB — Gmail clips messages past 102 KB and hides the rest, including the unsubscribe link.`,
      'Trim inline styles and long base64 content.');
  }

  if ($) {
    if (images.length && words.length < 25) {
      add('critical', 2, 'image_only', 'Image-heavy with almost no text',
        'Image-only email is a long-standing way to hide text from filters, so it is treated with suspicion.',
        'Put the message in real text; use images only as support.');
    }
    const noAlt = images.filter((i) => !$(i).attr('alt')).length;
    if (noAlt) {
      add('warning', 0.4, 'img_no_alt', `${noAlt} image${noAlt > 1 ? 's' : ''} without alt text`,
        'Images are blocked by default in most clients, so alt text is often all the recipient sees.',
        'Add descriptive alt attributes.');
    }
    const dataImages = images.filter((i) => /^data:/i.test($(i).attr('src') || '')).length;
    if (dataImages) {
      add('warning', 0.8, 'data_uri_images', `${dataImages} inline base64 image${dataImages > 1 ? 's' : ''}`,
        'data: URIs are blocked by Gmail and Outlook and inflate the message size.',
        'Host images on your own HTTPS domain and link to them.');
    }
    const tracking = images.filter((i) => {
      const w = px($(i).attr('width')), h = px($(i).attr('height'));
      const style = $(i).attr('style') || '';
      return (w > 0 && w <= 2 && h > 0 && h <= 2) || /width\s*:\s*1px/i.test(style);
    }).length;
    if (tracking) {
      add('info', 0.3, 'tracking_pixel', 'Tracking pixel detected',
        'A 1x1 image is used to detect opens. This is common, but it is personal data under GDPR and some filters weigh it.',
        'Disclose tracking in your privacy notice, or drop open tracking for cold outreach.');
    }

    const hidden = $('*').toArray().filter((n) => {
      const style = $(n).attr('style') || '';
      if (!style) return false;
      const hasText = $(n).text().trim().length > 15;
      return hasText && (HIDDEN_STYLE.test(style) || (WHITE_TEXT.test(style) && !/background/i.test(style)));
    });
    if (hidden.length) {
      add('critical', 2.5, 'hidden_text', 'Hidden text in the message',
        `${hidden.length} element(s) contain readable text that is hidden from the recipient.`,
        'Remove it. Text visible to filters but not readers is treated as deliberate evasion and is a fast route to a domain-level block.');
    }

    if ($('script').length) {
      add('critical', 2.5, 'script_tag', '<script> tag present',
        'Scripts are stripped by every mail client and their presence is a strong malicious signal.',
        'Remove all scripts.');
    }
    if ($('iframe, object, embed, applet').length) {
      add('critical', 2.5, 'embedded_object', 'Embedded frame or object',
        'iframes and embedded objects are blocked and treated as an attack vector.',
        'Remove them.');
    }
    if ($('form, input, button[type=submit], select, textarea').length) {
      add('warning', 1.2, 'form_elements', 'Form elements in the email',
        'Forms are stripped by Gmail and Outlook and are associated with credential phishing.',
        'Link to a page on your site instead.');
    }
    const eventHandlers = $('*').toArray().filter((n) =>
      Object.keys(n.attribs || {}).some((a) => /^on[a-z]+$/i.test(a))).length;
    if (eventHandlers) {
      add('critical', 2, 'inline_js', 'Inline JavaScript event handlers',
        `${eventHandlers} element(s) carry on* attributes.`, 'Remove them.');
    }
    if ($('link[rel=stylesheet]').length) {
      add('warning', 0.8, 'external_css', 'External stylesheet linked',
        'Remote stylesheets are never loaded by mail clients, so the message will render unstyled.',
        'Inline your CSS.');
    }
    if (!/<!doctype/i.test(html)) {
      add('info', 0.2, 'no_doctype', 'No DOCTYPE declaration',
        'Outlook and some webmail clients fall back to quirks mode without one.',
        'Start the document with <!DOCTYPE html>.');
    }
    if ($('style').length && !$('[style]').length) {
      add('warning', 0.5, 'style_block_only', 'Styling only in a <style> block',
        'Several clients strip <style> blocks entirely, leaving an unstyled message.',
        'Inline the critical styles onto the elements.');
    }

    for (const [id, re, why] of UNSUPPORTED_CSS) {
      if (re.test(html)) {
        add('info', 0.15, `css_${id.replace(/\W+/g, '_')}`, `Uses ${id}`, why,
          'Use table-based layout with inline styles for broad client support.');
      }
    }

    const widths = $('table[width], td[width], div[style*=width]').toArray()
      .map((n) => px($(n).attr('width') || ($(n).attr('style') || '').match(/width\s*:\s*(\d+)/)?.[1] || 0));
    if (widths.some((w) => w > 640)) {
      add('info', 0.2, 'wide_layout', 'Layout wider than 640px',
        'Wider layouts get scaled down or scrolled sideways on phones.',
        'Keep the outer container at 600px.');
    }
  }

  // ---- Links ---------------------------------------------------------------
  if (links.length === 0) {
    add('pass', 0, 'links_ok', 'No links in the body',
      mode === 'outreach' ? 'A link-free first touch is the safest option for cold outreach.' : 'No links to assess.');
  } else {
    const limit = mode === 'outreach' ? 2 : 5;
    if (links.length > limit) {
      add('warning', Math.min(1.5, (links.length - limit) * 0.4), 'too_many_links',
        `${links.length} links`,
        `Cold outreach with more than ${limit} link${limit > 1 ? 's' : ''} looks like a newsletter or a lure.`,
        'Keep one link, ideally to a page on your own domain.');
    }

    const shorteners = links.filter((l) => URL_SHORTENERS.has(registrableDomain(hostOf(l.url))));
    if (shorteners.length) {
      add('critical', 1.8, 'shortened_links', 'Shortened links',
        `${shorteners.map((l) => hostOf(l.url)).join(', ')} hide the real destination and are heavily abused, so several filters block them outright.`,
        'Link to the full URL on your own domain.');
    }

    const ipLinks = links.filter((l) => /^\d{1,3}(\.\d{1,3}){3}$/.test(hostOf(l.url)));
    if (ipLinks.length) {
      add('critical', 2, 'ip_links', 'Links to a bare IP address',
        'Links pointing at raw IPs are almost exclusively used by phishing and malware campaigns.',
        'Use a hostname with valid HTTPS.');
    }

    const insecure = links.filter((l) => /^http:\/\//i.test(l.url));
    if (insecure.length) {
      add('warning', 0.6, 'http_links', `${insecure.length} plain HTTP link${insecure.length > 1 ? 's' : ''}`,
        'Unencrypted links lower trust scores and warn the recipient in modern browsers.',
        'Use HTTPS.');
    }

    // Anchor text that names a different domain than the href is the classic
    // phishing pattern and is scored harshly by filters.
    const deceptive = links.filter((l) => {
      const m = l.anchorText.match(/\b([a-z0-9-]+\.[a-z]{2,})\b/i);
      if (!m) return false;
      const shown = registrableDomain(m[1].toLowerCase());
      const actual = registrableDomain(hostOf(l.url));
      return shown && actual && shown !== actual;
    });
    if (deceptive.length) {
      add('critical', 2.5, 'deceptive_links', 'Link text does not match its destination',
        deceptive.map((l) => `"${l.anchorText}" points to ${hostOf(l.url)}`).join('; '),
        'Make the visible text match the actual destination.');
    }

    if (sendingDomain) {
      const root = registrableDomain(sendingDomain);
      const offDomain = links.filter((l) => {
        const h = registrableDomain(hostOf(l.url));
        return h && h !== root;
      });
      if (offDomain.length === links.length && links.length > 0) {
        add('info', 0.3, 'links_off_domain', 'No links point to your sending domain',
          'Filters look for alignment between the sending domain and the domains you link to.',
          `Link to ${root} where you can.`);
      }
    }
  }

  // ---- Sender identity -----------------------------------------------------
  if (/^(no-?reply|do-?not-?reply|donotreply)@/i.test(fromEmail)) {
    add('warning', 0.8, 'noreply_from', 'Sending from a no-reply address',
      'A no-reply sender suppresses the replies that build sender reputation, and Gmail treats replies as a strong positive signal.',
      'Send from a monitored mailbox.');
  }
  if (fromName && /[A-Z]{5,}|!|\$|free|winner/i.test(fromName)) {
    add('warning', 0.5, 'from_name_odd', 'Unusual From name',
      `"${fromName}" contains shouting or promotional characters.`,
      'Use a person or company name.');
  }

  // ---- Score ---------------------------------------------------------------
  const deductions = issues.reduce((sum, i) => sum + i.points, 0);
  const score = Math.max(0, Math.min(10, 10 - deductions));
  const verdict =
    score >= 8.5 ? 'strong' : score >= 7 ? 'acceptable' : score >= 5 ? 'needs work' : 'likely to be filtered';

  return {
    score: Number(score.toFixed(1)),
    verdict,
    deductions: Number(deductions.toFixed(2)),
    stats,
    links: links.map((l) => l.url),
    issues: issues.sort((a, b) => b.points - a.points),
    counts: {
      critical: issues.filter((i) => i.severity === 'critical').length,
      warning: issues.filter((i) => i.severity === 'warning').length,
      info: issues.filter((i) => i.severity === 'info').length,
      pass: issues.filter((i) => i.severity === 'pass').length,
    },
  };
}

/** Best-effort plain-text version of an HTML body. */
export function htmlToText(html) {
  if (!html) return '';
  const $ = cheerio.load(html);
  $('script, style, head').remove();
  $('a[href]').each((_, a) => {
    const href = $(a).attr('href');
    const label = $(a).text().trim();
    if (href && /^https?:/i.test(href) && label && !label.includes(href)) {
      $(a).replaceWith(`${label} (${href})`);
    }
  });
  $('br').replaceWith('\n');
  $('p, div, tr, li, h1, h2, h3, h4').each((_, n) => $(n).append('\n'));
  return $.root()
    .text()
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .split('\n')
    .map((l) => l.trim())
    .join('\n')
    .trim();
}
