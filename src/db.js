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

CREATE TABLE IF NOT EXISTS validations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  score       INTEGER NOT NULL DEFAULT 0,
  result      TEXT NOT NULL DEFAULT 'unknown',
  reasons     TEXT DEFAULT '',
  flags_json  TEXT DEFAULT '{}',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_validations_user ON validations(user_id, created_at);
`);

function addColumn(table, column, def) {
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`);
  } catch (e) {
    if (!/duplicate column/i.test(String(e.message || e))) throw e;
  }
}

addColumn('senders', 'kind', "TEXT NOT NULL DEFAULT 'smtp'");
addColumn('senders', 'in_rotation', 'INTEGER NOT NULL DEFAULT 1');
addColumn('senders', 'daily_limit', 'INTEGER NOT NULL DEFAULT 80');
addColumn('senders', 'sent_today', 'INTEGER NOT NULL DEFAULT 0');
addColumn('senders', 'sent_date', "TEXT NOT NULL DEFAULT ''");
addColumn('senders', 'last_used_at', 'TEXT');
addColumn('senders', 'active', 'INTEGER NOT NULL DEFAULT 1');
addColumn('senders', 'provider', "TEXT NOT NULL DEFAULT 'smtp'");
addColumn('senders', 'region', "TEXT NOT NULL DEFAULT ''");
addColumn('senders', 'socks5_host', "TEXT NOT NULL DEFAULT ''");
addColumn('senders', 'socks5_port', 'INTEGER');
addColumn('senders', 'socks5_user', "TEXT NOT NULL DEFAULT ''");
addColumn('senders', 'socks5_pass', "TEXT NOT NULL DEFAULT ''");

addColumn('contacts', 'first_name', "TEXT NOT NULL DEFAULT ''");
addColumn('contacts', 'last_name', "TEXT NOT NULL DEFAULT ''");
addColumn('contacts', 'company', "TEXT NOT NULL DEFAULT ''");
addColumn('contacts', 'title', "TEXT NOT NULL DEFAULT ''");
addColumn('contacts', 'custom_json', "TEXT NOT NULL DEFAULT '{}'");
addColumn('contacts', 'validation_status', "TEXT NOT NULL DEFAULT ''");
addColumn('contacts', 'validation_score', 'INTEGER');
addColumn('contacts', 'validation_reason', "TEXT NOT NULL DEFAULT ''");
addColumn('contacts', 'validated_at', 'TEXT');

addColumn('campaigns', 'rotate_pool', 'INTEGER NOT NULL DEFAULT 0');
addColumn('campaigns', 'extra_vars', "TEXT NOT NULL DEFAULT '{}'");
addColumn('campaigns', 'physical_address', "TEXT NOT NULL DEFAULT ''");
addColumn('campaigns', 'send_to', "TEXT NOT NULL DEFAULT 'confirmed'");
addColumn('campaigns', 'template_key', "TEXT NOT NULL DEFAULT ''");

addColumn('users', 'company_name', "TEXT NOT NULL DEFAULT ''");
addColumn('users', 'physical_address', "TEXT NOT NULL DEFAULT ''");
addColumn('users', 'sender_title', "TEXT NOT NULL DEFAULT ''");

addColumn('messages', 'sms_provider_id', 'INTEGER');
addColumn('messages', 'api_key_id', 'INTEGER');
addColumn('campaigns', 'channel', "TEXT NOT NULL DEFAULT 'email'");
addColumn('campaigns', 'sms_provider_id', 'INTEGER');

db.exec(`
CREATE TABLE IF NOT EXISTS sms_providers (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider    TEXT NOT NULL,
  label       TEXT NOT NULL,
  api_key     TEXT NOT NULL DEFAULT '',
  api_secret  TEXT NOT NULL DEFAULT '',
  from_number TEXT NOT NULL DEFAULT '',
  extra_json  TEXT NOT NULL DEFAULT '{}',
  verified    INTEGER NOT NULL DEFAULT 0,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

export default db;
