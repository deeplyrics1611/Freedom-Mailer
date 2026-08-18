import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth } from '../auth.js';
import { encryptSecret } from '../secrets.js';
import { isSuppressed } from '../compliance.js';
import { renderTemplate, contactVars } from '../placeholders.js';
import { config } from '../config.js';
import {
  PROVIDER_META,
  providerList,
  systemProvider,
  smsEnabled,
  verifySmsProvider,
  extraOf,
  normalizePhone,
  smsSegments,
  withSmsOptOut,
} from '../sms.js';

const router = Router();
router.use(requireAuth);

const publicSelect =
  `id, provider, label, from_number, extra_json, verified, active, created_at`;

function extraFromBody(body) {
  const extra = {};
  for (const k of ['messaging_service_sid', 'base_url', 'body_template', 'url']) {
    if (body[k]) extra[k] = String(body[k]).trim();
  }
  return extra;
}

function listProviders(userId) {
  const rows = db.prepare(
    `SELECT ${publicSelect} FROM sms_providers WHERE user_id = ? ORDER BY id DESC`
  ).all(userId);
  const sys = systemProvider();
  return {
    catalog: providerList(),
    system: sys ? { provider: sys.provider, label: sys.label, from_number: sys.from_number, verified: true } : null,
    providers: rows.map((r) => ({ ...r, extra: extraOf(r) })),
  };
}

router.get('/meta', (_req, res) => res.json({ catalog: providerList(), env: smsEnabled() }));

router.get('/providers', (req, res) => res.json(listProviders(req.user.id)));

