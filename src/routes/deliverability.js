import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth } from '../auth.js';
import { analyzeContent, htmlToText, extractLinks } from '../lib/spamcheck.js';
import { checkSendingDomain } from '../lib/authcheck.js';
import { analyzeHeaders } from '../lib/headercheck.js';
import { newToken } from '../compliance.js';
import { registrableDomain } from '../lib/dnsx.js';

const router = Router();
router.use(requireAuth);

const int = (v, fallback = 0) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
};

const saveCheck = (userId, kind, target, score, verdict, report) =>
  db.prepare('INSERT INTO checks (user_id, kind, target, score, verdict, report) VALUES (?, ?, ?, ?, ?, ?)')
    .run(userId, kind, String(target || '').slice(0, 200), score, verdict, JSON.stringify(report));

// ---- Content and HTML analysis ---------------------------------------------

router.post('/content', (req, res) => {
  const b = req.body || {};
  const fromEmail = String(b.from_email || '');
  const report = analyzeContent({
    subject: String(b.subject || ''),
    html: String(b.html || ''),
    text: String(b.text || ''),
    fromName: String(b.from_name || ''),
    fromEmail,
    postalAddress: String(b.postal_address || ''),
    mode: b.mode === 'optin' ? 'optin' : 'outreach',
    sendingDomain: fromEmail.includes('@') ? fromEmail.split('@').pop() : '',
  });
  saveCheck(req.user.id, 'content', b.subject, Math.round(report.score * 10), report.verdict, report);
  res.json(report);
});

// Generate a plain-text alternative from an HTML body.
router.post('/to-text', (req, res) => {
  res.json({ text: htmlToText(String(req.body?.html || '')) });
});

// ---- Domain authentication --------------------------------------------------

router.post('/auth', async (req, res) => {
  const selectors = Array.isArray(req.body?.selectors)
    ? req.body.selectors.map((s) => String(s).trim()).filter(Boolean)
    : String(req.body?.selectors || '').split(/[\s,]+/).filter(Boolean);

  const report = await checkSendingDomain(req.body?.domain, {
    selectors,
    ip: String(req.body?.ip || '').trim() || null,
  });
  if (!report.ok) return res.status(400).json(report);
  saveCheck(req.user.id, 'auth', report.domain, report.score, report.ready_for_bulk ? 'ready' : 'not ready', report);
  res.json(report);
});

// Check the domains behind every mailbox in the pool in one pass, which is what
// most people actually want before starting a campaign.
router.get('/auth/pool', async (req, res) => {
  const mailboxes = db.prepare('SELECT DISTINCT email FROM mailboxes WHERE user_id = ?').all(req.user.id);
  const domains = [...new Set(mailboxes.map((m) => m.email.split('@').pop().toLowerCase()))];
  const reports = [];
  for (const domain of domains) reports.push(await checkSendingDomain(domain));
  res.json({ domains: reports });
});

// ---- Delivered-message header analysis --------------------------------------

router.post('/headers', (req, res) => {
  const report = analyzeHeaders(String(req.body?.raw || ''));
  if (!report.ok) return res.status(400).json(report);
  saveCheck(req.user.id, 'headers', report.subject, report.score, report.verdict, report);
  res.json(report);
});

// ---- Inbox placement seed tests ---------------------------------------------

const PROVIDER_BY_DOMAIN = [
  [/^(gmail|googlemail)\.com$/, 'Gmail'],
  [/^(outlook|hotmail|live|msn)\./, 'Outlook'],
  [/^yahoo\./, 'Yahoo'],
  [/^(icloud|me|mac)\.com$/, 'Apple iCloud'],
  [/^(proton|protonmail)\./, 'Proton'],
  [/^(aol)\./, 'AOL'],
  [/^(gmx|web)\./, 'GMX'],
  [/^zoho\./, 'Zoho'],
  [/^yandex\./, 'Yandex'],
];

const providerFor = (email) => {
  const domain = String(email).split('@').pop().toLowerCase();
  for (const [re, name] of PROVIDER_BY_DOMAIN) if (re.test(domain)) return name;
  return domain;
};

