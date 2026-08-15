import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth } from '../auth.js';
import { verifyTransport } from '../mailer.js';
import { SENDER_KINDS, SMTP_PRESETS, SMS_GATEWAYS, presetById } from '../presets.js';

const router = Router();
router.use(requireAuth);

const publicFields =
  'id, label, kind, provider, host, port, secure, username, from_name, from_email, sms_gateway, office_tenant_id, auth_mode, verified, created_at';

router.get('/presets', (req, res) => {
  res.json({ kinds: SENDER_KINDS, presets: SMTP_PRESETS, sms_gateways: SMS_GATEWAYS });
});

router.get('/', (req, res) => {
  res.json(
    db.prepare(`SELECT ${publicFields} FROM senders WHERE user_id = ? ORDER BY id DESC`).all(req.user.id)
  );
});

router.post('/', (req, res) => {
  const {
    label,
    kind = 'smtp',
    provider = '',
    host,
    port = 587,
    secure = false,
    username,
    password,
    from_name,
    from_email,
    sms_gateway = '',
    preset,
    office_tenant_id = null,
    auth_mode = '',
  } = req.body || {};

  let hostVal = host;
  let portVal = port;
  let secureVal = secure;
  let kindVal = kind;
  let providerVal = provider;

  if (preset) {
    const p = presetById(preset);
    if (!p) return res.status(400).json({ error: 'Unknown preset' });
    hostVal = hostVal || p.host;
    portVal = portVal || p.port;
    if (req.body.secure === undefined) secureVal = p.secure;
    kindVal = kindVal || p.kind;
    providerVal = providerVal || p.id;
  }

  const isOfficeGraph = kindVal === 'office365' && (auth_mode === 'graph' || !password);
  if (!label || !from_email || (!isOfficeGraph && (!hostVal || !username || !password))) {
    return res.status(400).json({
      error: 'label, host, username, password, from_email are required',
    });
  }
  if (kindVal === 'smtp_sms' && !sms_gateway) {
    return res.status(400).json({ error: 'sms_gateway is required for SMTP-to-SMS senders' });
  }

  const info = db
    .prepare(
      `INSERT INTO senders
        (user_id, label, kind, provider, host, port, secure, username, password, from_name, from_email, sms_gateway, office_tenant_id, auth_mode)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      req.user.id,
      label,
      kindVal,
      providerVal,
      hostVal || 'smtp.office365.com',
      portVal,
      secureVal ? 1 : 0,
      username || from_email,
      password || 'graph',
      from_name || label,
      from_email,
      sms_gateway,
      office_tenant_id || null,
      auth_mode || (kindVal === 'office365' ? 'graph' : '')
    );
  res.status(201).json({ id: info.lastInsertRowid });
});

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
