import { Router } from 'express';
import { db } from '../db.js';
import { verifyPassword, hashPassword, signToken, requireAuth } from '../auth.js';
import { licenseStatus, publicUser } from '../license.js';
import { allSettings } from '../settings.js';
import { parseLinkBase, probeLinkHost, mailerHostname, isLocalMailerHost } from '../links.js';

const router = Router();

function sessionUser(user, settings = allSettings()) {
  return {
    ...publicUser(user),
    banner: settings.banner,
    maintenance: settings.maintenance === '1',
    pause_sends: settings.pause_sends === '1',
    mailer_host: mailerHostname(),
    mailer_local: isLocalMailerHost(),
  };
}

router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(String(email).toLowerCase());
  if (!user || !user.active || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const license = licenseStatus(user);
  if (user.role !== 'admin' && !license.ok) {
    return res.status(403).json({
      error: 'License expired. Ask the admin to renew your access.',
      license,
    });
  }
  db.prepare("UPDATE users SET last_login = datetime('now') WHERE id = ?").run(user.id);
  user.last_login = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const settings = allSettings();
  res.json({
    token: signToken(user),
    user: sessionUser(user, settings),
  });
});

router.get('/me', requireAuth, (req, res) => {
  const settings = allSettings();
  res.json(sessionUser(req.user, settings));
});

router.post('/link-domain/check', requireAuth, async (req, res) => {
  try {
    const result = await probeLinkHost(req.body?.link_base_url);
    if (!result.ok && result.error && !result.host && !result.dns_ok) {
      return res.status(400).json({ error: result.error });
    }
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: 'Could not check that hostname' });
  }
});

router.patch('/link-domain', requireAuth, (req, res) => {
  const parsed = parseLinkBase(req.body?.link_base_url);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  db.prepare('UPDATE users SET link_base_url = ? WHERE id = ?').run(parsed.url, req.user.id);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.json({ ...publicUser(user), warnings: parsed.warnings || [] });
});

router.post('/change-password', requireAuth, (req, res) => {
  const { current, next } = req.body || {};
  if (!next || String(next).length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters' });
  }
  if (!verifyPassword(current || '', req.user.password_hash)) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(
    hashPassword(next),
    req.user.id
  );
  res.json({ ok: true });
});

export default router;
