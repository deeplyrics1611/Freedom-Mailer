import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth } from '../auth.js';
import { verifyTransport } from '../mailer.js';
import { encryptSecret } from '../secrets.js';

const router = Router();
router.use(requireAuth);

const publicFields =
  'id, label, host, port, secure, username, from_name, from_email, verified, kind, in_rotation, daily_limit, sent_today, sent_date, last_used_at, active, created_at';

router.get('/', (req, res) => {
  res.json(
    db.prepare(`SELECT ${publicFields} FROM senders WHERE user_id = ? ORDER BY id DESC`).all(req.user.id)
  );
});

router.post('/', (req, res) => {
  const { label, host, port = 587, secure = false, username, password, from_name, from_email } =
    req.body || {};
  if (!label || !host || !username || !password || !from_email) {
    return res.status(400).json({ error: 'label, host, username, password, from_email are required' });
  }
  const info = db
    .prepare(
      `INSERT INTO senders (user_id, label, host, port, secure, username, password, from_name, from_email)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(req.user.id, label, host, port, secure ? 1 : 0, username, encryptSecret(password), from_name || label, from_email);
  res.status(201).json({ id: info.lastInsertRowid });
});

// Verify SMTP credentials (and mark verified on success).
router.post('/:id/verify', async (req, res) => {
  const sender = db
    .prepare('SELECT * FROM senders WHERE id = ? AND user_id = ?')
    .get(parseInt(req.params.id, 10), req.user.id);
  if (!sender) return res.status(404).json({ error: 'Not found' });
  try {
    await verifyTransport(sender);
    db.prepare('UPDATE senders SET verified = 1 WHERE id = ?').run(sender.id);
    res.json({ ok: true, verified: true });
  } catch (e) {
    db.prepare('UPDATE senders SET verified = 0 WHERE id = ?').run(sender.id);
    res.status(400).json({ ok: false, error: String(e.message || e) });
  }
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM senders WHERE id = ? AND user_id = ?').run(
    parseInt(req.params.id, 10),
    req.user.id
  );
  res.json({ ok: true });
});

export default router;
