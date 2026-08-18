import { Router } from 'express';
import { requireAuth } from '../auth.js';
import { analyzeContent, checkDomainAuth } from '../deliverability.js';
import { checkLinks } from '../linkcheck.js';
import { extractLinks } from '../netutils.js';
import { validateBatch } from '../validator.js';

const router = Router();
router.use(requireAuth);

const MAX_LINKS_PER_REQUEST = 25;
const MAX_EMAILS_PER_REQUEST = 1000;
const MAX_EMAILS_PER_REQUEST_SMTP = 200;

// ---- Deliverability / spam-content checker ------------------------------
// Content heuristics + (optional) sending-domain SPF/DMARC/DNSBL lookup.
// This estimates spam-filter risk from real signals; it is not the same as
// an actual inbox-placement seed test (which requires delivering to real
// mailboxes at Gmail/Outlook/Yahoo etc. via a service like GlockApps/Mail-Tester).
router.post('/deliverability', async (req, res) => {
  const { subject = '', html = '', text = '', domain = '' } = req.body || {};
  try {
    const content = analyzeContent({ subject, html, text });
    let domainAuth = null;
    let domainError = null;
    if (domain && domain.trim()) {
      try {
        domainAuth = await checkDomainAuth(domain.trim());
      } catch (err) {
        domainError = String(err.message || err);
      }
    }
    res.json({ content, domainAuth, domainError });
  } catch (err) {
    res.status(400).json({ error: String(err.message || err) });
  }
});

// ---- Cold-mailing link safety checker ------------------------------------
router.post('/links', async (req, res) => {
  const { html = '', urls = [] } = req.body || {};
  let list = Array.isArray(urls) ? urls.filter(Boolean) : [];
  if (html && html.trim()) list = [...list, ...extractLinks(html)];
  list = [...new Set(list)].slice(0, MAX_LINKS_PER_REQUEST);
  if (!list.length) return res.status(400).json({ error: 'No links found. Paste HTML/text with links, or list URLs directly.' });
  try {
    const results = await checkLinks(list);
    const summary = { total: results.length, safe: 0, caution: 0, risky: 0, invalid: 0 };
    for (const r of results) summary[r.verdict] = (summary[r.verdict] || 0) + 1;
    res.json({ results, summary, truncated: (Array.isArray(urls) ? urls.length : 0) + extractLinks(html).length > MAX_LINKS_PER_REQUEST });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

// ---- Lead / list validator (debounce-style email verification) ---------
router.post('/validate-emails', async (req, res) => {
  const { emails = [], smtp = false } = req.body || {};
  let list = Array.isArray(emails) ? emails : String(emails || '').split(/[\s,;]+/);
  list = [...new Set(list.map((e) => String(e || '').trim()).filter(Boolean))];
  const cap = smtp ? MAX_EMAILS_PER_REQUEST_SMTP : MAX_EMAILS_PER_REQUEST;
  const truncated = list.length > cap;
  list = list.slice(0, cap);
  if (!list.length) return res.status(400).json({ error: 'No email addresses provided.' });
  try {
    const { results, summary } = await validateBatch(list, { smtp: !!smtp });
    res.json({ results, summary, truncated, smtpAttempted: !!smtp });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

export default router;
