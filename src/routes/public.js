import { Router } from 'express';
import { db } from '../db.js';
import { suppress } from '../compliance.js';

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

// GET /u/:token — one-click unsubscribe. The token identifies either an opt-in
// subscription or a cold-outreach lead; both must work.
router.get('/u/:token', (req, res) => {
  if (!handleUnsubscribe(req.params.token)) {
    return res.status(404).send(page('Link not found', 'This unsubscribe link is invalid.'));
  }
  res.send(page('Unsubscribed', 'You have been unsubscribed and will no longer receive these emails.'));
});

// POST /u/:token — RFC 8058 one-click (List-Unsubscribe-Post).
router.post('/u/:token', (req, res) => {
  if (!handleUnsubscribe(req.params.token)) return res.status(404).json({ error: 'not found' });
  res.json({ ok: true });
});

function handleUnsubscribe(token) {
  const sub = db.prepare('SELECT * FROM subscriptions WHERE token = ?').get(token);
  if (sub) {
    db.prepare(
      "UPDATE subscriptions SET status = 'unsubscribed', unsubscribed_at = datetime('now') WHERE id = ?"
    ).run(sub.id);
    // Add to the owner's suppression list so future campaigns skip them too.
    const contact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(sub.contact_id);
    if (contact) suppress(contact.user_id, contact.email, 'unsubscribe');
    return true;
  }

  const lead = db.prepare('SELECT * FROM leads WHERE unsub_token = ?').get(token);
  if (lead) {
    db.prepare('UPDATE leads SET opted_out = 1 WHERE id = ?').run(lead.id);
    // Suppress account-wide, not just for this list: an opt-out means "stop
    // contacting me", not "stop contacting me from this one audience".
    suppress(lead.user_id, lead.email, 'unsubscribe');
    // Drop anything already queued for them.
    db.prepare(
      `UPDATE messages SET status = 'skipped', error = 'recipient opted out'
       WHERE user_id = ? AND to_address = ? AND status = 'queued'`
    ).run(lead.user_id, lead.email);
    return true;
  }

  return false;
}

export default router;
