import dns from 'dns/promises';
import { stripHtml, extractLinks, findMismatchedAnchors, dnsblLookup } from './netutils.js';

// A representative sample of phrases/words that classic content-based spam
// filters (SpamAssassin-style rules, Gmail/Outlook heuristics) weight
// heavily. Not exhaustive, but enough to catch the biggest self-inflicted
// deliverability wounds in a cold outreach / RFQ email.
export const SPAM_PHRASES = [
  '100% free', 'act now', 'apply now', 'best price', 'buy direct', 'cash bonus',
  'cancel at any time', 'click here', 'click below', 'congratulations',
  'credit card offers', 'dear friend', 'double your', 'earn extra cash',
  'fast cash', 'free access', 'free consultation', 'free gift', 'free info',
  'free installation', 'free investment', 'free membership', 'free money',
  'free offer', 'free preview', 'free quote', 'free trial', 'get paid',
  'guarantee', 'guaranteed', 'increase sales', 'increase traffic',
  'incredible deal', 'limited time', 'lower your', 'lowest price',
  'make money', 'meet singles', 'no catch', 'no cost', 'no credit check',
  'no fees', 'no gimmick', 'no hidden', 'no obligation',
  'no purchase necessary', 'no strings attached', 'not spam',
  'obligation free', 'once in a lifetime', 'only $', 'order now',
  'risk free', 'risk-free', 'satisfaction guaranteed', 'save big money',
  'save up to', 'special promotion', 'supplies are limited',
  "this isn't spam", 'urgent', 'weight loss', 'while supplies last',
  'winner', 'winning', 'work from home', 'you have been selected',
  'act immediately', 'as seen on', 'bargain', 'bonus', 'cheap', 'clearance',
  'compare rates', 'dont delete', 'eliminate debt', 'explode your business',
  'extra income', 'financial freedom', 'get out of debt', 'giving away',
  'great offer', 'hidden charges', 'home based', 'income from home',
  'instant', 'investment decision', 'join millions', 'million dollars',
  'miracle', 'money back', 'never before', 'offer expires', 'opportunity',
  'pre-approved', 'pure profit', 'refinance', 'serious cash', 'stop',
  'take action now', 'the best rates', "this won't last", 'unlimited',
  'urgent response', 'what are you waiting for', 'why pay more',
];

const MAX_HEALTHY_LINK_COUNT = 5;
const IDEAL_SUBJECT_MIN = 20;
const IDEAL_SUBJECT_MAX = 65;

function countOccurrences(haystack, needle) {
  if (!needle) return 0;
  let count = 0;
  let idx = 0;
  while ((idx = haystack.indexOf(needle, idx)) !== -1) {
    count++;
    idx += needle.length;
  }
  return count;
}

function addIssue(issues, severity, code, message, points) {
  issues.push({ severity, code, message, points });
}

