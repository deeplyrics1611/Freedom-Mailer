import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth } from '../auth.js';
import { suppress, newToken } from '../compliance.js';
import { parseContactCsv } from '../validate.js';
import { splitName } from '../placeholders.js';

const router = Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  const rows = db
    .prepare(
      `SELECT id, email, name, first_name, last_name, company, title, phone,
              validation_status, validation_score, validation_reason, validated_at, created_at
       FROM contacts WHERE user_id = ? ORDER BY id DESC LIMIT 2000`
    )
    .all(req.user.id);
  res.json(rows);
});

router.post('/', (req, res) => {
  const {
    email, name = '', first_name = '', last_name = '', company = '', title = '', phone = '',
  } = req.body || {};
  if (!email) return res.status(400).json({ error: 'Email required' });
  const addr = String(email).toLowerCase().trim();
  const split = splitName(name);
  try {
    const info = db
      .prepare(
        `INSERT INTO contacts (user_id, email, name, first_name, last_name, company, title, phone)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        req.user.id,
        addr,
        name || [first_name, last_name].filter(Boolean).join(' '),
        first_name || split.first,
        last_name || split.last,
        company,
        title,
        phone
      );
    res.status(201).json({ id: info.lastInsertRowid });
  } catch (e) {
    if (String(e).includes('UNIQUE')) return res.status(409).json({ error: 'Contact already exists' });
    throw e;
  }
});

router.post('/import', (req, res) => {
  const { csv, list_id, preConfirmed = false } = req.body || {};
  if (!csv) return res.status(400).json({ error: 'csv text required' });
  const rows = parseContactCsv(csv);
  if (!rows.length) return res.status(400).json({ error: 'No rows with an email column found' });
  if (rows.length > 5000) return res.status(400).json({ error: 'Max 5000 rows per import' });

  let list = null;
  if (list_id) {
    list = db.prepare('SELECT * FROM lists WHERE id = ? AND user_id = ?').get(parseInt(list_id, 10), req.user.id);
    if (!list) return res.status(400).json({ error: 'List not found' });
  }

  const insertContact = db.prepare(
    `INSERT INTO contacts (user_id, email, name, first_name, last_name, company, title, phone)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, email) DO UPDATE SET
       name = COALESCE(NULLIF(excluded.name, ''), contacts.name),
       first_name = COALESCE(NULLIF(excluded.first_name, ''), contacts.first_name),
       last_name = COALESCE(NULLIF(excluded.last_name, ''), contacts.last_name),
       company = COALESCE(NULLIF(excluded.company, ''), contacts.company),
       title = COALESCE(NULLIF(excluded.title, ''), contacts.title),
       phone = COALESCE(NULLIF(excluded.phone, ''), contacts.phone)`
  );
  const insertSub = list
    ? db.prepare(
        `INSERT INTO subscriptions (contact_id, list_id, status, token, confirmed_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(contact_id, list_id) DO NOTHING`
      )
    : null;

  let imported = 0;
  const tx = db.transaction(() => {
    for (const r of rows) {
      const name = r.name || [r.first_name, r.last_name].filter(Boolean).join(' ');
      insertContact.run(req.user.id, r.email, name, r.first_name, r.last_name, r.company, r.title, r.phone);
      imported++;
      if (insertSub) {
        const contact = db.prepare('SELECT id FROM contacts WHERE user_id = ? AND email = ?').get(req.user.id, r.email);
        const status = preConfirmed ? 'confirmed' : 'pending';
        const confirmedAt = preConfirmed ? new Date().toISOString() : null;
        insertSub.run(contact.id, list.id, status, newToken(), confirmedAt);
      }
    }
  });
  tx();
  res.status(201).json({ imported, list_id: list ? list.id : null });
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
