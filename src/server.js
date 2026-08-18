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
import gmailRoutes from './routes/gmail.js';
import toolsRoutes from './routes/tools.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

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
  res.json({
    lists: one('SELECT COUNT(*) n FROM lists WHERE user_id = ?'),
    contacts: one('SELECT COUNT(*) n FROM contacts WHERE user_id = ?'),
    confirmed: db.prepare(
      `SELECT COUNT(DISTINCT s.contact_id) n FROM subscriptions s
       JOIN contacts c ON c.id = s.contact_id WHERE c.user_id = ? AND s.status='confirmed'`
    ).get(uid).n,
    campaigns: one('SELECT COUNT(*) n FROM campaigns WHERE user_id = ?'),
    sent: one("SELECT COUNT(*) n FROM messages WHERE user_id = ? AND status='sent'"),
    queued: one("SELECT COUNT(*) n FROM messages WHERE user_id = ? AND status='queued'"),
    failed: one("SELECT COUNT(*) n FROM messages WHERE user_id = ? AND status='failed'"),
    suppressed: one('SELECT COUNT(*) n FROM suppressions WHERE user_id = ?'),
    senders: one('SELECT COUNT(*) n FROM senders WHERE user_id = ?'),
    gmail_ready: db.prepare(
      `SELECT COUNT(*) n FROM senders WHERE user_id = ? AND kind='gmail' AND verified=1 AND active=1 AND in_rotation=1`
    ).get(uid).n,
    sms_enabled: smsEnabled(),
  });
});

// Recent message log.
app.get('/api/messages', requireAuth, (req, res) => {
  const rows = db
    .prepare(
      `SELECT id, channel, to_address, subject, status, error, source, created_at, sent_at
       FROM messages WHERE user_id = ? ORDER BY id DESC LIMIT 100`
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
app.use('/api/gmail', gmailRoutes);
app.use('/api/tools', toolsRoutes);

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
