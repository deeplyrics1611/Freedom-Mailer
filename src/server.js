import express from 'express';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { fileURLToPath } from 'url';
import { config, smsEnabled } from './config.js';
import { db } from './db.js';
import { hashPassword, requireAuth } from './auth.js';
import { startWorker } from './queue.js';

import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import apiKeyRoutes from './routes/apikeys.js';
import senderRoutes from './routes/senders.js';
import listRoutes from './routes/lists.js';
import contactRoutes from './routes/contacts.js';
import templateRoutes from './routes/templates.js';
import campaignRoutes from './routes/campaigns.js';
import messagingRoutes from './routes/messaging.js';
import publicRoutes from './routes/public.js';
import mailboxRoutes from './routes/mailboxes.js';
import leadRoutes from './routes/leads.js';
import validationRoutes from './routes/validation.js';
import deliverabilityRoutes from './routes/deliverability.js';
import linkRoutes from './routes/links.js';
import { poolCapacity, poolStatus } from './pool.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
// Lead-list CSV imports and bulk validation batches are pasted in as text, so
// the body limit has to accommodate a large spreadsheet.
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));

// Bootstrap the first admin if the users table is empty.
function bootstrapAdmin() {
  const count = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  if (count === 0) {
    db.prepare('INSERT INTO users (email, password_hash, role, daily_quota) VALUES (?, ?, ?, ?)').run(
      config.bootstrap.email.toLowerCase(),
      hashPassword(config.bootstrap.password),
      'admin',
      100000
    );
    console.log(`[bootstrap] created admin: ${config.bootstrap.email}`);
  }
}
bootstrapAdmin();

// Rate limit auth + API endpoints.
const authLimiter = rateLimit({ windowMs: 60_000, max: 30, standardHeaders: true, legacyHeaders: false });
const apiLimiter = rateLimit({ windowMs: 60_000, max: 120, standardHeaders: true, legacyHeaders: false });

app.get('/health', (req, res) => res.json({ ok: true, sms: smsEnabled() }));

// Dashboard stats for the logged-in user.
app.get('/api/stats', requireAuth, (req, res) => {
  const uid = req.user.id;
  const one = (sql, ...p) => db.prepare(sql).get(uid, ...p).n;
  const pool = poolStatus(uid);
  res.json({
    lists: one('SELECT COUNT(*) n FROM lists WHERE user_id = ?'),
    contacts: one('SELECT COUNT(*) n FROM contacts WHERE user_id = ?'),
    confirmed: db.prepare(
      `SELECT COUNT(DISTINCT s.contact_id) n FROM subscriptions s
       JOIN contacts c ON c.id = s.contact_id WHERE c.user_id = ? AND s.status='confirmed'`
    ).get(uid).n,
    campaigns: one('SELECT COUNT(*) n FROM campaigns WHERE user_id = ?'),
    sent: one("SELECT COUNT(*) n FROM messages WHERE user_id = ? AND status='sent'"),
    sent_today: one("SELECT COUNT(*) n FROM messages WHERE user_id = ? AND status='sent' AND date(sent_at)=date('now')"),
    queued: one("SELECT COUNT(*) n FROM messages WHERE user_id = ? AND status='queued'"),
    failed: one("SELECT COUNT(*) n FROM messages WHERE user_id = ? AND status='failed'"),
    suppressed: one('SELECT COUNT(*) n FROM suppressions WHERE user_id = ?'),
    leads: one('SELECT COUNT(*) n FROM leads WHERE user_id = ?'),
    leads_valid: one("SELECT COUNT(*) n FROM leads WHERE user_id = ? AND status='valid'"),
    leads_unchecked: one("SELECT COUNT(*) n FROM leads WHERE user_id = ? AND status='unchecked'"),
    mailboxes: pool.length,
    mailboxes_verified: pool.filter((m) => m.verified && m.active).length,
    mailboxes_available: pool.filter((m) => m.available).length,
    pool_capacity_today: poolCapacity(uid),
    sms_enabled: smsEnabled(),
  });
});

// Recent message log.
app.get('/api/messages', requireAuth, (req, res) => {
  const rows = db
    .prepare(
      `SELECT m.id, m.channel, m.to_address, m.subject, m.status, m.error, m.source,
              m.created_at, m.sent_at, m.not_before, mb.email AS mailbox
       FROM messages m LEFT JOIN mailboxes mb ON mb.id = m.mailbox_id
       WHERE m.user_id = ? ORDER BY m.id DESC LIMIT 100`
    )
    .all(req.user.id);
  res.json(rows);
});

// Panel API routes.
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/apikeys', apiKeyRoutes);
app.use('/api/senders', senderRoutes);
app.use('/api/lists', listRoutes);
app.use('/api/contacts', contactRoutes);
app.use('/api/templates', templateRoutes);
app.use('/api/campaigns', campaignRoutes);
app.use('/api/mailboxes', mailboxRoutes);
app.use('/api/lead-lists', leadRoutes);
app.use('/api/validation', validationRoutes);
app.use('/api/deliverability', deliverabilityRoutes);
app.use('/api/links', linkRoutes);

// Transactional sending API (X-API-Key).
app.use('/api/v1', apiLimiter, messagingRoutes);

// Public compliance endpoints (/c/:token, /u/:token).
app.use('/', publicRoutes);

// Static admin panel.
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(config.port, () => {
  console.log(`Freedom Mailer running at ${config.appBaseUrl} (port ${config.port})`);
  startWorker();
});
