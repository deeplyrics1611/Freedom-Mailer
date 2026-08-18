import { Router } from 'express';
import { config } from '../config.js';
import { db } from '../db.js';
import { requireAuth } from '../auth.js';
import { isSuppressed, withUnsubscribeFooter, renderTemplate, contactVars, newToken } from '../compliance.js';
import { pickGmailSender, poolStatus } from '../rotate.js';
import { RFQ_TEMPLATES } from '../rfqTemplates.js';

const router = Router();
router.use(requireAuth);

function parseExtra(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch { return {}; }
}

router.get('/', (req, res) => {
  const rows = db
    .prepare(
      `SELECT c.*, l.name AS list_name, s.label AS sender_label,
        (SELECT COUNT(*) FROM messages m WHERE m.campaign_id = c.id) AS total,
        (SELECT COUNT(*) FROM messages m WHERE m.campaign_id = c.id AND m.status = 'sent') AS sent,
        (SELECT COUNT(*) FROM messages m WHERE m.campaign_id = c.id AND m.status = 'failed') AS failed
       FROM campaigns c
       LEFT JOIN lists l ON l.id = c.list_id
       LEFT JOIN senders s ON s.id = c.sender_id
       WHERE c.user_id = ? ORDER BY c.id DESC`
    )
    .all(req.user.id);
  res.json(rows);
});