// Heuristic content scoring (0-100, higher = healthier / less spam-like).
// This mirrors the kind of rule-based signals real filters use, but it is
// NOT a substitute for an actual inbox-placement test (seed-list tools like
// GlockApps/Mail-Tester run the message through real mailbox providers).
export function analyzeContent({ subject = '', html = '', text = '' }) {
  const issues = [];
  let score = 100;

  const subjectLower = subject.toLowerCase();
  const bodyText = text && text.trim() ? text : stripHtml(html);
  const bodyLower = bodyText.toLowerCase();
  const combinedLower = `${subjectLower} ${bodyLower}`;

  // --- Subject line ---
  if (!subject.trim()) {
    addIssue(issues, 'error', 'subject-empty', 'Subject line is empty.', 20);
  } else {
    if (subject.length < IDEAL_SUBJECT_MIN) {
      addIssue(issues, 'warn', 'subject-short', `Subject is quite short (${subject.length} chars); 20-65 chars performs best.`, 3);
    }
    if (subject.length > IDEAL_SUBJECT_MAX) {
      addIssue(issues, 'warn', 'subject-long', `Subject is long (${subject.length} chars) and may get truncated in the inbox list.`, 3);
    }
    const letters = subject.replace(/[^A-Za-z]/g, '');
    const upper = subject.replace(/[^A-Z]/g, '');
    if (letters.length > 6 && upper.length / letters.length > 0.6) {
      addIssue(issues, 'error', 'subject-caps', 'Subject is mostly ALL CAPS — a strong spam signal.', 15);
    }
    const bangs = (subject.match(/!/g) || []).length;
    if (bangs >= 2) {
      addIssue(issues, 'error', 'subject-bangs', `Subject has ${bangs} exclamation marks — reduce to at most one.`, 10);
    }
    if (/\$\$|£{2,}|€{2,}/.test(subject)) {
      addIssue(issues, 'warn', 'subject-currency-spam', 'Repeated currency symbols in the subject look spammy.', 6);
    }
    if (/^(re:|fwd:)/i.test(subject.trim()) ) {
      addIssue(issues, 'warn', 'subject-fake-reply', 'Subject fakes a reply/forward ("Re:"/"Fwd:") on a first-touch email — filters and recipients both penalize this.', 8);
    }
  }

  // --- Spam trigger phrases (subject + body) ---
  const hits = [];
  for (const phrase of SPAM_PHRASES) {
    const n = countOccurrences(combinedLower, phrase);
    if (n > 0) hits.push({ phrase, count: n });
  }
  if (hits.length) {
    const totalHits = hits.reduce((s, h) => s + h.count, 0);
    const penalty = Math.min(30, totalHits * 3);
    addIssue(
      issues,
      totalHits >= 4 ? 'error' : 'warn',
      'spam-phrases',
      `Found ${totalHits} classic spam-trigger phrase${totalHits === 1 ? '' : 's'}: ${hits.slice(0, 8).map((h) => `"${h.phrase}"`).join(', ')}${hits.length > 8 ? '…' : ''}.`,
      penalty
    );
  }

  // --- Body length / text-to-HTML ratio ---
  const wordCount = bodyText.split(/\s+/).filter(Boolean).length;
  if (wordCount < 15) {
    addIssue(issues, 'warn', 'body-short', `Body is very short (${wordCount} words) — filters treat near-empty bodies with links as suspicious.`, 8);
  }
  if (!text.trim() && html.trim()) {
    addIssue(issues, 'warn', 'no-plaintext', 'No plain-text version was provided; multipart (HTML + text) emails deliver noticeably better.', 6);
  }
  if (html.trim()) {
    const htmlLen = html.length;
    const textLen = bodyText.length;
    const ratio = htmlLen ? textLen / htmlLen : 1;
    if (htmlLen > 200 && ratio < 0.15) {
      addIssue(issues, 'warn', 'low-text-ratio', 'Very little visible text relative to markup — often caused by an all-image email, which filters dislike.', 8);
    }
    const imgCount = (html.match(/<img\b/gi) || []).length;
    if (imgCount >= 1 && wordCount < 40) {
      addIssue(issues, 'warn', 'image-heavy', `${imgCount} image(s) with little supporting text — looks like an image-only spam email.`, 6);
    }
  }

  // --- Links ---
  const links = extractLinks(html || text);
  if (links.length > MAX_HEALTHY_LINK_COUNT) {
    addIssue(issues, 'warn', 'too-many-links', `${links.length} links found; cold emails with many links get filtered more often. Aim for 1-3.`, Math.min(15, (links.length - MAX_HEALTHY_LINK_COUNT) * 2));
  }
  const uniqueDomains = new Set(links.map((l) => { try { return new URL(l).hostname.replace(/^www\./, ''); } catch { return l; } }));
  if (uniqueDomains.size > 3) {
    addIssue(issues, 'warn', 'many-link-domains', `Links point to ${uniqueDomains.size} different domains — mixing many domains is a phishing/spam heuristic.`, 5);
  }

  // --- Mismatched anchor text (phishing-style signal) ---
  const mismatches = findMismatchedAnchors(html);
  if (mismatches.length) {
    addIssue(issues, 'error', 'link-text-mismatch', `${mismatches.length} link(s) show one URL as text but point somewhere else (e.g. text "${mismatches[0].textHost}" → href "${mismatches[0].hrefHost}"). This is a major spam/phishing signal.`, 15);
  }

  // --- Hidden text tricks ---
  if (/display\s*:\s*none/i.test(html) || /font-size\s*:\s*0/i.test(html)) {
    addIssue(issues, 'error', 'hidden-text', 'HTML contains display:none or font-size:0 — used to hide text from readers, a known spam/phishing technique that filters actively look for.', 12);
  }

  // --- Unsubscribe / compliance footer presence (informational) ---
  const hasUnsubLink = /unsubscribe/i.test(bodyText) || /unsubscribe/i.test(html);
  if (!hasUnsubLink) {
    addIssue(issues, 'info', 'no-unsubscribe-visible', 'No visible "unsubscribe" text detected. This platform appends one automatically for list campaigns — keep it if you edit the template.', 0);
  }

  score = Math.max(0, Math.min(100, score - issues.reduce((s, i) => s + i.points, 0)));
  const grade = score >= 85 ? 'Good' : score >= 65 ? 'Needs work' : 'Poor';

  return {
    score,
    grade,
    issues: issues.map(({ points, ...rest }) => rest),
    stats: {
      subjectLength: subject.length,
      wordCount,
      linkCount: links.length,
      uniqueLinkDomains: uniqueDomains.size,
      hasPlainText: !!text.trim(),
      spamPhraseHits: hits,
    },
  };
}

