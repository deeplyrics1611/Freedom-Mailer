import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth } from '../auth.js';
import { newToken } from '../compliance.js';
import { parseCsv, toCsv, canonicalHeader, findEmailColumn } from '../lib/csv.js';
import { canonicalize, parseAddress } from '../lib/verify-email.js';

const router = Router();
router.use(requireAuth);

const int = (v, fallback = 0) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
};

const STATUS_COUNTS = `
  (SELECT COUNT(*) FROM leads WHERE lead_list_id = ll.id) AS total,
  (SELECT COUNT(*) FROM leads WHERE lead_list_id = ll.id AND status = 'valid') AS valid,
  (SELECT COUNT(*) FROM leads WHERE lead_list_id = ll.id AND status = 'invalid') AS invalid,
  (SELECT COUNT(*) FROM leads WHERE lead_list_id = ll.id AND status = 'risky') AS risky,
  (SELECT COUNT(*) FROM leads WHERE lead_list_id = ll.id AND status = 'catch_all') AS catch_all,
  (SELECT COUNT(*) FROM leads WHERE lead_list_id = ll.id AND status = 'unknown') AS unknown,
  (SELECT COUNT(*) FROM leads WHERE lead_list_id = ll.id AND status = 'unchecked') AS unchecked,
  (SELECT COUNT(*) FROM leads WHERE lead_list_id = ll.id AND opted_out = 1) AS opted_out`;

router.get('/', (req, res) => {
  res.json(
    db.prepare(`SELECT ll.*, ${STATUS_COUNTS} FROM lead_lists ll WHERE ll.user_id = ? ORDER BY ll.id DESC`)
      .all(req.user.id)
  );
});

router.post('/', (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Name required' });
  const info = db
    .prepare('INSERT INTO lead_lists (user_id, name, description) VALUES (?, ?, ?)')
    .run(req.user.id, name, String(req.body?.description || ''));
  res.status(201).json({ id: info.lastInsertRowid });
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM lead_lists WHERE id = ? AND user_id = ?').run(int(req.params.id), req.user.id);
  res.json({ ok: true });
});

function ownedList(req) {
  return db.prepare('SELECT * FROM lead_lists WHERE id = ? AND user_id = ?').get(int(req.params.id), req.user.id);
}

