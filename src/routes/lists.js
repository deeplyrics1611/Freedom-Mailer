import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth } from '../auth.js';
import { newToken, confirmUrl } from '../compliance.js';

const router = Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  const lists = db
    .prepare(
      `SELECT l.*,
        (SELECT COUNT(*) FROM subscriptions s JOIN contacts c ON c.id = s.contact_id
           WHERE s.list_id = l.id AND s.status = 'confirmed') AS confirmed,
        (SELECT COUNT(*) FROM subscriptions s WHERE s.list_id = l.id AND s.status = 'pending') AS pending
       FROM lists l WHERE l.user_id = ? ORDER BY l.id DESC`
    )
    .all(req.user.id);
  res.json(lists);
});

router.post('/', (req, res) => {
  const { name, description = '' } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Name required' });
  const info = db
    .prepare('INSERT INTO lists (user_id, name, description) VALUES (?, ?, ?)')
    .run(req.user.id, name, description);
  res.status(201).json({ id: info.lastInsertRowid });
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM lists WHERE id = ? AND user_id = ?').run(
    parseInt(req.params.id, 10),
    req.user.id
  );
  res.json({ ok: true });
});

// Subscribers of a list with their status.
router.get('/:id/subscribers', (req, res) => {
  const listId = parseInt(req.params.id, 10);
  const list = db.prepare('SELECT * FROM lists WHERE id = ? AND user_id = ?').get(listId, req.user.id);
  if (!list) return res.status(404).json({ error: 'Not found' });
  const rows = db
    .prepare(
      `SELECT c.id AS contact_id, c.email, c.name, s.status, s.confirmed_at, s.created_at
       FROM subscriptions s JOIN contacts c ON c.id = s.contact_id
       WHERE s.list_id = ? ORDER BY s.created_at DESC`
    )
    .all(listId);
  res.json(rows);
});

// Add a contact to a list. Creates a PENDING subscription and returns a
// confirmation link. Double opt-in: the contact must confirm before they can
// be emailed in a campaign. `preConfirmed` is allowed ONLY with a recorded
// consent source (e.g. imported opt-in records) and is logged.
router.post('/:id/subscribe', (req, res) => {
  const listId = parseInt(req.params.id, 10);
  const list = db.prepare('SELECT * FROM lists WHERE id = ? AND user_id = ?').get(listId, req.user.id);
  if (!list) return res.status(404).json({ error: 'Not found' });

  const { email, name = '', phone = '', consent_ip = '', preConfirmed = false } = req.body || {};
  if (!email) return res.status(400).json({ error: 'Email required' });
  const addr = String(email).toLowerCase();

  let contact = db.prepare('SELECT * FROM contacts WHERE user_id = ? AND email = ?').get(req.user.id, addr);
  if (!contact) {
    const info = db
      .prepare('INSERT INTO contacts (user_id, email, name, phone) VALUES (?, ?, ?, ?)')
      .run(req.user.id, addr, name, phone);
    contact = { id: info.lastInsertRowid };
  }

  const token = newToken();
  const status = preConfirmed ? 'confirmed' : 'pending';
  const confirmedAt = preConfirmed ? new Date().toISOString() : null;
  db.prepare(
    `INSERT INTO subscriptions (contact_id, list_id, status, token, consent_ip, confirmed_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(contact_id, list_id) DO UPDATE SET
       status = CASE WHEN subscriptions.status = 'unsubscribed' THEN subscriptions.status ELSE excluded.status END`
  ).run(contact.id, listId, status, token, consent_ip, confirmedAt);

  res.status(201).json({
    ok: true,
    status,
    confirm_url: preConfirmed ? null : confirmUrl(token),
  });
});

export default router;
