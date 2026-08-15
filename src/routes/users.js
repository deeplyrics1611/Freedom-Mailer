import { Router } from 'express';
import { db } from '../db.js';
import { hashPassword, requireAuth, requireAdmin } from '../auth.js';
import { LICENSE_PLANS, planById, computeExpiry, extendExpiry, publicUser } from '../license.js';
import { parseFeatures } from '../features.js';
import { logAdmin } from '../audit.js';

const router = Router();
router.use(requireAuth, requireAdmin);

router.get('/plans', (req, res) => {
  res.json({ plans: LICENSE_PLANS });
});

router.get('/', (req, res) => {
  const users = db
    .prepare(
      'SELECT id, email, role, daily_quota, active, license_plan, license_expires_at, features, notes, last_login, created_at FROM users ORDER BY id'
    )
    .all();
  res.json(users.map((u) => publicUser(u)));
});

function applyPlan(planId, mode, currentExpiry) {
  if (mode === 'extend' && planId !== 'lifetime') {
    return extendExpiry(planId, currentExpiry);
  }
  return computeExpiry(planId);
}

router.post('/', (req, res) => {
  const { email, password, role = 'user', daily_quota, license_plan = '3day' } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  if (String(password).length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }
  const plan = planById(license_plan) || (role === 'admin' ? planById('lifetime') : null);
  if (!plan) return res.status(400).json({ error: 'license_plan must be 3day, monthly, or lifetime' });
  const expiry = role === 'admin' ? computeExpiry('lifetime') : computeExpiry(plan.id);
  const quota = daily_quota !== undefined && daily_quota !== '' ? parseInt(daily_quota, 10) : plan.dailyQuota;
  try {
    const info = db
      .prepare(
        `INSERT INTO users (email, password_hash, role, daily_quota, license_plan, license_expires_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        String(email).toLowerCase(),
        hashPassword(password),
        role === 'admin' ? 'admin' : 'user',
        quota,
        role === 'admin' ? 'lifetime' : plan.id,
        expiry.expires_at
      );
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
    logAdmin(req.user, 'create_client', user.id, { email: user.email, license_plan: user.license_plan });
    res.status(201).json(publicUser(user));
  } catch (e) {
    if (String(e).includes('UNIQUE')) return res.status(409).json({ error: 'Email already exists' });
    throw e;
  }
});

router.patch('/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: 'Not found' });
  const { role, daily_quota, active, password, license_plan, license_action, notes, features } = req.body || {};
  if (role !== undefined) {
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role === 'admin' ? 'admin' : 'user', id);
    if (role === 'admin') {
      db.prepare("UPDATE users SET license_plan = 'lifetime', license_expires_at = NULL WHERE id = ?").run(id);
    }
  }
  if (daily_quota !== undefined) db.prepare('UPDATE users SET daily_quota = ? WHERE id = ?').run(daily_quota, id);
  if (active !== undefined) db.prepare('UPDATE users SET active = ? WHERE id = ?').run(active ? 1 : 0, id);
  if (password) {
    if (String(password).length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), id);
  }
  if (license_plan) {
    const action = license_action === 'extend' ? 'extend' : 'set';
    const next = applyPlan(license_plan, action, user.license_expires_at);
    if (next.error) return res.status(400).json({ error: next.error });
    const plan = planById(next.plan);
    db.prepare('UPDATE users SET license_plan = ?, license_expires_at = ? WHERE id = ?').run(
      next.plan,
      next.expires_at,
      id
    );
    if (daily_quota === undefined && plan && user.role !== 'admin' && action === 'set') {
      db.prepare('UPDATE users SET daily_quota = ? WHERE id = ?').run(plan.dailyQuota, id);
    }
  }
  if (notes !== undefined) {
    db.prepare('UPDATE users SET notes = ? WHERE id = ?').run(String(notes).slice(0, 500), id);
  }
  if (features && typeof features === 'object') {
    db.prepare('UPDATE users SET features = ? WHERE id = ?').run(JSON.stringify(parseFeatures(features)), id);
  }
  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  logAdmin(req.user, 'patch_client', id, {
    role,
    daily_quota,
    active,
    password: password ? 'reset' : undefined,
    license_plan,
    license_action,
    notes: notes !== undefined,
  });
  res.json(publicUser(updated));
});

router.delete('/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (id === req.user.id) return res.status(400).json({ error: 'Cannot delete yourself' });
  const gone = db.prepare('SELECT email FROM users WHERE id = ?').get(id);
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  logAdmin(req.user, 'delete_client', id, { email: gone?.email || '' });
  res.json({ ok: true });
});

export default router;
