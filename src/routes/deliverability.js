import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth } from '../auth.js';
import { debounceEmails, lookupMx } from '../deliverability.js';

const router = Router();
router.use(requireAuth);

const CACHE_HOURS = 24;

function cachedLookup(domain) {
  const row = db
    .prepare(
      `SELECT mx_json, error FROM mx_cache
       WHERE domain = ? AND checked_at >= datetime('now', ?)`
    )
    .get(domain, `-${CACHE_HOURS} hours`);
  if (row) {
    try {
      return Promise.resolve({ mx: JSON.parse(row.mx_json || '[]'), error: row.error || '' });
    } catch {
      /* miss */
    }
  }
  return lookupMx(domain).then((rec) => {
    db.prepare(
      `INSERT INTO mx_cache (domain, mx_json, error, checked_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(domain) DO UPDATE SET
         mx_json = excluded.mx_json,
         error = excluded.error,
         checked_at = excluded.checked_at`
    ).run(domain, JSON.stringify(rec.mx || []), rec.error || '');
    return rec;
  });
}

router.post('/check', async (req, res) => {
  const { text = '' } = req.body || {};
  if (!String(text).trim()) return res.status(400).json({ error: 'Paste addresses to check' });
  try {
    const out = await debounceEmails(text, { lookup: cachedLookup, max: 400 });
    res.json(out);
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

export default router;
