import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });

export const db = new Database(path.join(dataDir, 'freedom-mailer.sqlite'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user',      -- 'admin' | 'user'
  daily_quota   INTEGER NOT NULL DEFAULT 1000,
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- API keys for the transactional sending API.
CREATE TABLE IF NOT EXISTS api_keys (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  key_prefix  TEXT NOT NULL,                        -- shown in UI
  key_hash    TEXT NOT NULL,                        -- sha256 of full key
  last_used   TEXT,
  revoked     INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Verified sending identities (SMTP). One identity = one owned mailbox/domain.
CREATE TABLE IF NOT EXISTS senders (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label       TEXT NOT NULL,
  host        TEXT NOT NULL,
  port        INTEGER NOT NULL DEFAULT 587,
  secure      INTEGER NOT NULL DEFAULT 0,
  username    TEXT NOT NULL,
  password    TEXT NOT NULL,
  from_name   TEXT NOT NULL,
  from_email  TEXT NOT NULL,
  verified    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS lists (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS contacts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  name        TEXT DEFAULT '',
  phone       TEXT DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, email)
);

-- Subscription state per (contact,list). Enforces double opt-in.
CREATE TABLE IF NOT EXISTS subscriptions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id    INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  list_id       INTEGER NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'pending',    -- pending | confirmed | unsubscribed
  token         TEXT NOT NULL,                       -- confirm/unsubscribe token
  consent_ip    TEXT DEFAULT '',
  confirmed_at  TEXT,
  unsubscribed_at TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(contact_id, list_id)
);

-- Global per-user suppression list (hard bounces, complaints, manual).
CREATE TABLE IF NOT EXISTS suppressions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  reason      TEXT NOT NULL DEFAULT 'manual',        -- manual | bounce | complaint | unsubscribe
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, email)
);

