import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth } from '../auth.js';
import { checkLink, checkLinks } from '../lib/linkcheck.js';
import { extractLinks } from '../lib/spamcheck.js';

const router = Router();
router.use(requireAuth);

const save = (userId, target, score, verdict, report) =>
  db.prepare('INSERT INTO checks (user_id, kind, target, score, verdict, report) VALUES (?, ?, ?, ?, ?, ?)')
    .run(userId, 'link', String(target).slice(0, 200), Math.round(score * 10), verdict, JSON.stringify(report));

router.post('/check', async (req, res) => {
  const url = String(req.body?.url || '').trim();
  if (!url) return res.status(400).json({ error: 'A URL is required' });
  try {
    const report = await checkLink(url, { sendingDomain: String(req.body?.sending_domain || '') });
    save(req.user.id, url, report.score, report.verdict, report);
    res.json(report);
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

/**
 * Check several links at once, or pull every link out of an email body and
 * check those. Checking what is actually in the message is more useful than
 * checking a URL you typed from memory.
 */
router.post('/check-many', async (req, res) => {
  const b = req.body || {};
  let urls = Array.isArray(b.urls) ? b.urls : [];

  if (!urls.length && (b.html || b.text)) {
    urls = extractLinks(String(b.html || ''), String(b.text || '')).map((l) => l.url);
  }
  if (!urls.length && b.urls_text) {
    urls = String(b.urls_text).split(/\s+/).filter((u) => /^https?:\/\//i.test(u));
  }
  if (!urls.length) return res.status(400).json({ error: 'No links found to check' });

  try {
    const results = await checkLinks(urls, { sendingDomain: String(b.sending_domain || '') });
    for (const r of results) save(req.user.id, r.url, r.score, r.verdict, r);

    const worst = results.reduce((min, r) => Math.min(min, r.score), 10);
    res.json({
      results,
      checked: results.length,
      worst_score: worst,
      safe_to_send: results.every((r) => r.score >= 6.5),
      blockers: results
        .filter((r) => r.score < 6.5)
        .map((r) => ({ url: r.url, verdict: r.verdict, reasons: r.findings.filter((f) => f.severity === 'critical').map((f) => f.title) })),
    });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

export default router;
