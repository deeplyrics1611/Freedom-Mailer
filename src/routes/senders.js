import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth } from '../auth.js';
import { verifyTransport } from '../mailer.js';
import { encryptSecret } from '../secrets.js';
import { smtpGroups, smtpById, socks5Url } from '../smtpCatalog.js';
import { extractSmtp } from '../smtpExtract.js';

const router = Router();
router.use(requireAuth);

const publicFields =
  `id, label, host, port, secure, username, from_name, from_email, verified, kind,
   in_rotation, daily_limit, sent_today, sent_date, last_used_at, active, created_at,
   provider, region, socks5_host, socks5_port, socks5_user`;

router.get('/catalog', (_req, res) => res.json({ groups: smtpGroups() }));

router.post('/extract', async (req, res) => {
  const text = req.body?.text || req.body?.email || req.body?.host || '';
  try {
    const result = await extractSmtp(text, { lookupMx: req.body?.lookup_mx !== false });
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

router.get('/', (req, res) => {
  res.json(
    db.prepare(`SELECT ${publicFields} FROM senders WHERE user_id = ? ORDER BY id DESC`).all(req.user.id)
  );
});

router.post('/', (req, res) => {
  const {
    label, host, port = 587, secure = false, username, password, from_name, from_email,
    provider = 'smtp', region = '', catalog_id, socks5_host = '', socks5_port = 1080,
    socks5_user = '', socks5_pass = '', daily_limit = 500, in_rotation = false,
  } = req.body || {};

  let h = host, p = parseInt(port, 10) || 587, sec = !!secure, user = username;
  let kind = 'smtp';
  let prov = provider;
  let reg = region;
  if (catalog_id) {
    const c = smtpById(catalog_id);
    if (c) {
      h = h || c.host;
      if (!port) p = c.port;
      kind = c.kind || 'smtp';
      prov = c.id;
      reg = c.region || '';
      if (!user && c.defaultUsername) user = c.defaultUsername;
    }
  }
  if (!label || !h || !user || !password || !from_email) {
    return res.status(400).json({ error: 'label, host, username, password, from_email are required' });
  }
  if (socks5_host) {
    try { socks5Url({ host: socks5_host, port: socks5_port, user: socks5_user, pass: socks5_pass || 'x' }); }
    catch (e) { return res.status(400).json({ error: String(e.message || e) }); }
  }

  const info = db
    .prepare(
      `INSERT INTO senders
        (user_id, label, host, port, secure, username, password, from_name, from_email,
         kind, provider, region, socks5_host, socks5_port, socks5_user, socks5_pass, daily_limit, in_rotation)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      req.user.id, label, h, p, sec ? 1 : 0, user, encryptSecret(password),
      from_name || label, from_email, kind, prov, reg,
      socks5_host || '', socks5_port ? parseInt(socks5_port, 10) : null,
      socks5_user || '', socks5_pass ? encryptSecret(socks5_pass) : '',
      Math.max(1, parseInt(daily_limit, 10) || 500),
      in_rotation ? 1 : 0
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