CREATE TABLE IF NOT EXISTS templates (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  subject     TEXT NOT NULL DEFAULT '',
  html        TEXT NOT NULL DEFAULT '',
  text        TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS campaigns (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  sender_id   INTEGER REFERENCES senders(id) ON DELETE SET NULL,
  list_id     INTEGER REFERENCES lists(id) ON DELETE SET NULL,
  subject     TEXT NOT NULL DEFAULT '',
  html        TEXT NOT NULL DEFAULT '',
  text        TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'draft',         -- draft | queued | sending | sent | failed
  scheduled_at TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Every individual send attempt (email or sms), for logging + queue.
CREATE TABLE IF NOT EXISTS messages (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel       TEXT NOT NULL DEFAULT 'email',       -- email | sms
  campaign_id   INTEGER REFERENCES campaigns(id) ON DELETE SET NULL,
  sender_id     INTEGER REFERENCES senders(id) ON DELETE SET NULL,
  to_address    TEXT NOT NULL,                        -- email or phone
  subject       TEXT DEFAULT '',
  html          TEXT DEFAULT '',
  text          TEXT DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'queued',       -- queued | sending | sent | failed | skipped
  error         TEXT DEFAULT '',
  unsub_token   TEXT DEFAULT '',                       -- for List-Unsubscribe header
  source        TEXT NOT NULL DEFAULT 'campaign',     -- campaign | api
  attempts      INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  sent_at       TEXT
);

CREATE INDEX IF NOT EXISTS idx_messages_status ON messages(status);
CREATE INDEX IF NOT EXISTS idx_messages_user ON messages(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_subs_list ON subscriptions(list_id, status);
`);

// ---------------------------------------------------------------------------
// Outreach schema: mailbox pool, leads, validation, deliverability checks.
// ---------------------------------------------------------------------------
db.exec(`
-- A sending mailbox authenticated with an app password (Gmail/Workspace or any
-- SMTP host). Several mailboxes form a pool that sends are spread across, so no
-- single account exceeds its provider's daily/hourly limit. App passwords are
-- stored encrypted (see lib/secrets.js).
CREATE TABLE IF NOT EXISTS mailboxes (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label         TEXT NOT NULL,
  provider      TEXT NOT NULL DEFAULT 'gmail',   -- gmail | workspace | custom
  host          TEXT NOT NULL DEFAULT 'smtp.gmail.com',
  port          INTEGER NOT NULL DEFAULT 465,
  secure        INTEGER NOT NULL DEFAULT 1,
  email         TEXT NOT NULL,                   -- address + SMTP username
  app_password  TEXT NOT NULL,                   -- encrypted at rest
  from_name     TEXT NOT NULL DEFAULT '',
  reply_to      TEXT NOT NULL DEFAULT '',
  daily_limit   INTEGER NOT NULL DEFAULT 400,
  hourly_limit  INTEGER NOT NULL DEFAULT 40,
  min_gap_sec   INTEGER NOT NULL DEFAULT 45,     -- pacing between sends
  warmup        INTEGER NOT NULL DEFAULT 1,      -- ramp volume on a new mailbox
  warmup_start  INTEGER NOT NULL DEFAULT 10,
  warmup_step   INTEGER NOT NULL DEFAULT 5,
  active        INTEGER NOT NULL DEFAULT 1,
  verified      INTEGER NOT NULL DEFAULT 0,
  verified_at   TEXT,
  last_error    TEXT NOT NULL DEFAULT '',
  paused_until  TEXT,
  last_send_at  TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, email)
);

-- Per-mailbox, per-hour send counters. Daily totals are summed from these.
CREATE TABLE IF NOT EXISTS mailbox_usage (
  mailbox_id  INTEGER NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
  day         TEXT NOT NULL,                     -- YYYY-MM-DD (UTC)
  hour        INTEGER NOT NULL,                  -- 0-23 (UTC)
  sent        INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (mailbox_id, day, hour)
);

-- Cold-outreach audiences. Kept separate from opt-in \`lists\` because these
-- recipients have not double opted in; outreach campaigns carry the stricter
-- CAN-SPAM requirements (postal address + working opt-out) instead.
CREATE TABLE IF NOT EXISTS lead_lists (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS leads (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lead_list_id  INTEGER NOT NULL REFERENCES lead_lists(id) ON DELETE CASCADE,
  email         TEXT NOT NULL,
  fields        TEXT NOT NULL DEFAULT '{}',      -- JSON merge fields from CSV
  status        TEXT NOT NULL DEFAULT 'unchecked', -- unchecked|valid|invalid|risky|catch_all|unknown
  score         INTEGER,
  reason        TEXT NOT NULL DEFAULT '',
  detail        TEXT NOT NULL DEFAULT '{}',
  checked_at    TEXT,
  unsub_token   TEXT NOT NULL,
  opted_out     INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(lead_list_id, email)
);

-- Bulk address-validation jobs, processed by the background worker.
CREATE TABLE IF NOT EXISTS verification_jobs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL DEFAULT '',
  lead_list_id  INTEGER REFERENCES lead_lists(id) ON DELETE SET NULL,
  total         INTEGER NOT NULL DEFAULT 0,
  processed     INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'queued',  -- queued|running|done|cancelled|failed
  deep          INTEGER NOT NULL DEFAULT 1,      -- include SMTP mailbox probe
  error         TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at   TEXT
);

CREATE TABLE IF NOT EXISTS verification_results (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id    INTEGER NOT NULL REFERENCES verification_jobs(id) ON DELETE CASCADE,
  email     TEXT NOT NULL,
  status    TEXT NOT NULL,
  score     INTEGER NOT NULL DEFAULT 0,
  reason    TEXT NOT NULL DEFAULT '',
  detail    TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Addresses still awaiting processing inside a job.
CREATE TABLE IF NOT EXISTS verification_queue (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id  INTEGER NOT NULL REFERENCES verification_jobs(id) ON DELETE CASCADE,
  email   TEXT NOT NULL,
  lead_id INTEGER
);

-- Cached per-domain facts so bulk runs don't re-query DNS/SMTP per address.
CREATE TABLE IF NOT EXISTS domain_cache (
  domain      TEXT PRIMARY KEY,
  mx          TEXT NOT NULL DEFAULT '[]',
  has_mx      INTEGER NOT NULL DEFAULT 0,
  catch_all   INTEGER,                           -- NULL = not probed yet
  checked_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Saved reports from the deliverability / link tooling.
CREATE TABLE IF NOT EXISTS checks (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,                      -- content | auth | headers | link
  target     TEXT NOT NULL DEFAULT '',
  score      INTEGER,
  verdict    TEXT NOT NULL DEFAULT '',
  report     TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Inbox-placement seed tests: send a tagged message to seed mailboxes you own,
-- then record where each one landed.
CREATE TABLE IF NOT EXISTS seed_tests (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code        TEXT NOT NULL UNIQUE,              -- tag embedded in the subject
  mailbox_id  INTEGER REFERENCES mailboxes(id) ON DELETE SET NULL,
  subject     TEXT NOT NULL DEFAULT '',
  note        TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS seed_results (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  seed_test_id INTEGER NOT NULL REFERENCES seed_tests(id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  provider    TEXT NOT NULL DEFAULT '',
  send_status TEXT NOT NULL DEFAULT 'queued',    -- queued|sent|failed
  send_error  TEXT NOT NULL DEFAULT '',
  placement   TEXT NOT NULL DEFAULT 'unknown',   -- unknown|inbox|promotions|spam|missing
  recorded_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_leads_list ON leads(lead_list_id, status);
CREATE INDEX IF NOT EXISTS idx_usage_day ON mailbox_usage(mailbox_id, day);
CREATE INDEX IF NOT EXISTS idx_vqueue_job ON verification_queue(job_id);
CREATE INDEX IF NOT EXISTS idx_vresults_job ON verification_results(job_id);
`);

// Idempotent column additions for tables that predate the outreach features.
function addColumn(table, column, ddl) {
  const exists = db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
  if (!exists) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
}

addColumn('campaigns', 'mode', "TEXT NOT NULL DEFAULT 'optin'"); // optin | outreach
addColumn('campaigns', 'lead_list_id', 'INTEGER REFERENCES lead_lists(id) ON DELETE SET NULL');
addColumn('campaigns', 'use_pool', 'INTEGER NOT NULL DEFAULT 0');
addColumn('campaigns', 'postal_address', "TEXT NOT NULL DEFAULT ''");
addColumn('campaigns', 'reply_to', "TEXT NOT NULL DEFAULT ''");
addColumn('campaigns', 'min_delay_sec', 'INTEGER NOT NULL DEFAULT 45');
addColumn('campaigns', 'max_delay_sec', 'INTEGER NOT NULL DEFAULT 120');
addColumn('campaigns', 'daily_cap', 'INTEGER NOT NULL DEFAULT 0'); // 0 = mailbox caps only
addColumn('campaigns', 'only_valid', 'INTEGER NOT NULL DEFAULT 1');

addColumn('messages', 'mailbox_id', 'INTEGER');
addColumn('messages', 'use_pool', 'INTEGER NOT NULL DEFAULT 0');
addColumn('messages', 'lead_id', 'INTEGER');
addColumn('messages', 'seed_result_id', 'INTEGER');
addColumn('messages', 'not_before', 'TEXT');
addColumn('messages', 'reply_to', "TEXT NOT NULL DEFAULT ''");

export default db;