router.post('/providers', async (req, res) => {
  const {
    provider, label, api_key = '', api_secret = '', from_number = '', verify = true,
  } = req.body || {};
  if (!provider || !PROVIDER_META[provider]) {
    return res.status(400).json({ error: 'Choose a supported SMS provider' });
  }
  const extra = extraFromBody(req.body || {});
  const info = db.prepare(
    `INSERT INTO sms_providers (user_id, provider, label, api_key, api_secret, from_number, extra_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    req.user.id,
    provider,
    label || PROVIDER_META[provider].label,
    api_key ? encryptSecret(api_key) : '',
    api_secret ? encryptSecret(api_secret) : '',
    from_number,
    JSON.stringify(extra)
  );
  const id = Number(info.lastInsertRowid);
  if (verify) {
    const row = db.prepare('SELECT * FROM sms_providers WHERE id = ?').get(id);
    try {
      await verifySmsProvider(row);
      db.prepare('UPDATE sms_providers SET verified = 1 WHERE id = ?').run(id);
    } catch (e) {
      return res.status(201).json({
        id,
        verified: false,
        warning: `Saved but verify failed: ${String(e.message || e)}`,
      });
    }
  }
  res.status(201).json({ id, verified: true });
});

router.patch('/providers/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const row = db.prepare('SELECT * FROM sms_providers WHERE id = ? AND user_id = ?').get(id, req.user.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  const { label, from_number, active, api_key, api_secret } = req.body || {};
  if (label !== undefined) db.prepare('UPDATE sms_providers SET label = ? WHERE id = ?').run(label, id);
  if (from_number !== undefined) db.prepare('UPDATE sms_providers SET from_number = ? WHERE id = ?').run(from_number, id);
  if (active !== undefined) db.prepare('UPDATE sms_providers SET active = ? WHERE id = ?').run(active ? 1 : 0, id);
  if (api_key) db.prepare('UPDATE sms_providers SET api_key = ?, verified = 0 WHERE id = ?').run(encryptSecret(api_key), id);
  if (api_secret) db.prepare('UPDATE sms_providers SET api_secret = ?, verified = 0 WHERE id = ?').run(encryptSecret(api_secret), id);
  const extra = extraFromBody(req.body || {});
  if (Object.keys(extra).length) {
    db.prepare('UPDATE sms_providers SET extra_json = ?, verified = 0 WHERE id = ?').run(
      JSON.stringify({ ...extraOf(row), ...extra }),
      id
    );
  }
  res.json({ ok: true });
});

router.post('/providers/:id/verify', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const row = db.prepare('SELECT * FROM sms_providers WHERE id = ? AND user_id = ?').get(id, req.user.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  try {
    await verifySmsProvider(row);
    db.prepare('UPDATE sms_providers SET verified = 1 WHERE id = ?').run(id);
    res.json({ ok: true, verified: true });
  } catch (e) {
    db.prepare('UPDATE sms_providers SET verified = 0 WHERE id = ?').run(id);
    res.status(400).json({ ok: false, error: String(e.message || e) });
  }
});

router.delete('/providers/:id', (req, res) => {
  db.prepare('DELETE FROM sms_providers WHERE id = ? AND user_id = ?').run(
    parseInt(req.params.id, 10),
    req.user.id
  );
  res.json({ ok: true });
});

export function resolveSmsProvider(userId, providerId) {
  if (providerId) {
    const row = db.prepare('SELECT * FROM sms_providers WHERE id = ? AND user_id = ?').get(
      parseInt(providerId, 10),
      userId
    );
    if (!row) return null;
    return row;
  }
  const own = db.prepare(
    `SELECT * FROM sms_providers WHERE user_id = ? AND active = 1 AND verified = 1 ORDER BY id DESC LIMIT 1`
  ).get(userId);
  return own || systemProvider();
}

function enqueueSms({ userId, to, body, providerId, campaignId = null, source = 'sms' }) {
  const dest = normalizePhone(to);
  if (!dest) throw new Error('Invalid phone number (use E.164, e.g. +15551234567)');
  if (isSuppressed(userId, dest)) throw new Error('Number is on your suppression list');
  const provider = resolveSmsProvider(userId, providerId);
  if (!provider) throw new Error('Add and verify an SMS provider, or set TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN');
  if (provider.id && !provider.verified) throw new Error('Verify the SMS provider before sending');
  const info = db.prepare(
    `INSERT INTO messages
      (user_id, channel, campaign_id, to_address, text, status, source, sms_provider_id)
     VALUES (?, 'sms', ?, ?, ?, 'queued', ?, ?)`
  ).run(userId, campaignId, dest, body, source, provider.id || null);
  return { id: Number(info.lastInsertRowid), to: dest, status: 'queued' };
}

router.post('/preview', (req, res) => {
  const { body = '', extra_vars = {}, contact_id } = req.body || {};
  let vars = {
    first_name: 'Alex', company: 'Acme', rfq_item: 'housings',
    sender_name: req.user.email.split('@')[0], sender_company: req.user.company_name || '',
  };
  if (contact_id) {
    const c = db.prepare('SELECT * FROM contacts WHERE id = ? AND user_id = ?').get(
      parseInt(contact_id, 10), req.user.id
    );
    if (c) vars = contactVars(c, extra_vars);
  } else {
    vars = { ...vars, ...extra_vars };
  }
  const text = withSmsOptOut(renderTemplate(body, vars));
  res.json({ text, vars, segments: smsSegments(text) });
});

router.post('/send', (req, res) => {
  const { to, body, provider_id, opt_out = true } = req.body || {};
  if (!to || !body) return res.status(400).json({ error: 'to and body are required' });
  try {
    const text = opt_out ? withSmsOptOut(body) : String(body);
    const queued = enqueueSms({
      userId: req.user.id, to, body: text, providerId: provider_id, source: 'sms',
    });
    res.status(202).json(queued);
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

router.post('/campaign', (req, res) => {
  const {
    name = 'SMS send', list_id, body, provider_id, send_to = 'confirmed',
    extra_vars = {}, opt_out = true, lawful_basis,
  } = req.body || {};
  if (!list_id || !body) return res.status(400).json({ error: 'list_id and body are required' });
  if (!lawful_basis) {
    return res.status(400).json({
      error: 'Confirm you have consent or another lawful basis to text these numbers (TCPA / local rules).',
    });
  }
  const list = db.prepare('SELECT * FROM lists WHERE id = ? AND user_id = ?').get(
    parseInt(list_id, 10), req.user.id
  );
  if (!list) return res.status(404).json({ error: 'List not found' });
  const provider = resolveSmsProvider(req.user.id, provider_id);
  if (!provider) return res.status(400).json({ error: 'No verified SMS provider' });

  const statusFilter = send_to === 'all_in_list'
    ? "'confirmed','pending'"
    : config.requireDoubleOptIn ? "'confirmed'" : "'confirmed','pending'";
  const recipients = db.prepare(
    `SELECT c.* FROM subscriptions s JOIN contacts c ON c.id = s.contact_id
     WHERE s.list_id = ? AND s.status IN (${statusFilter})`
  ).all(list.id);

  const camp = db.prepare(
    `INSERT INTO campaigns (user_id, name, list_id, text, status, extra_vars, send_to, channel, sms_provider_id)
     VALUES (?, ?, ?, ?, 'sending', ?, ?, 'sms', ?)`
  ).run(
    req.user.id, name, list.id, body, JSON.stringify(extra_vars || {}),
    send_to === 'all_in_list' ? 'all_in_list' : 'confirmed',
    provider.id || null
  );
  const campaignId = Number(camp.lastInsertRowid);

  let queued = 0, skipped = 0;
  for (const r of recipients) {
    const phone = normalizePhone(r.phone);
    if (!phone) { skipped++; continue; }
    if (isSuppressed(req.user.id, phone) || isSuppressed(req.user.id, r.email)) { skipped++; continue; }
    const vars = contactVars(r, extra_vars);
    const text = opt_out ? withSmsOptOut(renderTemplate(body, vars)) : renderTemplate(body, vars);
    try {
      enqueueSms({
        userId: req.user.id, to: phone, body: text,
        providerId: provider.id, campaignId, source: 'sms_campaign',
      });
      queued++;
    } catch {
      skipped++;
    }
  }
  res.status(202).json({ ok: true, campaign_id: campaignId, queued, skipped, eligible: recipients.length });
});

router.get('/messages', (req, res) => {
  const rows = db.prepare(
    `SELECT id, to_address, text, status, error, source, created_at, sent_at
     FROM messages WHERE user_id = ? AND channel = 'sms' ORDER BY id DESC LIMIT 100`
  ).all(req.user.id);
  res.json(rows);
});

export default router;
export { enqueueSms };