router.post('/', (req, res) => {
  const {
    name, sender_id, list_id, subject = '', html = '', text = '',
    rotate_pool = false, extra_vars = {}, physical_address = '',
    send_to = 'confirmed', template_key = '',
  } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Name required' });
  const info = db
    .prepare(
      `INSERT INTO campaigns
        (user_id, name, sender_id, list_id, subject, html, text, rotate_pool, extra_vars, physical_address, send_to, template_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      req.user.id, name, sender_id || null, list_id || null, subject, html, text,
      rotate_pool ? 1 : 0, JSON.stringify(extra_vars || {}),
      physical_address || req.user.physical_address || '',
      send_to === 'all_in_list' ? 'all_in_list' : 'confirmed',
      template_key || ''
    );
  res.status(201).json({ id: info.lastInsertRowid });
});

router.put('/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const c = db.prepare('SELECT * FROM campaigns WHERE id = ? AND user_id = ?').get(id, req.user.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  if (c.status !== 'draft') return res.status(400).json({ error: 'Only draft campaigns can be edited' });
  const {
    name = c.name, sender_id = c.sender_id, list_id = c.list_id,
    subject = c.subject, html = c.html, text = c.text,
    rotate_pool = c.rotate_pool, extra_vars, physical_address = c.physical_address,
    send_to = c.send_to, template_key = c.template_key,
  } = req.body || {};
  db.prepare(
    `UPDATE campaigns SET name=?, sender_id=?, list_id=?, subject=?, html=?, text=?,
      rotate_pool=?, extra_vars=?, physical_address=?, send_to=?, template_key=? WHERE id=?`
  ).run(
    name, sender_id || null, list_id || null, subject, html, text,
    rotate_pool ? 1 : 0,
    JSON.stringify(extra_vars != null ? extra_vars : parseExtra(c.extra_vars)),
    physical_address || '',
    send_to === 'all_in_list' ? 'all_in_list' : 'confirmed',
    template_key || '',
    id
  );
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM campaigns WHERE id = ? AND user_id = ?').run(
    parseInt(req.params.id, 10),
    req.user.id
  );
  res.json({ ok: true });
});

router.post('/from-template', (req, res) => {
  const { key, name } = req.body || {};
  const tpl = RFQ_TEMPLATES.find((t) => t.key === key);
  if (!tpl) return res.status(404).json({ error: 'Unknown RFQ template' });
  const info = db
    .prepare(
      `INSERT INTO campaigns
        (user_id, name, subject, html, text, template_key, physical_address, extra_vars, rotate_pool)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`
    )
    .run(
      req.user.id,
      name || tpl.name,
      tpl.subject,
      tpl.html,
      tpl.text,
      tpl.key,
      req.user.physical_address || '',
      JSON.stringify({
        sender_name: req.user.email.split('@')[0],
        sender_company: req.user.company_name || '',
        sender_title: req.user.sender_title || '',
        sender_email: req.user.email,
        physical_address: req.user.physical_address || '',
      })
    );
  res.status(201).json({ id: info.lastInsertRowid, template: tpl });
});

router.post('/:id/send', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const c = db.prepare('SELECT * FROM campaigns WHERE id = ? AND user_id = ?').get(id, req.user.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  if (c.status !== 'draft') return res.status(400).json({ error: 'Campaign already processed' });
  if (!c.list_id) return res.status(400).json({ error: 'Campaign needs a list' });
  if (!c.subject) return res.status(400).json({ error: 'Campaign needs a subject' });
  if (!req.body?.lawful_basis) {
    return res.status(400).json({
      error: 'Confirm you have a lawful basis to contact these recipients (B2B RFQ, existing relationship, or applicable anti-spam law).',
    });
  }

  const rotate = !!c.rotate_pool;
  const sender = c.sender_id
    ? db.prepare('SELECT * FROM senders WHERE id = ? AND user_id = ?').get(c.sender_id, req.user.id)
    : null;
  if (c.sender_id && !sender) return res.status(400).json({ error: 'Sender not found' });
  if (sender && !sender.verified) {
    return res.status(400).json({ error: 'Sender identity must be verified before sending' });
  }
  if (rotate) {
    const st = poolStatus(req.user.id);
    if (!st.accounts_ready) {
      return res.status(400).json({ error: 'Gmail pool has no verified accounts with remaining daily capacity' });
    }
  } else if (!sender && !config.systemSmtp.host) {
    return res.status(400).json({ error: 'Pick a sender, enable Gmail pool rotation, or configure system SMTP' });
  }

  const physical =
    c.physical_address ||
    req.user.physical_address ||
    '';
  if (!physical) {
    return res.status(400).json({ error: 'Set a physical mailing address (Account or campaign) — required for CAN-SPAM.' });
  }

  const sendToAll = c.send_to === 'all_in_list';
  const statusFilter = sendToAll
    ? "'confirmed','pending'"
    : config.requireDoubleOptIn
      ? "'confirmed'"
      : "'confirmed','pending'";
  const recipients = db
    .prepare(
      `SELECT c.*, s.token
       FROM subscriptions s JOIN contacts c ON c.id = s.contact_id
       WHERE s.list_id = ? AND s.status IN (${statusFilter})`
    )
    .all(c.list_id);

  const extra = parseExtra(c.extra_vars);
  extra.sender_company = extra.sender_company || req.user.company_name || '';
  extra.physical_address = physical;
  extra.sender_title = extra.sender_title || req.user.sender_title || '';
  extra.sender_email = extra.sender_email || (sender && sender.from_email) || req.user.email;

  let queued = 0, skipped = 0;
  const insert = db.prepare(
    `INSERT INTO messages (user_id, channel, campaign_id, sender_id, to_address, subject, html, text, status, unsub_token, source)
     VALUES (?, 'email', ?, ?, ?, ?, ?, ?, 'queued', ?, 'campaign')`
  );

  const tx = db.transaction((rows) => {
    for (const r of rows) {
      if (isSuppressed(req.user.id, r.email)) { skipped++; continue; }
      if (r.validation_status === 'undeliverable') { skipped++; continue; }
      const token = r.token || newToken();
      const vars = contactVars(r, extra);
      const subject = renderTemplate(c.subject, vars);
      const baseHtml = renderTemplate(c.html, vars);
      const baseText = renderTemplate(c.text, vars);
      const withFooter = withUnsubscribeFooter({ html: baseHtml, text: baseText }, token, { physicalAddress: physical });
      // sender_id is assigned at send time when rotating the Gmail pool.
      insert.run(
        req.user.id, id, rotate ? null : (c.sender_id || null), r.email, subject,
        withFooter.html, withFooter.text, token
      );
      queued++;
    }
  });
  tx(recipients);

  db.prepare("UPDATE campaigns SET status = 'sending' WHERE id = ?").run(id);
  res.json({ ok: true, queued, skipped, eligible: recipients.length, rotate });
});

export default router;
