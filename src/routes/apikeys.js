import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth, newApiKey } from '../auth.js';

const router = Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  const keys = db
    .prepare(
      'SELECT id, name, key_prefix, last_used, revoked, created_at FROM api_keys WHERE user_id = ? ORDER BY id DESC'
    )
    .all(req.user.id);
  res.json(keys);
});

router.post('/', (req, res) => {
  const { name } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Name required' });
  const { full, prefix, hash } = newApiKey();
  const info = db
    .prepare('INSERT INTO api_keys (user_id, name, key_prefix, key_hash) VALUES (?, ?, ?, ?)')
    .run(req.user.id, name, prefix, hash);
  // The full key is returned exactly once.
  res.status(201).json({ id: info.lastInsertRowid, name, key: full });
});

router.post('/:id/revoke', (req, res) => {
  const id = parseInt(req.params.id, 10);
  db.prepare('UPDATE api_keys SET revoked = 1 WHERE id = ? AND user_id = ?').run(id, req.user.id);
  res.json({ ok: true });
});

export default router;
