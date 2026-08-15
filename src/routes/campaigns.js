import { Router } from 'express';
import { config } from '../config.js';
import { db } from '../db.js';
import { requireAuth } from '../auth.js';
import { isSuppressed, withUnsubscribeFooter, renderTemplate } from '../compliance.js';

const router = Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  const rows = db
    .prepare(
      `SELECT c.*, l.name AS list_name, s.label AS sender_label,
        (SELECT COUNT(*) FROM messages m WHERE m.campaign_id = c.id) AS total,
        (SELECT COUNT(*) FROM messages m WHERE m.campaign_id = c.id AND m.status = 'sent') AS sent,
        (SELECT COUNT(*) FROM messages m WHERE m.campaign_id = c.id AND m.status = 'failed') AS failed
       FROM campaigns c
       LEFT JOIN lists l ON l.id = c.list_id
       LEFT JOIN senders s ON s.id = c.sender_id
       WHERE c.user_id = ? ORDER BY c.id DESC`
    )
    .all(req.user.id);
  res.json(rows);
});

router.post('/', (req, res) => {
  const { name, sender_id, list_id, subject = '', html = '', text = '' } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Name required' });
  const info = db
    .prepare(
      'INSERT INTO campaigns (user_id, name, sender_id, list_id, subject, html, text) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )
    .run(req.user.id, name, sender_id || null, list_id || null, subject, html, text);
  res.status(201).json({ id: info.lastInsertRowid });
});

router.put('/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const c = db.prepare('SELECT * FROM campaigns WHERE id = ? AND user_id = ?').get(id, req.user.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  if (c.status !== 'draft') return res.status(400).json({ error: 'Only draft campaigns can be edited' });
  const {
    name = c.name, sender_id = c.sender_id, list_id = c.list_id,
    subject = c.subject, html = c.html, text = c.text,
  } = req.body || {};
  db.prepare(
    'UPDATE campaigns SET name=?, sender_id=?, list_id=?, subject=?, html=?, text=? WHERE id=?'
  ).run(name, sender_id || null, list_id || null, subject, html, text, id);
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM campaigns WHERE id = ? AND user_id = ?').run(
    parseInt(req.params.id, 10),
    req.user.id
  );
  res.json({ ok: true });
});

// Send (or schedule) a campaign: enqueue one message per CONFIRMED subscriber,
// skipping suppressed addresses. Each message gets a unique unsubscribe token
// and a compliant footer + List-Unsubscribe header.
router.post('/:id/send', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const c = db.prepare('SELECT * FROM campaigns WHERE id = ? AND user_id = ?').get(id, req.user.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  if (c.status !== 'draft') return res.status(400).json({ error: 'Campaign already processed' });
  if (!c.list_id) return res.status(400).json({ error: 'Campaign needs a list' });
  if (!c.subject) return res.status(400).json({ error: 'Campaign needs a subject' });

  const sender = c.sender_id
    ? db.prepare('SELECT * FROM senders WHERE id = ? AND user_id = ?').get(c.sender_id, req.user.id)
    : null;
  if (c.sender_id && !sender) return res.status(400).json({ error: 'Sender not found' });
  if (sender && !sender.verified) {
    return res.status(400).json({ error: 'Sender identity must be verified before sending' });
  }
  if (!sender && !config.systemSmtp.host) {
    return res.status(400).json({ error: 'No verified sender and no system SMTP configured' });
  }

  // Only confirmed subscribers are eligible.
  const statusFilter = config.requireDoubleOptIn ? "'confirmed'" : "'confirmed','pending'";
  const recipients = db
    .prepare(
      `SELECT c.id AS contact_id, c.email, c.name, s.token
       FROM subscriptions s JOIN contacts c ON c.id = s.contact_id
       WHERE s.list_id = ? AND s.status IN (${statusFilter})`
    )
    .all(c.list_id);

  let queued = 0, skipped = 0;
  const insert = db.prepare(
    `INSERT INTO messages (user_id, channel, campaign_id, sender_id, to_address, subject, html, text, status, unsub_token, source)
     VALUES (?, 'email', ?, ?, ?, ?, ?, ?, 'queued', ?, 'campaign')`
  );

  const tx = db.transaction((rows) => {
    for (const r of rows) {
      if (isSuppressed(req.user.id, r.email)) { skipped++; continue; }
      const vars = { name: r.name || '', email: r.email };
      const subject = renderTemplate(c.subject, vars);
      const baseHtml = renderTemplate(c.html, vars);
      const baseText = renderTemplate(c.text, vars);
      const withFooter = withUnsubscribeFooter({ html: baseHtml, text: baseText }, r.token);
      insert.run(
        req.user.id, id, c.sender_id || null, r.email, subject,
        withFooter.html, withFooter.text, r.token
      );
      queued++;
    }
  });
  tx(recipients);

  db.prepare("UPDATE campaigns SET status = 'sending' WHERE id = ?").run(id);
  res.json({ ok: true, queued, skipped, eligible: recipients.length });
});

export default router;
