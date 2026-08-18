import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth } from '../auth.js';
import { verifyTransport, gmailSenderPayload } from '../mailer.js';
import { encryptSecret, normalizeAppPassword, looksLikeGmailAppPassword } from '../secrets.js';
import { listGmailPool, poolStatus } from '../rotate.js';
import { estimatePlacement, imapPlacementCheck, sendPlacementProbe } from '../inbox.js';

const router = Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  res.json({ pool: listGmailPool(req.user.id), status: poolStatus(req.user.id) });
});

router.post('/', async (req, res) => {
  const { label, email, app_password, from_name, daily_limit = 80, verify = true, in_rotation = true } =
    req.body || {};
  if (!email || !app_password) {
    return res.status(400).json({ error: 'Gmail address and app password are required' });
  }
  const addr = String(email).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) {
    return res.status(400).json({ error: 'Enter a valid Gmail or Google Workspace address' });
  }
  const pw = normalizeAppPassword(app_password);
  if (!looksLikeGmailAppPassword(pw)) {
    return res.status(400).json({
      error: 'Gmail app passwords are 16 characters (spaces optional). Create one at Google Account → Security → App passwords.',
    });
  }
  const payload = gmailSenderPayload({
    label: label || addr,
    email: addr,
    appPassword: encryptSecret(pw),
    fromName: from_name,
    dailyLimit: Math.max(1, Math.min(2000, parseInt(daily_limit, 10) || 80)),
  });

  const dup = db
    .prepare('SELECT id FROM senders WHERE user_id = ? AND kind = ? AND username = ?')
    .get(req.user.id, 'gmail', addr);
  if (dup) return res.status(409).json({ error: 'That Gmail address is already in your pool' });

  const info = db
    .prepare(
      `INSERT INTO senders
        (user_id, label, host, port, secure, username, password, from_name, from_email,
         kind, in_rotation, daily_limit, active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'gmail', ?, ?, 1)`
    )
    .run(
      req.user.id,
      payload.label,
      payload.host,
      payload.port,
      payload.secure,
      payload.username,
      payload.password,
      payload.from_name,
      payload.from_email,
      in_rotation ? 1 : 0,
      payload.daily_limit
    );

  const id = Number(info.lastInsertRowid);
  if (verify) {
    const sender = db.prepare('SELECT * FROM senders WHERE id = ?').get(id);
    try {
      await verifyTransport(sender);
      db.prepare('UPDATE senders SET verified = 1 WHERE id = ?').run(id);
    } catch (e) {
      return res.status(201).json({
        id,
        verified: false,
        warning: `Saved but SMTP verify failed: ${String(e.message || e)}`,
      });
    }
  }
  res.status(201).json({ id, verified: true });
});

router.patch('/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const s = db.prepare('SELECT * FROM senders WHERE id = ? AND user_id = ? AND kind = ?').get(id, req.user.id, 'gmail');
  if (!s) return res.status(404).json({ error: 'Not found' });
  const { label, from_name, daily_limit, in_rotation, active, app_password } = req.body || {};
  if (label !== undefined) db.prepare('UPDATE senders SET label = ? WHERE id = ?').run(label, id);
  if (from_name !== undefined) db.prepare('UPDATE senders SET from_name = ? WHERE id = ?').run(from_name, id);
  if (daily_limit !== undefined) {
    db.prepare('UPDATE senders SET daily_limit = ? WHERE id = ?').run(
      Math.max(1, Math.min(2000, parseInt(daily_limit, 10) || 80)),
      id
    );
  }
  if (in_rotation !== undefined) {
    db.prepare('UPDATE senders SET in_rotation = ? WHERE id = ?').run(in_rotation ? 1 : 0, id);
  }
  if (active !== undefined) db.prepare('UPDATE senders SET active = ? WHERE id = ?').run(active ? 1 : 0, id);
  if (app_password) {
    const pw = normalizeAppPassword(app_password);
    db.prepare('UPDATE senders SET password = ?, verified = 0 WHERE id = ?').run(encryptSecret(pw), id);
  }
  res.json({ ok: true });
});

router.post('/:id/verify', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const sender = db.prepare('SELECT * FROM senders WHERE id = ? AND user_id = ? AND kind = ?').get(id, req.user.id, 'gmail');
  if (!sender) return res.status(404).json({ error: 'Not found' });
  try {
    await verifyTransport(sender);
    db.prepare('UPDATE senders SET verified = 1 WHERE id = ?').run(id);
    res.json({ ok: true, verified: true });
  } catch (e) {
    db.prepare('UPDATE senders SET verified = 0 WHERE id = ?').run(id);
    res.status(400).json({ ok: false, error: String(e.message || e) });
  }
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM senders WHERE id = ? AND user_id = ? AND kind = ?').run(
    parseInt(req.params.id, 10),
    req.user.id,
    'gmail'
  );
  res.json({ ok: true });
});

router.post('/:id/placement-probe', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const sender = db.prepare('SELECT * FROM senders WHERE id = ? AND user_id = ? AND kind = ?').get(id, req.user.id, 'gmail');
  if (!sender) return res.status(404).json({ error: 'Not found' });
  if (!sender.verified) return res.status(400).json({ error: 'Verify this Gmail identity first' });
  const to = String(req.body?.to || sender.from_email).toLowerCase();
  try {
    const probe = await sendPlacementProbe(sender, to);
    const check = await imapPlacementCheck(sender, {
      subjectContains: probe.token,
      sentTo: to,
      waitMs: Math.min(20000, parseInt(req.body?.wait_ms, 10) || 10000),
    });
    res.json({ probe, check });
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

router.post('/estimate-placement', async (req, res) => {
  const { subject, html, text, from_name, from_email, follow_links } = req.body || {};
  const status = poolStatus(req.user.id);
  try {
    const result = await estimatePlacement({
      subject, html, text,
      fromName: from_name,
      fromEmail: from_email,
      gmailAuthenticated: status.verified > 0,
      linkFollow: !!follow_links,
    });
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

export default router;