/**
 * Send a tagged copy of a campaign to seed mailboxes you control, then record
 * where each one landed.
 *
 * Placement has to be recorded by hand because reading it automatically would
 * mean handing this app credentials to each seed mailbox. The tag in the
 * subject makes the message easy to find, including in a spam folder.
 */
router.post('/seed-tests', (req, res) => {
  const b = req.body || {};
  const seeds = (Array.isArray(b.seeds) ? b.seeds : String(b.seeds || '').split(/[\s,;]+/))
    .map((s) => String(s).trim().toLowerCase())
    .filter((s) => s.includes('@'));

  if (!seeds.length) return res.status(400).json({ error: 'Add at least one seed address you control' });
  if (seeds.length > 25) return res.status(400).json({ error: 'Seed tests are limited to 25 addresses' });
  if (!b.subject) return res.status(400).json({ error: 'A subject is required' });

  const mailbox = b.mailbox_id
    ? db.prepare('SELECT * FROM mailboxes WHERE id = ? AND user_id = ?').get(int(b.mailbox_id), req.user.id)
    : null;
  if (b.mailbox_id && !mailbox) return res.status(400).json({ error: 'Mailbox not found' });
  if (mailbox && !mailbox.verified) return res.status(400).json({ error: 'Verify that mailbox before sending from it' });
  if (!mailbox) {
    const anyVerified = db.prepare('SELECT COUNT(*) n FROM mailboxes WHERE user_id = ? AND verified = 1 AND active = 1').get(req.user.id).n;
    if (!anyVerified) return res.status(400).json({ error: 'Add and verify at least one mailbox first' });
  }

  const code = newToken().slice(0, 10).toUpperCase();
  const subject = `${b.subject} [seed ${code}]`;
  const html = String(b.html || '');
  const text = String(b.text || '') || htmlToText(html);

  const test = db
    .prepare('INSERT INTO seed_tests (user_id, code, mailbox_id, subject, note) VALUES (?, ?, ?, ?, ?)')
    .run(req.user.id, code, mailbox?.id ?? null, subject, String(b.note || ''));
  const testId = test.lastInsertRowid;

  const insertSeed = db.prepare(
    'INSERT INTO seed_results (seed_test_id, email, provider) VALUES (?, ?, ?)'
  );
  const insertMessage = db.prepare(
    `INSERT INTO messages (user_id, channel, to_address, subject, html, text, status, source, use_pool, mailbox_id, seed_result_id)
     VALUES (?, 'email', ?, ?, ?, ?, 'queued', 'seed-test', ?, ?, ?)`
  );

  db.transaction(() => {
    for (const email of seeds) {
      const seed = insertSeed.run(testId, email, providerFor(email));
      insertMessage.run(
        req.user.id, email, subject, html, text,
        mailbox ? 0 : 1, mailbox?.id ?? null, seed.lastInsertRowid
      );
    }
  })();

  res.status(201).json({ id: testId, code, subject, seeds: seeds.length });
});

router.get('/seed-tests', (req, res) => {
  const tests = db
    .prepare(
      `SELECT st.*, m.email AS mailbox_email,
        (SELECT COUNT(*) FROM seed_results WHERE seed_test_id = st.id) AS total,
        (SELECT COUNT(*) FROM seed_results WHERE seed_test_id = st.id AND placement = 'inbox') AS inbox,
        (SELECT COUNT(*) FROM seed_results WHERE seed_test_id = st.id AND placement = 'spam') AS spam,
        (SELECT COUNT(*) FROM seed_results WHERE seed_test_id = st.id AND placement = 'unknown') AS pending
       FROM seed_tests st LEFT JOIN mailboxes m ON m.id = st.mailbox_id
       WHERE st.user_id = ? ORDER BY st.id DESC LIMIT 50`
    )
    .all(req.user.id);
  res.json(tests);
});

