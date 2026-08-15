import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth } from '../auth.js';
import { verifyTransport } from '../mailer.js';
import {
  SENDER_KINDS,
  SMTP_PRESETS,
  SMS_GATEWAYS,
  MAILGUN_REGIONS,
  AWS_SES_REGIONS,
  presetById,
  applyProviderDefaults,
} from '../presets.js';

const router = Router();
router.use(requireAuth);

const publicFields =
  'id, label, kind, provider, host, port, secure, username, from_name, from_email, sms_gateway, office_tenant_id, auth_mode, region, verified, created_at';

router.get('/presets', (req, res) => {
  res.json({
    kinds: SENDER_KINDS,
    presets: SMTP_PRESETS,
    sms_gateways: SMS_GATEWAYS,
    mailgun_regions: MAILGUN_REGIONS,
    aws_regions: AWS_SES_REGIONS,
  });
});

router.get('/', (req, res) => {
  res.json(
    db.prepare(`SELECT ${publicFields} FROM senders WHERE user_id = ? ORDER BY id DESC`).all(req.user.id)
  );
});

function validateSender({ kindVal, auth_mode, hostVal, username, password, label, from_email, sms_gateway, region }) {
  if (!label || !from_email) {
    return 'label and from_email are required';
  }
  if (kindVal === 'smtp_sms' && !sms_gateway) {
    return 'sms_gateway is required for SMTP-to-SMS senders';
  }
  if (kindVal === 'office365' && (auth_mode === 'graph' || !password)) {
    return null;
  }
  if (kindVal === 'postfix') {
    if (!hostVal) return 'host is required for Postfix';
    return null;
  }
  if (kindVal === 'mailgun' && auth_mode === 'api') {
    if (!username || !password) return 'Mailgun sending domain (username) and API key (password) are required';
    return null;
  }
  if (kindVal === 'sendgrid' && auth_mode === 'api') {
    if (!password) return 'SendGrid API key is required';
    return null;
  }
  if (kindVal === 'aws') {
    if (!region) return 'AWS region is required';
    if (!username || !password) {
      return auth_mode === 'api'
        ? 'AWS access key ID and secret access key are required'
        : 'SES SMTP username and password are required';
    }
    return null;
  }
  if (!hostVal || !username || !password) {
    return 'label, host, username, password, from_email are required';
  }
  return null;
}

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
    region = '',
  } = req.body || {};

  let hostVal = host;
  let portVal = port;
  let secureVal = secure;
  let kindVal = kind;
  let providerVal = provider;
  let userVal = username;
  let regionVal = region;
  let modeVal = auth_mode;

  if (preset) {
    const p = presetById(preset);
    if (!p) return res.status(400).json({ error: 'Unknown preset' });
    hostVal = hostVal || p.host;
    portVal = portVal || p.port;
    if (req.body.secure === undefined) secureVal = p.secure;
    kindVal = kindVal || p.kind;
    providerVal = providerVal || p.id;
    if (!modeVal && p.auth_mode) modeVal = p.auth_mode;
    if (!userVal && p.username) userVal = p.username;
  }

  const filled = applyProviderDefaults({
    kind: kindVal,
    auth_mode: modeVal,
    region: regionVal,
    host: hostVal,
    port: portVal,
    username: userVal,
  });
  hostVal = filled.host;
  portVal = filled.port;
  userVal = filled.username;
  regionVal = filled.region;
  modeVal = filled.auth_mode;
  if (req.body.secure === undefined && filled.secure !== undefined) secureVal = filled.secure;

  const err = validateSender({
    kindVal,
    auth_mode: modeVal,
    hostVal,
    username: userVal,
    password,
    label,
    from_email,
    sms_gateway,
    region: regionVal,
  });
  if (err) return res.status(400).json({ error: err });

  const info = db
    .prepare(
      `INSERT INTO senders
        (user_id, label, kind, provider, host, port, secure, username, password, from_name, from_email, sms_gateway, office_tenant_id, auth_mode, region)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      req.user.id,
      label,
      kindVal,
      providerVal,
      hostVal || 'smtp.office365.com',
      portVal,
      secureVal ? 1 : 0,
      userVal || from_email || '',
      password || (kindVal === 'office365' ? 'graph' : ''),
      from_name || label,
      from_email,
      sms_gateway,
      office_tenant_id || null,
      modeVal || (kindVal === 'office365' ? 'graph' : ''),
      regionVal || ''
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
