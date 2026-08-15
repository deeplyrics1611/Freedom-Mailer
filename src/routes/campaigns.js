import { Router } from 'express';
import { config } from '../config.js';
import { db } from '../db.js';
import { requireAuth, requireFeature } from '../auth.js';
import { isSuppressed, withUnsubscribeFooter, renderTemplate, newToken } from '../compliance.js';
import { parseLeads, toSmsAddress } from '../leads.js';
import { expandVars } from '../placeholders.js';

const router = Router();
router.use(requireAuth, requireFeature('campaigns'));

function contactVars(row) {
  return expandVars({
    name: row.name || '',
    email: row.email || '',
    phone: row.phone || '',
    company: row.company || '',
    title: row.title || '',
    custom1: row.custom1 || '',
    custom2: row.custom2 || '',
    first_name: row.first_name || '',
    last_name: row.last_name || '',
  });
}

function upsertContact(userId, lead) {
  const email = String(lead.email).toLowerCase();
  let contact = db.prepare('SELECT * FROM contacts WHERE user_id = ? AND email = ?').get(userId, email);
  if (!contact) {
    const info = db
      .prepare(
        `INSERT INTO contacts (user_id, email, name, phone, company, title, custom1, custom2)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        userId,
        email,
        lead.name || '',
        lead.phone || '',
        lead.company || '',
        lead.title || '',
        lead.custom1 || '',
        lead.custom2 || ''
      );
    contact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(info.lastInsertRowid);
  } else {
    db.prepare(
      `UPDATE contacts SET
         name = COALESCE(NULLIF(?, ''), name),
         phone = COALESCE(NULLIF(?, ''), phone),
         company = COALESCE(NULLIF(?, ''), company),
         title = COALESCE(NULLIF(?, ''), title),
         custom1 = COALESCE(NULLIF(?, ''), custom1),
         custom2 = COALESCE(NULLIF(?, ''), custom2)
       WHERE id = ?`
    ).run(
      lead.name || '',
      lead.phone || '',
      lead.company || '',
      lead.title || '',
      lead.custom1 || '',
      lead.custom2 || '',
      contact.id
    );
    contact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(contact.id);
  }
  return contact;
}

function subscribeContact(listId, contact, preConfirmed) {
  const token = newToken();
  const status = preConfirmed ? 'confirmed' : 'pending';
  const confirmedAt = preConfirmed ? new Date().toISOString() : null;
  db.prepare(
    `INSERT INTO subscriptions (contact_id, list_id, status, token, confirmed_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(contact_id, list_id) DO UPDATE SET
       status = CASE WHEN subscriptions.status = 'unsubscribed' THEN subscriptions.status ELSE excluded.status END`
  ).run(contact.id, listId, status, token, confirmedAt);
  return db
    .prepare('SELECT * FROM subscriptions WHERE contact_id = ? AND list_id = ?')
    .get(contact.id, listId);
}

router.get('/', (req, res) => {
  const rows = db
    .prepare(
      `SELECT c.*, l.name AS list_name, s.label AS sender_label, s.kind AS sender_kind,
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
  const { name, sender_id, list_id, subject = '', html = '', text = '', channel = 'email' } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Name required' });
  const info = db
    .prepare(
      'INSERT INTO campaigns (user_id, name, sender_id, list_id, subject, html, text, channel) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .run(req.user.id, name, sender_id || null, list_id || null, subject, html, text, channel);
  res.status(201).json({ id: info.lastInsertRowid });
});

router.put('/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const c = db.prepare('SELECT * FROM campaigns WHERE id = ? AND user_id = ?').get(id, req.user.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  if (c.status !== 'draft') return res.status(400).json({ error: 'Only draft campaigns can be edited' });
  const {
    name = c.name,
    sender_id = c.sender_id,
    list_id = c.list_id,
    subject = c.subject,
    html = c.html,
    text = c.text,
    channel = c.channel,
  } = req.body || {};
  db.prepare(
    'UPDATE campaigns SET name=?, sender_id=?, list_id=?, subject=?, html=?, text=?, channel=? WHERE id=?'
  ).run(name, sender_id || null, list_id || null, subject, html, text, channel, id);
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM campaigns WHERE id = ? AND user_id = ?').run(
    parseInt(req.params.id, 10),
    req.user.id
  );
  res.json({ ok: true });
});

function resolveSender(userId, senderId) {
  const sender = senderId
    ? db.prepare('SELECT * FROM senders WHERE id = ? AND user_id = ?').get(senderId, userId)
    : null;
  if (senderId && !sender) throw Object.assign(new Error('Sender not found'), { status: 400 });
  if (sender && !sender.verified) {
    throw Object.assign(new Error('Sender identity must be verified before sending'), { status: 400 });
  }
  if (!sender && !config.systemSmtp.host) {
    throw Object.assign(new Error('No verified sender and no system SMTP configured'), { status: 400 });
  }
  return sender;
}

function enqueueCampaign(user, campaign, recipients, sender) {
  let queued = 0;
  let skipped = 0;
  const insert = db.prepare(
    `INSERT INTO messages (user_id, channel, campaign_id, sender_id, to_address, subject, html, text, status, unsub_token, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, 'campaign')`
  );

  const tx = db.transaction((rows) => {
    for (const r of rows) {
      const emailKey = r.email || r.to_address;
      if (emailKey && isSuppressed(user.id, emailKey)) {
        skipped++;
        continue;
      }
      const vars = contactVars(r);
      const subject = renderTemplate(campaign.subject, vars);
      const baseHtml = renderTemplate(campaign.html, vars);
      const baseText = renderTemplate(campaign.text, vars);
      const token = r.token || newToken();
      const smsMode = sender?.kind === 'smtp_sms' || campaign.channel === 'smtp_sms';

      if (smsMode) {
        try {
          const to = toSmsAddress(r.phone, sender?.sms_gateway);
          insert.run(
            user.id,
            'smtp_sms',
            campaign.id,
            campaign.sender_id || null,
            to,
            subject || '',
            '',
            baseText || subject || '',
            token
          );
          queued++;
        } catch {
          skipped++;
        }
        continue;
      }

      const withFooter = withUnsubscribeFooter({ html: baseHtml, text: baseText }, token);
      insert.run(
        user.id,
        'email',
        campaign.id,
        campaign.sender_id || null,
        r.email,
        subject,
        withFooter.html,
        withFooter.text,
        token
      );
      queued++;
    }
  });
  tx(recipients);
  db.prepare("UPDATE campaigns SET status = 'sending' WHERE id = ?").run(campaign.id);
  return { queued, skipped, eligible: recipients.length };
}

router.post('/:id/send', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const c = db.prepare('SELECT * FROM campaigns WHERE id = ? AND user_id = ?').get(id, req.user.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  if (c.status !== 'draft') return res.status(400).json({ error: 'Campaign already processed' });
  if (!c.list_id) return res.status(400).json({ error: 'Campaign needs a list' });
  if (!c.subject && c.channel !== 'smtp_sms') return res.status(400).json({ error: 'Campaign needs a subject' });

  try {
    const sender = resolveSender(req.user.id, c.sender_id);
    const statusFilter = config.requireDoubleOptIn ? "'confirmed'" : "'confirmed','pending'";
    const recipients = db
      .prepare(
        `SELECT c.id AS contact_id, c.email, c.name, c.phone, c.company, c.title, c.custom1, c.custom2, s.token
         FROM subscriptions s JOIN contacts c ON c.id = s.contact_id
         WHERE s.list_id = ? AND s.status IN (${statusFilter})`
      )
      .all(c.list_id);
    const result = enqueueCampaign(req.user, c, recipients, sender);
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(e.status || 500).json({ error: String(e.message || e) });
  }
});

// Paste leads + compose + send in one step (no file import).
router.post('/compose', (req, res) => {
  const {
    name,
    sender_id,
    subject = '',
    html = '',
    text = '',
    leads_text = '',
    consent = false,
    save_list = true,
    list_id = null,
    channel = 'email',
  } = req.body || {};

  if (!consent) {
    return res.status(400).json({
      error: 'Confirm that these people opted in to hear from you before sending.',
    });
  }
  if (!subject && channel !== 'smtp_sms') {
    return res.status(400).json({ error: 'Subject required' });
  }

  const parsed = parseLeads(leads_text);
  if (!parsed.leads.length) {
    return res.status(400).json({
      error: 'No valid recipients in the paste box',
      invalid: parsed.invalid.slice(0, 20),
    });
  }

  try {
    const sender = resolveSender(req.user.id, sender_id);
    const smsMode = sender?.kind === 'smtp_sms' || channel === 'smtp_sms';
    if (smsMode && parsed.leads.some((l) => !l.phone)) {
      return res.status(400).json({
        error: 'SMTP-to-SMS needs a phone number on every lead (email, name, phone).',
      });
    }

    let listId = list_id ? parseInt(list_id, 10) : null;
    if (listId) {
      const list = db.prepare('SELECT * FROM lists WHERE id = ? AND user_id = ?').get(listId, req.user.id);
      if (!list) return res.status(400).json({ error: 'List not found' });
    } else if (save_list) {
      const info = db
        .prepare('INSERT INTO lists (user_id, name, description) VALUES (?, ?, ?)')
        .run(req.user.id, name || `Paste ${new Date().toISOString().slice(0, 16)}`, 'Pasted leads');
      listId = info.lastInsertRowid;
    }

    const campInfo = db
      .prepare(
        'INSERT INTO campaigns (user_id, name, sender_id, list_id, subject, html, text, channel) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .run(
        req.user.id,
        name || subject || 'Compose send',
        sender_id || null,
        listId,
        subject,
        html,
        text,
        smsMode ? 'smtp_sms' : channel
      );
    const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(campInfo.lastInsertRowid);

    const recipients = [];
    const tx = db.transaction(() => {
      for (const lead of parsed.leads) {
        const contact = upsertContact(req.user.id, lead);
        let token = newToken();
        if (listId) {
          const sub = subscribeContact(listId, contact, true);
          token = sub.token;
        }
        recipients.push({ ...contact, token, first_name: lead.first_name, last_name: lead.last_name });
      }
    });
    tx();

    const result = enqueueCampaign(req.user, campaign, recipients, sender);
    res.status(202).json({
      ok: true,
      campaign_id: campaign.id,
      list_id: listId,
      parsed: parsed.total,
      invalid: parsed.invalid.slice(0, 20),
      ...result,
    });
  } catch (e) {
    res.status(e.status || 500).json({ error: String(e.message || e) });
  }
});

export default router;
