import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth, requireFeature } from '../auth.js';
import { debounceEmails, inspectMailDomain, normalizeMxRecord } from '../deliverability.js';

const router = Router();
router.use(requireAuth, requireFeature('deliverability'));

const CACHE_HOURS = 6;

function readCached(domain) {
  const row = db
    .prepare(
      `SELECT mx_json, error FROM mx_cache
       WHERE domain = ? AND checked_at >= datetime('now', ?)`
    )
    .get(domain, `-${CACHE_HOURS} hours`);
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.mx_json || '[]');
    if (Array.isArray(parsed)) return normalizeMxRecord({ mx: parsed, error: row.error || '' });
    return normalizeMxRecord(parsed);
  } catch {
    return null;
  }
}

function writeCached(domain, rec) {
  db.prepare(
    `INSERT INTO mx_cache (domain, mx_json, error, checked_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(domain) DO UPDATE SET
       mx_json = excluded.mx_json,
       error = excluded.error,
       checked_at = excluded.checked_at`
  ).run(domain, JSON.stringify(rec), rec.error || '');
}

async function inspectCached(domain, { fresh = false, probe = true } = {}) {
  if (!fresh) {
    const hit = readCached(domain);
    if (hit) return { ...hit, cached: true };
  }
  const rec = await inspectMailDomain(domain, { probe });
  writeCached(domain, rec);
  return { ...rec, cached: false };
}

function sourceFromBody(body) {
  const emails = body?.emails;
  if (Array.isArray(emails) && emails.length) return emails.map((e) => String(e || '')).filter(Boolean);
  return String(body?.text || '');
}

router.post('/check', async (req, res) => {
  const source = sourceFromBody(req.body);
  if (!source || (typeof source === 'string' && !source.trim()) || (Array.isArray(source) && !source.length)) {
    return res.status(400).json({ error: 'Paste addresses to check' });
  }
  const fresh = !!req.body?.fresh;
  const probe = req.body?.probe !== false;
  try {
    const out = await debounceEmails(source, {
      lookup: (domain) => inspectCached(domain, { fresh, probe }),
      max: 500,
      probe,
    });
    res.json(out);
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

router.post('/mx', async (req, res) => {
  const domain = String(req.body?.domain || '')
    .trim()
    .toLowerCase();
  if (!domain || domain.length > 253) return res.status(400).json({ error: 'domain required' });
  try {
    const rec = await inspectCached(domain, { fresh: !!req.body?.fresh, probe: req.body?.probe !== false });
    res.json(rec);
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

export default router;