router.get('/seed-tests/:id', (req, res) => {
  const test = db
    .prepare('SELECT * FROM seed_tests WHERE id = ? AND user_id = ?')
    .get(int(req.params.id), req.user.id);
  if (!test) return res.status(404).json({ error: 'Not found' });

  const results = db
    .prepare(
      `SELECT sr.*, msg.status AS message_status, msg.error AS message_error, msg.mailbox_id,
              mb.email AS sent_from
       FROM seed_results sr
       LEFT JOIN messages msg ON msg.seed_result_id = sr.id
       LEFT JOIN mailboxes mb ON mb.id = msg.mailbox_id
       WHERE sr.seed_test_id = ? ORDER BY sr.id`
    )
    .all(test.id);

  const recorded = results.filter((r) => r.placement !== 'unknown');
  const inbox = recorded.filter((r) => r.placement === 'inbox').length;

  res.json({
    ...test,
    results,
    recorded: recorded.length,
    inbox_rate: recorded.length ? Math.round((inbox / recorded.length) * 100) : null,
  });
});

router.patch('/seed-tests/:id/results/:resultId', (req, res) => {
  const test = db
    .prepare('SELECT * FROM seed_tests WHERE id = ? AND user_id = ?')
    .get(int(req.params.id), req.user.id);
  if (!test) return res.status(404).json({ error: 'Not found' });

  const placement = String(req.body?.placement || '');
  if (!['unknown', 'inbox', 'promotions', 'spam', 'missing'].includes(placement)) {
    return res.status(400).json({ error: 'placement must be inbox, promotions, spam, missing or unknown' });
  }
  db.prepare("UPDATE seed_results SET placement = ?, recorded_at = datetime('now') WHERE id = ? AND seed_test_id = ?")
    .run(placement, int(req.params.resultId), test.id);
  res.json({ ok: true });
});

router.delete('/seed-tests/:id', (req, res) => {
  db.prepare('DELETE FROM seed_tests WHERE id = ? AND user_id = ?').run(int(req.params.id), req.user.id);
  res.json({ ok: true });
});

// ---- Combined pre-send check -------------------------------------------------

/**
 * Everything worth checking before a campaign goes out, in one call: content
 * and HTML analysis, the sending domain's authentication records, and the list
 * of links the message contains.
 */
router.post('/preflight', async (req, res) => {
  const b = req.body || {};
  const fromEmail = String(b.from_email || '');
  const domain = fromEmail.includes('@') ? fromEmail.split('@').pop().toLowerCase() : String(b.domain || '');

  const content = analyzeContent({
    subject: String(b.subject || ''),
    html: String(b.html || ''),
    text: String(b.text || ''),
    fromName: String(b.from_name || ''),
    fromEmail,
    postalAddress: String(b.postal_address || ''),
    mode: b.mode === 'optin' ? 'optin' : 'outreach',
    sendingDomain: domain,
  });

  const auth = domain ? await checkSendingDomain(domain) : null;
  const links = extractLinks(String(b.html || ''), String(b.text || '')).map((l) => l.url);

  const blockers = [
    ...content.issues.filter((i) => i.severity === 'critical').map((i) => i.title),
    ...(auth?.ok ? auth.findings.filter((f) => f.severity === 'critical').map((f) => f.title) : []),
  ];

  res.json({
    content,
    auth,
    links,
    sending_domain: domain || null,
    root_domain: domain ? registrableDomain(domain) : null,
    blockers,
    ready: blockers.length === 0,
  });
});

router.get('/history', (req, res) => {
  const kind = String(req.query.kind || '');
  const rows = kind
    ? db.prepare('SELECT id, kind, target, score, verdict, created_at FROM checks WHERE user_id = ? AND kind = ? ORDER BY id DESC LIMIT 50').all(req.user.id, kind)
    : db.prepare('SELECT id, kind, target, score, verdict, created_at FROM checks WHERE user_id = ? ORDER BY id DESC LIMIT 50').all(req.user.id);
  res.json(rows);
});

router.get('/history/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM checks WHERE id = ? AND user_id = ?').get(int(req.params.id), req.user.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json({ ...row, report: JSON.parse(row.report || '{}') });
});

export default router;