// Domain-level authentication + reputation checks. These are the things
// mailbox providers actually key their filtering decisions on — far more
// than content heuristics. `domain` should be the sending "From" domain.
export async function checkDomainAuth(domain) {
  const clean = String(domain || '').trim().toLowerCase().replace(/^@/, '');
  if (!clean || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(clean)) {
    throw new Error('Provide a valid domain, e.g. yourcompany.com');
  }

  const result = { domain: clean, spf: null, dmarc: null, dkimNote: null, blacklist: null, notes: [] };

  try {
    const records = await dns.resolveTxt(clean);
    const flat = records.map((r) => r.join(''));
    const spfRecord = flat.find((r) => /^v=spf1/i.test(r));
    result.spf = { found: !!spfRecord, record: spfRecord || null };
  } catch {
    result.spf = { found: false, record: null };
  }

  try {
    const records = await dns.resolveTxt(`_dmarc.${clean}`);
    const flat = records.map((r) => r.join(''));
    const dmarcRecord = flat.find((r) => /^v=dmarc1/i.test(r));
    let policy = null;
    if (dmarcRecord) {
      const m = dmarcRecord.match(/p=(\w+)/i);
      policy = m ? m[1].toLowerCase() : null;
    }
    result.dmarc = { found: !!dmarcRecord, record: dmarcRecord || null, policy };
  } catch {
    result.dmarc = { found: false, record: null, policy: null };
  }

  result.dkimNote =
    clean === 'gmail.com' || clean === 'googlemail.com'
      ? 'Sending as a personal @gmail.com address: Google applies its own SPF/DKIM at the gmail.com level, but a shared consumer domain has weaker sender reputation for outreach at volume. A verified custom domain with its own SPF/DKIM/DMARC will deliver noticeably better for cold/RFQ outreach.'
      : 'DKIM cannot be checked by domain name alone (it needs the selector your provider signs with). Confirm DKIM is enabled in your email provider / Google Workspace admin console.';

  const dbl = await dnsblLookup(clean, 'dbl.spamhaus.org');
  result.blacklist = dbl;

  if (!result.spf.found) result.notes.push('No SPF record found — add one authorizing your sending provider (e.g. "v=spf1 include:_spf.google.com ~all" for Google Workspace).');
  if (!result.dmarc.found) result.notes.push('No DMARC record found — publish one (even "v=DMARC1; p=none;" to start) so receiving servers can verify SPF/DKIM alignment.');
  if (result.dmarc.found && result.dmarc.policy === 'reject') result.notes.push('DMARC policy is p=reject — make sure your sending path is fully SPF/DKIM aligned or legitimate mail can bounce.');
  if (dbl.listed) result.notes.push('This domain is currently listed on the Spamhaus Domain Block List (DBL). Sending from it will likely be blocked or heavily filtered until delisted.');
  if (dbl.listed === null && dbl.error) result.notes.push(`Blocklist check was inconclusive (${dbl.error}) — verify independently, e.g. at multirbl.valli.org.`);

  return result;
}
