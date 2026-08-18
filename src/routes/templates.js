import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth } from '../auth.js';
import { RFQ_TEMPLATES } from '../lib/starters.js';

const router = Router();
router.use(requireAuth);

// Built-in quote-request copy to start from.
router.get('/starters', (req, res) => res.json(RFQ_TEMPLATES));

router.get('/', (req, res) => {
  res.json(db.prepare('SELECT * FROM templates WHERE user_id = ? ORDER BY id DESC').all(req.user.id));
});

router.post('/', (req, res) => {
  const { name, subject = '', html = '', text = '' } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Name required' });
  const info = db
    .prepare('INSERT INTO templates (user_id, name, subject, html, text) VALUES (?, ?, ?, ?, ?)')
    .run(req.user.id, name, subject, html, text);
  res.status(201).json({ id: info.lastInsertRowid });
});

router.put('/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const t = db.prepare('SELECT * FROM templates WHERE id = ? AND user_id = ?').get(id, req.user.id);
  if (!t) return res.status(404).json({ error: 'Not found' });
  const { name = t.name, subject = t.subject, html = t.html, text = t.text } = req.body || {};
  db.prepare('UPDATE templates SET name = ?, subject = ?, html = ?, text = ? WHERE id = ?').run(
    name, subject, html, text, id
  );
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM templates WHERE id = ? AND user_id = ?').run(
    parseInt(req.params.id, 10),
    req.user.id
  );
  res.json({ ok: true });
});

export default router;
