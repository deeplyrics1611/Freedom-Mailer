import { Router } from 'express';
import { db } from '../db.js';
import { hashPassword, verifyPassword, signToken, requireAuth } from '../auth.js';

const router = Router();

router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(String(email).toLowerCase());
  if (!user || !user.active || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  res.json({
    token: signToken(user),
    user: { id: user.id, email: user.email, role: user.role },
  });
});

router.get('/me', requireAuth, (req, res) => {
  const u = req.user;
  res.json({
    id: u.id,
    email: u.email,
    role: u.role,
    daily_quota: u.daily_quota,
    company_name: u.company_name || '',
    physical_address: u.physical_address || '',
    sender_title: u.sender_title || '',
  });
});

router.post('/profile', requireAuth, (req, res) => {
  const { company_name, physical_address, sender_title } = req.body || {};
  db.prepare(
    'UPDATE users SET company_name = ?, physical_address = ?, sender_title = ? WHERE id = ?'
  ).run(
    company_name != null ? String(company_name) : req.user.company_name || '',
    physical_address != null ? String(physical_address) : req.user.physical_address || '',
    sender_title != null ? String(sender_title) : req.user.sender_title || '',
    req.user.id
  );
  res.json({ ok: true });
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
