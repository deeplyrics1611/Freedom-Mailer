import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth } from '../auth.js';
import { suppress } from '../compliance.js';

const router = Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  const rows = db
    .prepare('SELECT id, email, name, phone, created_at FROM contacts WHERE user_id = ? ORDER BY id DESC LIMIT 1000')
    .all(req.user.id);
  res.json(rows);
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM contacts WHERE id = ? AND user_id = ?').run(
    parseInt(req.params.id, 10),
    req.user.id
  );
  res.json({ ok: true });
});

// ---- Suppression list ----
router.get('/suppressions', (req, res) => {
  res.json(
    db.prepare('SELECT id, email, reason, created_at FROM suppressions WHERE user_id = ? ORDER BY id DESC').all(req.user.id)
  );
});

router.post('/suppressions', (req, res) => {
  const { email, reason = 'manual' } = req.body || {};
  if (!email) return res.status(400).json({ error: 'Email required' });
  suppress(req.user.id, String(email).toLowerCase(), reason);
  res.status(201).json({ ok: true });
});

router.delete('/suppressions/:id', (req, res) => {
  db.prepare('DELETE FROM suppressions WHERE id = ? AND user_id = ?').run(
    parseInt(req.params.id, 10),
    req.user.id
  );
  res.json({ ok: true });
});

export default router;
