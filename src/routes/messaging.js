import { Router } from 'express';
import { db } from '../db.js';
import { requireApiKey } from '../auth.js';
import { isSuppressed } from '../compliance.js';
import { smsEnabled, systemProvider, normalizePhone, withSmsOptOut } from '../sms.js';
import { resolveSmsProvider } from './sms.js';
import { buildQuotaReport } from '../quota.js';

// Transactional sending API. Authenticated with X-API-Key.
// Transactional mail (password resets, receipts, etc.) is one-to-one and
// requested by the recipient, so it bypasses list opt-in — but it STILL
// respects the suppression list, and callers must send from an owned identity.
const router = Router();
router.use(requireApiKey);

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
      `INSERT INTO messages (user_id, channel, sender_id, to_address, subject, html, text, status, source, api_key_id)
       VALUES (?, 'email', ?, ?, ?, ?, ?, 'queued', 'api', ?)`
    )
    .run(req.user.id, senderId, addr, subject, html, text, req.apiKey?.id || null);
  res.status(202).json({ id: info.lastInsertRowid, status: 'queued' });
});

// POST /api/v1/sms  { to, body, provider_id? }
router.post('/sms', (req, res) => {
  const { to, body, provider_id, opt_out = true } = req.body || {};
  if (!to || !body) return res.status(400).json({ error: 'to and body are required' });
  if (!checkDailyQuota(req.user.id, req.user.daily_quota)) {
    return res.status(429).json({ error: 'Daily quota exceeded' });
  }
  const dest = normalizePhone(to);
  if (!dest) return res.status(400).json({ error: 'Invalid phone number (use E.164, e.g. +15551234567)' });
  if (isSuppressed(req.user.id, dest)) {
    return res.status(403).json({ error: 'Recipient is on your suppression list' });
  }
  const provider = resolveSmsProvider(req.user.id, provider_id);
  if (!provider && !smsEnabled() && !systemProvider()) {
    return res.status(503).json({ error: 'SMS is not configured — add a provider in the SMS section or set TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN' });
  }
  if (!provider) {
    return res.status(503).json({ error: 'SMS is not configured on this server' });
  }
  const text = opt_out ? withSmsOptOut(body) : String(body);
  const info = db
    .prepare(
      `INSERT INTO messages (user_id, channel, to_address, text, status, source, sms_provider_id, api_key_id)
       VALUES (?, 'sms', ?, ?, 'queued', 'api', ?, ?)`
    )
    .run(req.user.id, dest, text, provider.id || null, req.apiKey?.id || null);
  res.status(202).json({ id: info.lastInsertRowid, status: 'queued', to: dest });
});

router.get('/quota', async (req, res) => {
  try {
    res.json(await buildQuotaReport(req.user));
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
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
