import { Router } from 'express';
import { db } from '../db.js';
import { hashPassword, requireAuth, requireAdmin } from '../auth.js';

const router = Router();
router.use(requireAuth, requireAdmin);

// Admin-only user management.
router.get('/', (req, res) => {
  const users = db
    .prepare('SELECT id, email, role, daily_quota, active, created_at FROM users ORDER BY id')
    .all();
  res.json(users);
});

router.post('/', (req, res) => {
  const { email, password, role = 'user', daily_quota = 1000 } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  if (String(password).length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }
  try {
    const info = db
      .prepare(
        'INSERT INTO users (email, password_hash, role, daily_quota) VALUES (?, ?, ?, ?)'
      )
      .run(String(email).toLowerCase(), hashPassword(password), role === 'admin' ? 'admin' : 'user', daily_quota);
    res.status(201).json({ id: info.lastInsertRowid });
  } catch (e) {
    if (String(e).includes('UNIQUE')) return res.status(409).json({ error: 'Email already exists' });
    throw e;
  }
});

router.patch('/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: 'Not found' });
  const { role, daily_quota, active, password } = req.body || {};
  if (role !== undefined) db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role === 'admin' ? 'admin' : 'user', id);
  if (daily_quota !== undefined) db.prepare('UPDATE users SET daily_quota = ? WHERE id = ?').run(daily_quota, id);
  if (active !== undefined) db.prepare('UPDATE users SET active = ? WHERE id = ?').run(active ? 1 : 0, id);
  if (password) db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), id);
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (id === req.user.id) return res.status(400).json({ error: 'Cannot delete yourself' });
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  res.json({ ok: true });
});

export default router;
