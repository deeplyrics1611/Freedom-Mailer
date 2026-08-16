import { Router } from 'express';
import { db } from '../db.js';
import { requireApiKey, requireFeature } from '../auth.js';
import { isSuppressed } from '../compliance.js';
import { smsEnabled } from '../config.js';
import { normalizeAttachments } from '../attachments.js';
import { analyzeContent, sendBlockError } from '../spamcheck.js';

// Transactional sending API. Authenticated with X-API-Key.
// Transactional mail (password resets, receipts, etc.) is one-to-one and
// requested by the recipient, so it bypasses list opt-in — but it STILL
// respects the suppression list, and callers must send from an owned identity.
const router = Router();
router.use(requireApiKey, requireFeature('apikeys'));

function checkDailyQuota(userId, quota) {
  const row = db
    .prepare(
      "SELECT COUNT(*) AS n FROM messages WHERE user_id = ? AND created_at >= datetime('now','-1 day')"
    )
    .get(userId);
  return row.n < quota;
}

// POST /api/v1/email  { to, subject, html, text, sender_id? }
router.post('/email', (req, res) => {
  const { to, subject, html = '', text = '', sender_id } = req.body || {};
  if (!to || !subject) return res.status(400).json({ error: 'to and subject are required' });
  const addr = String(to).toLowerCase();

  if (!checkDailyQuota(req.user.id, req.user.daily_quota)) {
    return res.status(429).json({ error: 'Daily quota exceeded' });
  }
  if (isSuppressed(req.user.id, addr)) {
    return res.status(403).json({ error: 'Recipient is on your suppression list' });
  }

  const packed = normalizeAttachments(req.body?.attachments, {
    attachHtml: !!req.body?.attach_html,
    html,
    htmlName: req.body?.attach_html_name || 'letter.html',
  });
  if (packed.error) return res.status(400).json({ error: packed.error });
  const spam = analyzeContent({ subject, html, text, attachments: packed.attachments });
  const blocked = sendBlockError(spam);
  if (blocked) return res.status(400).json({ error: blocked, spam });

  let senderId = null;
  if (sender_id) {
    const sender = db
      .prepare('SELECT * FROM senders WHERE id = ? AND user_id = ?')
      .get(sender_id, req.user.id);
    if (!sender) return res.status(400).json({ error: 'sender_id not found' });
    if (!sender.verified) return res.status(400).json({ error: 'sender identity not verified' });
    senderId = sender.id;
  }

  const info = db
    .prepare(
      `INSERT INTO messages (user_id, channel, sender_id, to_address, subject, html, text, status, source, attachments)
       VALUES (?, 'email', ?, ?, ?, ?, ?, 'queued', 'api', ?)`
    )
    .run(req.user.id, senderId, addr, subject, html, text, packed.json);
  res.status(202).json({ id: info.lastInsertRowid, status: 'queued', attachments: packed.attachments.length });
});

// POST /api/v1/sms  { to, body }
router.post('/sms', (req, res) => {
  if (!smsEnabled()) return res.status(503).json({ error: 'SMS is not configured on this server' });
  const { to, body } = req.body || {};
  if (!to || !body) return res.status(400).json({ error: 'to and body are required' });
  if (!checkDailyQuota(req.user.id, req.user.daily_quota)) {
    return res.status(429).json({ error: 'Daily quota exceeded' });
  }
  const info = db
    .prepare(
      `INSERT INTO messages (user_id, channel, to_address, text, status, source)
       VALUES (?, 'sms', ?, ?, 'queued', 'api')`
    )
    .run(req.user.id, String(to), body);
  res.status(202).json({ id: info.lastInsertRowid, status: 'queued' });
});

// GET /api/v1/messages/:id  — delivery status lookup
router.get('/messages/:id', (req, res) => {
  const m = db
    .prepare('SELECT id, channel, to_address, status, error, created_at, sent_at FROM messages WHERE id = ? AND user_id = ?')
    .get(parseInt(req.params.id, 10), req.user.id);
  if (!m) return res.status(404).json({ error: 'Not found' });
  res.json(m);
});

export default router;
