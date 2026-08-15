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
import letterRoutes from './routes/letters.js';
import aiRoutes from './routes/ai.js';
import leadRoutes from './routes/leads.js';
import office365Routes from './routes/office365.js';
import linkRoutes from './routes/links.js';
import deliverabilityRoutes from './routes/deliverability.js';
import { aiEnabled } from './ai.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// Bootstrap the first admin if the users table is empty, then make sure
// the owner account is admin with a lifetime license.
function bootstrapAdmin() {
  const count = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  if (count === 0) {
    db.prepare(
      `INSERT INTO users (email, password_hash, role, daily_quota, license_plan, license_expires_at)
       VALUES (?, ?, 'admin', 100000, 'lifetime', NULL)`
    ).run(config.bootstrap.email.toLowerCase(), hashPassword(config.bootstrap.password));
    console.log(`[bootstrap] created admin: ${config.bootstrap.email}`);
  }
}

function ensureOwnerAdmin() {
  const email = config.ownerEmail;
  let owner = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!owner) {
    const legacy = db.prepare("SELECT * FROM users WHERE email = 'admin@example.com'").get();
    if (legacy) {
      db.prepare(
        `UPDATE users SET email = ?, role = 'admin', active = 1, license_plan = 'lifetime', license_expires_at = NULL
         WHERE id = ?`
      ).run(email, legacy.id);
      owner = db.prepare('SELECT * FROM users WHERE id = ?').get(legacy.id);
      console.log(`[bootstrap] moved admin@example.com → ${email}`);
    } else {
      db.prepare(
        `INSERT INTO users (email, password_hash, role, daily_quota, license_plan, license_expires_at)
         VALUES (?, ?, 'admin', 100000, 'lifetime', NULL)`
      ).run(email, hashPassword(config.bootstrap.password));
      console.log(`[bootstrap] created owner admin: ${email}`);
      owner = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    }
  }
  db.prepare(
    `UPDATE users SET role = 'admin', active = 1, license_plan = 'lifetime', license_expires_at = NULL WHERE id = ?`
  ).run(owner.id);
}

bootstrapAdmin();
ensureOwnerAdmin();

// Rate limit auth + API endpoints.
const authLimiter = rateLimit({ windowMs: 60_000, max: 30, standardHeaders: true, legacyHeaders: false });
const apiLimiter = rateLimit({ windowMs: 60_000, max: 120, standardHeaders: true, legacyHeaders: false });

app.get('/health', (req, res) => res.json({ ok: true, sms: smsEnabled(), ai: aiEnabled() }));

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
    office_tenants: one('SELECT COUNT(*) n FROM office_tenants WHERE user_id = ?'),
    short_links: one('SELECT COUNT(*) n FROM short_links WHERE user_id = ?'),
    sms_enabled: smsEnabled(),
    ai_enabled: aiEnabled(),
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
app.use('/api/letters', letterRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/leads', leadRoutes);
app.use('/api/office365', office365Routes);
app.use('/api/links', linkRoutes);
app.use('/api/deliverability', deliverabilityRoutes);

// Transactional sending API (X-API-Key).
app.use('/api/v1', apiLimiter, messagingRoutes);

// Public compliance endpoints (/c/:token, /u/:token).
app.use('/', publicRoutes);

// Static admin panel.
const publicDir = path.join(__dirname, '..', 'public');
app.use(express.static(publicDir));
app.get(/^(?!\/api\/).*/, (req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  if (path.extname(req.path)) return next();
  res.sendFile(path.join(publicDir, 'index.html'));
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(config.port, config.host, () => {
  console.log(`Freedom Mailer running at ${config.appBaseUrl} (${config.host}:${config.port})`);
  startWorker();
});
