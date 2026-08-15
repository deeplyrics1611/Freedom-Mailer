import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth } from '../auth.js';
import { verifyTransport } from '../mailer.js';
import { aiEnabled, runAi } from '../ai.js';
import {
  OFFICE_SMTP,
  OFFICE_SETUP,
  getAppToken,
  fetchOrganization,
  listGraphMailboxes,
  diagnoseOfficeError,
  officeSetupNotes,
} from '../office365.js';

const router = Router();
router.use(requireAuth);

const publicTenant =
  'id, label, tenant_id, tenant_domain, client_id, send_mode, default_mailbox, from_name, org_name, verified, created_at';

function getTenant(req, id) {
  return db
    .prepare('SELECT * FROM office_tenants WHERE id = ? AND user_id = ?')
    .get(parseInt(id, 10), req.user.id);
}

router.get('/guide', (req, res) => {
  res.json({
    ...officeSetupNotes(),
    ai_enabled: aiEnabled(),
  });
});

router.get('/', (req, res) => {
  const rows = db
    .prepare(`SELECT ${publicTenant} FROM office_tenants WHERE user_id = ? ORDER BY id DESC`)
    .all(req.user.id);
  res.json(rows.map((r) => ({ ...r, has_secret: true })));
});

router.post('/', (req, res) => {
  const {
    label,
    tenant_id = '',
    tenant_domain = '',
    client_id = '',
    client_secret = '',
    send_mode = 'graph',
    default_mailbox = '',
    from_name = '',
  } = req.body || {};
  if (!label) return res.status(400).json({ error: 'Label required' });
  if (!tenant_id && !tenant_domain) {
    return res.status(400).json({ error: 'Tenant ID or tenant domain is required' });
  }
  if (!['graph', 'smtp_auth'].includes(send_mode)) {
    return res.status(400).json({ error: 'send_mode must be graph or smtp_auth' });
  }
  if (send_mode === 'graph' && (!client_id || !client_secret)) {
    return res.status(400).json({ error: 'Graph mode needs client_id and client_secret' });
  }
  const info = db
    .prepare(
      `INSERT INTO office_tenants
        (user_id, label, tenant_id, tenant_domain, client_id, client_secret, send_mode, default_mailbox, from_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      req.user.id,
      label,
      tenant_id.trim(),
      tenant_domain.trim(),
      client_id.trim(),
      client_secret,
      send_mode,
      default_mailbox.trim(),
      from_name.trim()
    );
  res.status(201).json({ id: info.lastInsertRowid });
});

router.put('/:id', (req, res) => {
  const t = getTenant(req, req.params.id);
  if (!t) return res.status(404).json({ error: 'Not found' });
  const {
    label = t.label,
    tenant_id = t.tenant_id,
    tenant_domain = t.tenant_domain,
    client_id = t.client_id,
    client_secret,
    send_mode = t.send_mode,
    default_mailbox = t.default_mailbox,
    from_name = t.from_name,
  } = req.body || {};
  db.prepare(
    `UPDATE office_tenants SET
       label=?, tenant_id=?, tenant_domain=?, client_id=?,
       client_secret=?, send_mode=?, default_mailbox=?, from_name=?, verified=0
     WHERE id=?`
  ).run(
    label,
    tenant_id,
    tenant_domain,
    client_id,
    client_secret === undefined || client_secret === '' ? t.client_secret : client_secret,
    send_mode,
    default_mailbox,
    from_name,
    t.id
  );
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  const t = getTenant(req, req.params.id);
  if (!t) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM senders WHERE user_id = ? AND office_tenant_id = ?').run(req.user.id, t.id);
  db.prepare('DELETE FROM office_tenants WHERE id = ?').run(t.id);
  res.json({ ok: true });
});

router.post('/:id/verify', async (req, res) => {
  const t = getTenant(req, req.params.id);
  if (!t) return res.status(404).json({ error: 'Not found' });
  try {
    if (t.send_mode === 'smtp_auth') {
      if (!t.default_mailbox) {
        return res.status(400).json({ error: 'Add a default mailbox, then add its SMTP password on the mailbox sender.' });
      }
      db.prepare('UPDATE office_tenants SET verified = 1, org_name = ? WHERE id = ?').run(
        t.tenant_domain || t.tenant_id,
        t.id
      );
      return res.json({
        ok: true,
        verified: true,
        mode: 'smtp_auth',
        note: 'Tenant saved. Verify each mailbox sender with its SMTP password (smtp.office365.com:587).',
      });
    }
    const tok = await getAppToken(t);
    let org = { displayName: '', domains: [] };
    try {
      org = await fetchOrganization(tok.access_token);
    } catch {
      // Organization.Read.All is optional.
    }
    db.prepare(
      `UPDATE office_tenants SET verified = 1, org_name = ?, token_cache = ?, token_expires = datetime('now', ?) WHERE id = ?`
    ).run(org.displayName || t.tenant_domain, tok.access_token.slice(0, 8) + '…', `+${tok.expires_in} seconds`, t.id);
    const consent = t.tenant_id && t.client_id ? OFFICE_SETUP.consentUrl(t.tenant_id, t.client_id) : '';
    res.json({
      ok: true,
      verified: true,
      org: org.displayName,
      domains: org.domains,
      consent_url: consent,
    });
  } catch (e) {
    db.prepare('UPDATE office_tenants SET verified = 0 WHERE id = ?').run(t.id);
    const hint = diagnoseOfficeError(e.message);
    res.status(400).json({ ok: false, error: String(e.message || e), hint: hint || undefined });
  }
});

router.get('/:id/mailboxes', async (req, res) => {
  const t = getTenant(req, req.params.id);
  if (!t) return res.status(404).json({ error: 'Not found' });
  const local = db
    .prepare(
      `SELECT id, label, from_email, from_name, auth_mode, verified, username
       FROM senders WHERE user_id = ? AND office_tenant_id = ? ORDER BY id DESC`
    )
    .all(req.user.id, t.id);

  let graph = [];
  let graph_error = '';
  if (t.send_mode === 'graph' && t.client_id && t.client_secret) {
    try {
      const tok = await getAppToken(t);
      graph = await listGraphMailboxes(tok.access_token);
    } catch (e) {
      graph_error = diagnoseOfficeError(e.message) || String(e.message || e);
    }
  }
  res.json({ local, graph, graph_error, send_mode: t.send_mode });
});

router.post('/:id/mailboxes', (req, res) => {
  const t = getTenant(req, req.params.id);
  if (!t) return res.status(404).json({ error: 'Not found' });
  const { email, display_name = '', password = '' } = req.body || {};
  if (!email) return res.status(400).json({ error: 'Mailbox email / UPN required' });
  const addr = String(email).trim().toLowerCase();
  if (t.send_mode === 'smtp_auth' && !password) {
    return res.status(400).json({ error: 'SMTP AUTH mailboxes need the mailbox password (or app password)' });
  }

  const existing = db
    .prepare('SELECT id FROM senders WHERE user_id = ? AND from_email = ?')
    .get(req.user.id, addr);
  if (existing) {
    db.prepare(
      `UPDATE senders SET
         kind='office365', provider='office365', host=?, port=?, secure=0,
         username=?, password=COALESCE(NULLIF(?, ''), password),
         from_name=?, office_tenant_id=?, auth_mode=?, verified=0
       WHERE id=?`
    ).run(
      OFFICE_SMTP.host,
      OFFICE_SMTP.port,
      addr,
      password,
      display_name || t.from_name || addr,
      t.id,
      t.send_mode,
      existing.id
    );
    return res.json({ id: existing.id, updated: true });
  }

  const info = db
    .prepare(
      `INSERT INTO senders
        (user_id, label, kind, provider, host, port, secure, username, password, from_name, from_email, office_tenant_id, auth_mode)
       VALUES (?, ?, 'office365', 'office365', ?, ?, 0, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      req.user.id,
      display_name || addr,
      OFFICE_SMTP.host,
      OFFICE_SMTP.port,
      addr,
      password || 'graph',
      display_name || t.from_name || addr,
      addr,
      t.id,
      t.send_mode
    );
  res.status(201).json({ id: info.lastInsertRowid });
});

router.post('/:id/mailboxes/:senderId/verify', async (req, res) => {
  const t = getTenant(req, req.params.id);
  if (!t) return res.status(404).json({ error: 'Not found' });
  const sender = db
    .prepare('SELECT * FROM senders WHERE id = ? AND user_id = ? AND office_tenant_id = ?')
    .get(parseInt(req.params.senderId, 10), req.user.id, t.id);
  if (!sender) return res.status(404).json({ error: 'Mailbox not found' });
  try {
    await verifyTransport(sender);
    db.prepare('UPDATE senders SET verified = 1 WHERE id = ?').run(sender.id);
    res.json({ ok: true, verified: true });
  } catch (e) {
    db.prepare('UPDATE senders SET verified = 0 WHERE id = ?').run(sender.id);
    const hint = diagnoseOfficeError(e.message);
    res.status(400).json({ ok: false, error: String(e.message || e), hint: hint || undefined });
  }
});

router.post('/ai', async (req, res) => {
  const { action = 'office_setup', prompt = '', subject = '', html = '', text = '', language = 'en' } =
    req.body || {};
  try {
    const result = await runAi({
      action,
      prompt,
      subject,
      html,
      text,
      language,
      kind: '',
      fields: { office: true },
    });
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

export default router;

