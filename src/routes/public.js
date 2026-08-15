import { Router } from 'express';
import { db } from '../db.js';
import { suppress } from '../compliance.js';
import { classifyClient, landingHtml } from '../links.js';

// Public, unauthenticated compliance endpoints: double opt-in confirmation
// and one-click unsubscribe. Both are keyed by an unguessable token.
const router = Router();

function page(title, body) {
  return `<!doctype html><html><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title}</title>
  <style>body{font-family:system-ui,sans-serif;max-width:520px;margin:80px auto;padding:0 20px;color:#222}
  .card{border:1px solid #e5e7eb;border-radius:12px;padding:32px;text-align:center}
  h1{font-size:20px}p{color:#555}</style></head>
  <body><div class="card"><h1>${title}</h1><p>${body}</p></div></body></html>`;
}

// GET /c/:token — confirm a pending subscription (double opt-in).
router.get('/c/:token', (req, res) => {
  const sub = db.prepare('SELECT * FROM subscriptions WHERE token = ?').get(req.params.token);
  if (!sub) return res.status(404).send(page('Link not found', 'This confirmation link is invalid or expired.'));
  if (sub.status === 'unsubscribed') {
    return res.send(page('Already unsubscribed', 'You previously unsubscribed from this list.'));
  }
  db.prepare("UPDATE subscriptions SET status = 'confirmed', confirmed_at = datetime('now') WHERE id = ?").run(sub.id);
  res.send(page('Subscription confirmed', 'Thanks! Your subscription is now confirmed.'));
});

// GET /u/:token — one-click unsubscribe.
router.get('/u/:token', (req, res) => {
  const sub = db.prepare('SELECT * FROM subscriptions WHERE token = ?').get(req.params.token);
  if (!sub) return res.status(404).send(page('Link not found', 'This unsubscribe link is invalid.'));
  handleUnsubscribe(sub);
  res.send(page('Unsubscribed', 'You have been unsubscribed and will no longer receive these emails.'));
});

// POST /u/:token — RFC 8058 one-click (List-Unsubscribe-Post).
router.post('/u/:token', (req, res) => {
  const sub = db.prepare('SELECT * FROM subscriptions WHERE token = ?').get(req.params.token);
  if (!sub) return res.status(404).json({ error: 'not found' });
  handleUnsubscribe(sub);
  res.json({ ok: true });
});

function handleUnsubscribe(sub) {
  db.prepare(
    "UPDATE subscriptions SET status = 'unsubscribed', unsubscribed_at = datetime('now') WHERE id = ?"
  ).run(sub.id);
  const contact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(sub.contact_id);
  if (contact) suppress(contact.user_id, contact.email, 'unsubscribe');
}

// GET /l/:code — branded short link. Same destination for every visitor
// (including Safe Links / crawlers). Bots are counted, not sent elsewhere.
router.get('/l/:code', (req, res) => {
  const link = db.prepare('SELECT * FROM short_links WHERE code = ? AND active = 1').get(req.params.code);
  if (!link) return res.status(404).send(page('Link not found', 'This tracking link is invalid or has been disabled.'));

  const ua = req.headers['user-agent'] || '';
  const { kind, marker } = classifyClient(ua);
  db.prepare(
    `INSERT INTO link_clicks (link_id, kind, marker) VALUES (?, ?, ?)`
  ).run(link.id, kind, marker);
  db.prepare(
    `UPDATE short_links SET
       clicks = clicks + 1,
       bot_hits = bot_hits + CASE WHEN ? = 'bot' THEN 1 ELSE 0 END,
       human_hits = human_hits + CASE WHEN ? = 'human' THEN 1 ELSE 0 END
     WHERE id = ?`
  ).run(kind, kind, link.id);

  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  if (link.mode === 'landing') {
    return res
      .type('html')
      .send(landingHtml({ title: link.title || link.label, destination: link.destination, continueUrl: link.destination }));
  }
  return res.redirect(302, link.destination);
});

export default router;
