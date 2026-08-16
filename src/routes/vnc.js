import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth, requireAdmin } from '../auth.js';
import { MAX_TARGETS, parseTarget, publicTarget, wsPath } from '../vnc.js';

const router = Router();
router.use(requireAuth, requireAdmin);

function targetFor(req, id) {
  return db
    .prepare('SELECT * FROM vnc_targets WHERE id = ? AND user_id = ?')
    .get(parseInt(id, 10), req.user.id);
}

router.get('/', (req, res) => {
  const targets = db
    .prepare('SELECT * FROM vnc_targets WHERE user_id = ? ORDER BY id DESC')
    .all(req.user.id)
    .map((row) => publicTarget(row));
  res.json({ targets, default_port: 5900, max: MAX_TARGETS });
});

router.post('/', (req, res) => {
  if (!req.body?.owned_ok) {
    return res.status(400).json({
      error: 'Confirm this desktop is yours or a machine you are allowed to operate.',
    });
  }
  const parsed = parseTarget(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const n = db.prepare('SELECT COUNT(*) n FROM vnc_targets WHERE user_id = ?').get(req.user.id).n;
  if (n >= MAX_TARGETS) return res.status(400).json({ error: `At most ${MAX_TARGETS} VNC desktops per account` });

  const info = db
    .prepare(
      `INSERT INTO vnc_targets (user_id, label, host, port, password, view_only)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(req.user.id, parsed.label, parsed.host, parsed.port, parsed.password || '', parsed.view_only ? 1 : 0);
  const row = db.prepare('SELECT * FROM vnc_targets WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(publicTarget(row));
});

router.patch('/:id', (req, res) => {
  const row = targetFor(req, req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  const parsed = parseTarget({
    label: req.body.label ?? row.label,
    host: req.body.host ?? row.host,
    port: req.body.port ?? row.port,
    password: req.body.password == null || req.body.password === '' ? row.password : req.body.password,
    view_only: req.body.view_only == null ? row.view_only : req.body.view_only,
  });
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  db.prepare(
    `UPDATE vnc_targets SET label=?, host=?, port=?, password=?, view_only=? WHERE id=? AND user_id=?`
  ).run(parsed.label, parsed.host, parsed.port, parsed.password || '', parsed.view_only ? 1 : 0, row.id, req.user.id);
  res.json(publicTarget(db.prepare('SELECT * FROM vnc_targets WHERE id = ?').get(row.id)));
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM vnc_targets WHERE id = ? AND user_id = ?').run(parseInt(req.params.id, 10), req.user.id);
  res.json({ ok: true });
});

router.get('/:id/session', (req, res) => {
  const row = targetFor(req, req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json({
    ...publicTarget(row, { includePassword: true }),
    ws_path: wsPath(row.id),
  });
});

export default router;
