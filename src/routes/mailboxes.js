import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth } from '../auth.js';
import { encryptSecret, normalizeAppPassword } from '../lib/secrets.js';
import { verifyMailbox, sendViaMailbox, closeMailboxTransport, explainSmtpError } from '../mailer.js';
import { poolStatus, poolCapacity, GMAIL_PRESETS, effectiveDailyLimit } from '../pool.js';

const router = Router();
router.use(requireAuth);

const int = (v, fallback) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
};

router.get('/presets', (req, res) => res.json(GMAIL_PRESETS));

router.get('/', (req, res) => {
  const mailboxes = poolStatus(req.user.id);
  res.json({
    mailboxes,
    capacity_today: poolCapacity(req.user.id),
    available_now: mailboxes.filter((m) => m.available).length,
  });
});

router.post('/', (req, res) => {
  const b = req.body || {};
  const provider = ['gmail', 'workspace', 'custom'].includes(b.provider) ? b.provider : 'gmail';
  const preset = GMAIL_PRESETS[provider];

  const email = String(b.email || '').trim().toLowerCase();
  const appPassword = normalizeAppPassword(b.app_password);
  if (!email || !email.includes('@')) return res.status(400).json({ error: 'A valid mailbox address is required' });
  if (!appPassword) return res.status(400).json({ error: 'An app password is required' });

  const host = String(b.host || preset.host || '').trim();
  if (!host) return res.status(400).json({ error: 'An SMTP host is required for a custom provider' });

  // Google app passwords are exactly 16 characters once the display spaces are
  // removed. Catching this here saves a confusing SMTP 535 later.
  if (provider !== 'custom' && appPassword.length !== 16) {
    return res.status(400).json({
      error: `A Google app password is 16 characters (you supplied ${appPassword.length}). Generate one at myaccount.google.com/apppasswords — do not use the account's normal password.`,
    });
  }

  const exists = db.prepare('SELECT id FROM mailboxes WHERE user_id = ? AND email = ?').get(req.user.id, email);
  if (exists) return res.status(409).json({ error: 'That mailbox is already in the pool' });

  const info = db
    .prepare(
      `INSERT INTO mailboxes
        (user_id, label, provider, host, port, secure, email, app_password, from_name, reply_to,
         daily_limit, hourly_limit, min_gap_sec, warmup, warmup_start, warmup_step)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      req.user.id,
      String(b.label || email).trim(),
      provider,
      host,
      int(b.port, preset.port),
      b.secure === undefined ? preset.secure : (b.secure ? 1 : 0),
      email,
      encryptSecret(appPassword),
      String(b.from_name || '').trim(),
      String(b.reply_to || '').trim(),
      int(b.daily_limit, preset.daily_limit),
      int(b.hourly_limit, preset.hourly_limit),
      int(b.min_gap_sec, 45),
      b.warmup === false ? 0 : 1,
      int(b.warmup_start, 10),
      int(b.warmup_step, 5)
    );

  res.status(201).json({ id: info.lastInsertRowid });
});

router.patch('/:id', (req, res) => {
  const id = int(req.params.id);
  const mailbox = db.prepare('SELECT * FROM mailboxes WHERE id = ? AND user_id = ?').get(id, req.user.id);
  if (!mailbox) return res.status(404).json({ error: 'Not found' });

  const b = req.body || {};
  const updates = [];
  const values = [];
  const set = (column, value) => {
    updates.push(`${column} = ?`);
    values.push(value);
  };

  if (b.label !== undefined) set('label', String(b.label).trim());
  if (b.from_name !== undefined) set('from_name', String(b.from_name).trim());
  if (b.reply_to !== undefined) set('reply_to', String(b.reply_to).trim());
  if (b.daily_limit !== undefined) set('daily_limit', Math.max(1, int(b.daily_limit, mailbox.daily_limit)));
  if (b.hourly_limit !== undefined) set('hourly_limit', Math.max(1, int(b.hourly_limit, mailbox.hourly_limit)));
  if (b.min_gap_sec !== undefined) set('min_gap_sec', Math.max(0, int(b.min_gap_sec, mailbox.min_gap_sec)));
  if (b.warmup !== undefined) set('warmup', b.warmup ? 1 : 0);
  if (b.warmup_start !== undefined) set('warmup_start', Math.max(1, int(b.warmup_start, mailbox.warmup_start)));
  if (b.warmup_step !== undefined) set('warmup_step', Math.max(0, int(b.warmup_step, mailbox.warmup_step)));
  if (b.active !== undefined) set('active', b.active ? 1 : 0);
  if (b.paused_until === null) set('paused_until', null);

  // Changing the credential invalidates verification and the cached connection.
  if (b.app_password) {
    const pw = normalizeAppPassword(b.app_password);
    set('app_password', encryptSecret(pw));
    set('verified', 0);
    set('last_error', '');
    closeMailboxTransport(id);
  }

  if (!updates.length) return res.json({ ok: true });
  values.push(id);
  db.prepare(`UPDATE mailboxes SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  const id = int(req.params.id);
  closeMailboxTransport(id);
  db.prepare('DELETE FROM mailboxes WHERE id = ? AND user_id = ?').run(id, req.user.id);
  res.json({ ok: true });
});

// Log in to the mailbox over SMTP without sending anything.
router.post('/:id/verify', async (req, res) => {
  const mailbox = db
    .prepare('SELECT * FROM mailboxes WHERE id = ? AND user_id = ?')
    .get(int(req.params.id), req.user.id);
  if (!mailbox) return res.status(404).json({ error: 'Not found' });

  try {
    await verifyMailbox(mailbox);
    db.prepare("UPDATE mailboxes SET verified = 1, verified_at = datetime('now'), last_error = '', paused_until = NULL WHERE id = ?")
      .run(mailbox.id);
    res.json({ ok: true, verified: true });
  } catch (err) {
    const explained = explainSmtpError(err);
    db.prepare('UPDATE mailboxes SET verified = 0, last_error = ? WHERE id = ?').run(explained.slice(0, 500), mailbox.id);
    res.status(400).json({ ok: false, error: explained });
  }
});

// Verify every mailbox in the pool in one pass.
router.post('/verify-all', async (req, res) => {
  const mailboxes = db.prepare('SELECT * FROM mailboxes WHERE user_id = ?').all(req.user.id);
  const results = [];
  for (const mailbox of mailboxes) {
    try {
      await verifyMailbox(mailbox);
      db.prepare("UPDATE mailboxes SET verified = 1, verified_at = datetime('now'), last_error = '' WHERE id = ?")
        .run(mailbox.id);
      results.push({ id: mailbox.id, email: mailbox.email, ok: true });
    } catch (err) {
      const explained = explainSmtpError(err);
      db.prepare('UPDATE mailboxes SET verified = 0, last_error = ? WHERE id = ?').run(explained.slice(0, 500), mailbox.id);
      results.push({ id: mailbox.id, email: mailbox.email, ok: false, error: explained });
    }
  }
  res.json({ results, verified: results.filter((r) => r.ok).length, total: results.length });
});

// Send a real test message, so you can confirm the From name, signature and
// rendering before a campaign goes out.
router.post('/:id/test', async (req, res) => {
  const mailbox = db
    .prepare('SELECT * FROM mailboxes WHERE id = ? AND user_id = ?')
    .get(int(req.params.id), req.user.id);
  if (!mailbox) return res.status(404).json({ error: 'Not found' });

  const to = String(req.body?.to || '').trim();
  if (!to.includes('@')) return res.status(400).json({ error: 'A destination address is required' });

  try {
    const messageId = await sendViaMailbox(mailbox, {
      to,
      subject: req.body?.subject || `Test from ${mailbox.email}`,
      text: req.body?.text || `This is a delivery test sent from ${mailbox.email} via ${mailbox.host}.`,
      html: req.body?.html || undefined,
    });
    res.json({ ok: true, message_id: messageId });
  } catch (err) {
    const explained = explainSmtpError(err);
    db.prepare('UPDATE mailboxes SET last_error = ? WHERE id = ?').run(explained.slice(0, 500), mailbox.id);
    res.status(400).json({ ok: false, error: explained });
  }
});

// Recent send history per mailbox, for spotting an account that has started
// failing before it takes a campaign down with it.
router.get('/:id/usage', (req, res) => {
  const id = int(req.params.id);
  const mailbox = db.prepare('SELECT * FROM mailboxes WHERE id = ? AND user_id = ?').get(id, req.user.id);
  if (!mailbox) return res.status(404).json({ error: 'Not found' });

  const days = db
    .prepare(
      `SELECT day, SUM(sent) AS sent FROM mailbox_usage
       WHERE mailbox_id = ? GROUP BY day ORDER BY day DESC LIMIT 30`
    )
    .all(id);
  const recent = db
    .prepare(
      `SELECT to_address, subject, status, error, sent_at FROM messages
       WHERE mailbox_id = ? ORDER BY id DESC LIMIT 25`
    )
    .all(id);

  res.json({ days, recent, effective_daily_limit: effectiveDailyLimit(mailbox) });
});

export default router;
