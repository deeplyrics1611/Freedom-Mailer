import { Router } from 'express';
import { db } from '../db.js';
import { verifyPassword, hashPassword, signToken, requireAuth } from '../auth.js';
import { licenseStatus, publicUser } from '../license.js';

const router = Router();

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
  res.json({
    token: signToken(user),
    user: publicUser(user),
  });
});

router.get('/me', requireAuth, (req, res) => {
  res.json(publicUser(req.user));
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