router.get('/:id/leads', (req, res) => {
  const list = ownedList(req);
  if (!list) return res.status(404).json({ error: 'Not found' });

  const status = String(req.query.status || '').trim();
  const search = String(req.query.search || '').trim();
  const limit = Math.min(500, Math.max(1, int(req.query.limit, 100)));
  const offset = Math.max(0, int(req.query.offset, 0));

  const where = ['lead_list_id = ?'];
  const params = [list.id];
  if (status && status !== 'all') {
    where.push('status = ?');
    params.push(status);
  }
  if (search) {
    where.push('(email LIKE ? OR fields LIKE ?)');
    params.push(`%${search}%`, `%${search}%`);
  }

  const clause = where.join(' AND ');
  const total = db.prepare(`SELECT COUNT(*) n FROM leads WHERE ${clause}`).get(...params).n;
  const rows = db
    .prepare(`SELECT * FROM leads WHERE ${clause} ORDER BY id ASC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset);

  res.json({
    total,
    limit,
    offset,
    leads: rows.map((r) => ({
      ...r,
      fields: JSON.parse(r.fields || '{}'),
      detail: JSON.parse(r.detail || '{}'),
    })),
  });
});

// Merge fields available on this list, with how many leads actually have each.
router.get('/:id/fields', (req, res) => {
  const list = ownedList(req);
  if (!list) return res.status(404).json({ error: 'Not found' });

  const rows = db.prepare('SELECT fields FROM leads WHERE lead_list_id = ?').all(list.id);
  const counts = new Map();
  for (const row of rows) {
    for (const [k, v] of Object.entries(JSON.parse(row.fields || '{}'))) {
      if (String(v ?? '').trim() === '') continue;
      counts.set(k, (counts.get(k) || 0) + 1);
    }
  }
  const fields = [...counts.entries()]
    .map(([field, filled]) => ({ field, filled, total: rows.length, coverage: rows.length ? Math.round((filled / rows.length) * 100) : 0 }))
    .sort((a, b) => b.filled - a.filled);

  // Always available regardless of the CSV columns.
  fields.push(
    { field: 'email', filled: rows.length, total: rows.length, coverage: 100, builtin: true },
    { field: 'domain', filled: rows.length, total: rows.length, coverage: 100, builtin: true },
    { field: 'company_from_domain', filled: rows.length, total: rows.length, coverage: 100, builtin: true }
  );

  res.json({ fields, lead_count: rows.length });
});

/**
 * Import leads from pasted CSV. Column headers are canonicalised (so "First
 * Name", "firstname" and "FIRST_NAME" all become first_name) and every column
 * other than the email becomes an available merge field.
 */
router.post('/:id/import', (req, res) => {
  const list = ownedList(req);
  if (!list) return res.status(404).json({ error: 'Not found' });

  const csv = String(req.body?.csv || '');
  if (!csv.trim()) return res.status(400).json({ error: 'No CSV content supplied' });

  const { headers, rows } = parseCsv(csv);
  if (!rows.length) return res.status(400).json({ error: 'The CSV has a header row but no data rows' });

  const emailColumn = req.body?.email_column || findEmailColumn(headers, rows);
  if (!emailColumn) {
    return res.status(400).json({
      error: 'Could not find an email column. Name one of the columns "email", or pass email_column.',
      headers,
    });
  }

  const skipDuplicates = req.body?.skip_duplicates !== false;
  const seen = new Set(
    skipDuplicates
      ? db.prepare('SELECT email FROM leads WHERE lead_list_id = ?').all(list.id).map((r) => canonicalize(r.email))
      : []
  );

  const report = { imported: 0, duplicates: 0, malformed: 0, suppressed: 0, total_rows: rows.length, examples: {} };
  const note = (bucket, value) => {
    report.examples[bucket] = report.examples[bucket] || [];
    if (report.examples[bucket].length < 5) report.examples[bucket].push(value);
  };

  const suppressed = new Set(
    db.prepare('SELECT email FROM suppressions WHERE user_id = ?').all(req.user.id).map((r) => r.email)
  );

  const insert = db.prepare(
    `INSERT INTO leads (user_id, lead_list_id, email, fields, unsub_token) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(lead_list_id, email) DO NOTHING`
  );

  const run = db.transaction(() => {
    for (const row of rows) {
      const rawEmail = String(row[emailColumn] || '').trim();
      const { valid } = parseAddress(rawEmail);
      if (!rawEmail || !valid || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail)) {
        report.malformed++;
        if (rawEmail) note('malformed', rawEmail);
        continue;
      }
      const email = rawEmail.toLowerCase();
      const canonical = canonicalize(email);

      if (seen.has(canonical)) {
        report.duplicates++;
        note('duplicates', email);
        continue;
      }
      seen.add(canonical);

      // Someone who already opted out must never be re-imported into a sendable
      // audience; keeping them out here is simpler than relying on send-time
      // checks alone.
      if (suppressed.has(email)) {
        report.suppressed++;
        note('suppressed', email);
        continue;
      }

      const fields = {};
      for (const [header, value] of Object.entries(row)) {
        if (header === emailColumn) continue;
        const key = canonicalHeader(header);
        if (key && String(value ?? '').trim() !== '') fields[key] = String(value).trim();
      }
      // Derive first_name when only a full name was supplied — the most common
      // merge field in outreach copy.
      if (!fields.first_name && fields.name) fields.first_name = fields.name.split(/\s+/)[0];
      if (!fields.name && fields.first_name) {
        fields.name = [fields.first_name, fields.last_name].filter(Boolean).join(' ');
      }

      const result = insert.run(req.user.id, list.id, email, JSON.stringify(fields), newToken());
      if (result.changes) report.imported++;
      else report.duplicates++;
    }
  });
  run();

  res.json({ ok: true, email_column: emailColumn, headers, ...report });
});

router.delete('/:id/leads/:leadId', (req, res) => {
  const list = ownedList(req);
  if (!list) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM leads WHERE id = ? AND lead_list_id = ?').run(int(req.params.leadId), list.id);
  res.json({ ok: true });
});

// Remove everything the validator judged undeliverable. Sending to known-bad
// addresses is the fastest way to damage a sending reputation.
router.post('/:id/purge', (req, res) => {
  const list = ownedList(req);
  if (!list) return res.status(404).json({ error: 'Not found' });

  const requested = Array.isArray(req.body?.statuses) ? req.body.statuses : ['invalid'];
  const allowed = requested.filter((s) => ['invalid', 'risky', 'catch_all', 'unknown', 'unchecked'].includes(s));
  if (!allowed.length) return res.status(400).json({ error: 'No valid statuses given' });

  const placeholders = allowed.map(() => '?').join(',');
  const info = db
    .prepare(`DELETE FROM leads WHERE lead_list_id = ? AND status IN (${placeholders})`)
    .run(list.id, ...allowed);
  res.json({ ok: true, removed: info.changes, statuses: allowed });
});

router.get('/:id/export', (req, res) => {
  const list = ownedList(req);
  if (!list) return res.status(404).json({ error: 'Not found' });

  const status = String(req.query.status || 'all');
  const rows =
    status === 'all'
      ? db.prepare('SELECT * FROM leads WHERE lead_list_id = ? ORDER BY id').all(list.id)
      : db.prepare('SELECT * FROM leads WHERE lead_list_id = ? AND status = ? ORDER BY id').all(list.id, status);

  const flat = rows.map((r) => ({
    email: r.email,
    status: r.status,
    score: r.score ?? '',
    reason: r.reason,
    checked_at: r.checked_at || '',
    opted_out: r.opted_out ? 'yes' : 'no',
    ...JSON.parse(r.fields || '{}'),
  }));

  const filename = `${list.name.replace(/[^\w-]+/g, '_')}-${status}.csv`;
  res.setHeader('content-type', 'text/csv; charset=utf-8');
  res.setHeader('content-disposition', `attachment; filename="${filename}"`);
  res.send(toCsv(flat));
});

export default router;
