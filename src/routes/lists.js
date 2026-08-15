import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth, requireFeature } from '../auth.js';
import { newToken, confirmUrl } from '../compliance.js';
import { parseLeads } from '../leads.js';

const router = Router();
router.use(requireAuth, requireFeature('campaigns'));

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

  const {
    email,
    name = '',
    phone = '',
    company = '',
    title = '',
    custom1 = '',
    custom2 = '',
    consent_ip = '',
    preConfirmed = false,
  } = req.body || {};
  if (!email) return res.status(400).json({ error: 'Email required' });
  const addr = String(email).toLowerCase();

  let contact = db.prepare('SELECT * FROM contacts WHERE user_id = ? AND email = ?').get(req.user.id, addr);
  if (!contact) {
    const info = db
      .prepare(
        'INSERT INTO contacts (user_id, email, name, phone, company, title, custom1, custom2) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .run(req.user.id, addr, name, phone, company, title, custom1, custom2);
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
    confirm_url: preConfirmed ? null : confirmUrl(token, req.user),
  });
});

// Paste many leads into a list (copy/paste, not file upload).
router.post('/:id/paste', (req, res) => {
  const listId = parseInt(req.params.id, 10);
  const list = db.prepare('SELECT * FROM lists WHERE id = ? AND user_id = ?').get(listId, req.user.id);
  if (!list) return res.status(404).json({ error: 'Not found' });

  const { text = '', preConfirmed = false, consent = false } = req.body || {};
  if (!consent) {
    return res.status(400).json({ error: 'Confirm these people opted in to hear from you.' });
  }
  const parsed = parseLeads(text);
  if (!parsed.leads.length) {
    return res.status(400).json({ error: 'No valid emails in the paste box', invalid: parsed.invalid.slice(0, 20) });
  }

  let added = 0;
  const insertContact = db.prepare(
    `INSERT INTO contacts (user_id, email, name, phone, company, title, custom1, custom2)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, email) DO UPDATE SET
       name = COALESCE(NULLIF(excluded.name, ''), contacts.name),
       phone = COALESCE(NULLIF(excluded.phone, ''), contacts.phone),
       company = COALESCE(NULLIF(excluded.company, ''), contacts.company),
       title = COALESCE(NULLIF(excluded.title, ''), contacts.title),
       custom1 = COALESCE(NULLIF(excluded.custom1, ''), contacts.custom1),
       custom2 = COALESCE(NULLIF(excluded.custom2, ''), contacts.custom2)`
  );
  const getContact = db.prepare('SELECT * FROM contacts WHERE user_id = ? AND email = ?');
  const insertSub = db.prepare(
    `INSERT INTO subscriptions (contact_id, list_id, status, token, confirmed_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(contact_id, list_id) DO UPDATE SET
       status = CASE WHEN subscriptions.status = 'unsubscribed' THEN subscriptions.status ELSE excluded.status END`
  );

  const tx = db.transaction((leads) => {
    for (const lead of leads) {
      insertContact.run(
        req.user.id,
        lead.email,
        lead.name || '',
        lead.phone || '',
        lead.company || '',
        lead.title || '',
        lead.custom1 || '',
        lead.custom2 || ''
      );
      const contact = getContact.get(req.user.id, lead.email);
      const token = newToken();
      const status = preConfirmed ? 'confirmed' : 'pending';
      const confirmedAt = preConfirmed ? new Date().toISOString() : null;
      insertSub.run(contact.id, listId, status, token, confirmedAt);
      added++;
    }
  });
  tx(parsed.leads);

  res.status(201).json({
    ok: true,
    added,
    invalid: parsed.invalid.slice(0, 20),
    status: preConfirmed ? 'confirmed' : 'pending',
  });
});

export default router;
