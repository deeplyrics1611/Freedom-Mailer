import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth, requireFeature } from '../auth.js';
import {
  newLinkCode,
  shortUrl,
  staticValidate,
  probeUrl,
  extractUrls,
} from '../links.js';

const router = Router();
router.use(requireAuth, requireFeature('links'));

function rowOut(r, user) {
  return {
    ...r,
    short_url: shortUrl(r.code, user),
  };
}

router.get('/', (req, res) => {
  const rows = db
    .prepare(
      `SELECT id, label, code, destination, mode, title, clicks, bot_hits, human_hits,
              last_score, last_verdict, last_checked, active, created_at
       FROM short_links WHERE user_id = ? ORDER BY id DESC`
    )
    .all(req.user.id);
  res.json(rows.map((r) => rowOut(r, req.user)));
});

router.post('/validate', async (req, res) => {
  const { url = '', html = '' } = req.body || {};
  try {
    if (html) {
      const urls = extractUrls(html);
      const reports = [];
      for (const u of urls.slice(0, 15)) {
        reports.push(await probeUrl(u));
      }
      return res.json({ reports, count: urls.length });
    }
    const report = await probeUrl(url);
    res.json(report);
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

router.post('/', async (req, res) => {
  const { label = '', destination, mode = 'redirect', title = '', check = true } = req.body || {};
  if (!destination) return res.status(400).json({ error: 'destination is required' });

  let report = staticValidate(destination);
  if (check) {
    try {
      report = await probeUrl(destination);
    } catch {
      /* keep static */
    }
  }
  if (!report.ok) {
    return res.status(400).json({
      error: report.issues[0] || 'URL is not safe to wrap for email',
      report,
    });
  }
  if (!['redirect', 'landing'].includes(mode)) {
    return res.status(400).json({ error: 'mode must be redirect or landing' });
  }

  let code = newLinkCode();
  for (let i = 0; i < 5; i++) {
    const clash = db.prepare('SELECT 1 FROM short_links WHERE code = ?').get(code);
    if (!clash) break;
    code = newLinkCode();
  }

  const info = db
    .prepare(
      `INSERT INTO short_links
        (user_id, label, code, destination, mode, title, last_score, last_verdict, last_checked)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
    )
    .run(
      req.user.id,
      label || report.host || 'Link',
      code,
      report.final_url || report.url,
      mode,
      title,
      report.score,
      report.verdict
    );
  const row = db.prepare('SELECT * FROM short_links WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ ...rowOut(row, req.user), report });
});

router.post('/wrap-html', async (req, res) => {
  const { html = '', mode = 'redirect' } = req.body || {};
  if (!html) return res.status(400).json({ error: 'html is required' });
    const urls = extractUrls(html)
      .filter((u) => !u.includes('/l/'))
      .sort((a, b) => b.length - a.length);
  let out = html;
  const created = [];
  for (const u of urls.slice(0, 20)) {
    const report = staticValidate(u);
    if (!report.ok) continue;
    let code = newLinkCode();
    db.prepare(
      `INSERT INTO short_links (user_id, label, code, destination, mode, last_score, last_verdict, last_checked)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`
    ).run(req.user.id, report.host, code, report.url, mode, report.score, report.verdict);
    const short = shortUrl(code, req.user);
    out = out.split(u).join(short);
    created.push({ from: u, to: short });
  }
  res.json({ html: out, created });
});

router.get('/:id/clicks', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const link = db.prepare('SELECT * FROM short_links WHERE id = ? AND user_id = ?').get(id, req.user.id);
  if (!link) return res.status(404).json({ error: 'Not found' });
  const clicks = db
    .prepare(
      `SELECT id, kind, marker, created_at FROM link_clicks WHERE link_id = ? ORDER BY id DESC LIMIT 100`
    )
    .all(id);
  res.json({ link: rowOut(link, req.user), clicks });
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM short_links WHERE id = ? AND user_id = ?').run(
    parseInt(req.params.id, 10),
    req.user.id
  );
  res.json({ ok: true });
});

export default router;
