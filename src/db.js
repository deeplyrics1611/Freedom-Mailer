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

function addColumn(table, column, spec) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${spec}`);
  }
}

addColumn('senders', 'kind', "TEXT NOT NULL DEFAULT 'smtp'");
addColumn('senders', 'provider', "TEXT NOT NULL DEFAULT ''");
addColumn('senders', 'sms_gateway', "TEXT NOT NULL DEFAULT ''");
addColumn('senders', 'office_tenant_id', 'INTEGER');
addColumn('senders', 'auth_mode', "TEXT NOT NULL DEFAULT ''");
addColumn('senders', 'region', "TEXT NOT NULL DEFAULT ''");
addColumn('users', 'license_plan', "TEXT NOT NULL DEFAULT ''");
addColumn('users', 'license_expires_at', 'TEXT');
addColumn('users', 'features', "TEXT NOT NULL DEFAULT '{}'");
addColumn('users', 'notes', "TEXT NOT NULL DEFAULT ''");
addColumn('users', 'last_login', 'TEXT');
addColumn('users', 'link_base_url', "TEXT NOT NULL DEFAULT ''");
addColumn('contacts', 'company', "TEXT NOT NULL DEFAULT ''");
addColumn('contacts', 'title', "TEXT NOT NULL DEFAULT ''");
addColumn('contacts', 'custom1', "TEXT NOT NULL DEFAULT ''");
addColumn('contacts', 'custom2', "TEXT NOT NULL DEFAULT ''");
addColumn('campaigns', 'channel', "TEXT NOT NULL DEFAULT 'email'");
addColumn('messages', 'warmup_plan_id', 'INTEGER');
addColumn('messages', 'not_before', 'TEXT');
addColumn('messages', 'message_id', "TEXT NOT NULL DEFAULT ''");
addColumn('messages', 'in_reply_to_id', 'INTEGER');

db.exec(`
CREATE TABLE IF NOT EXISTS office_tenants (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label            TEXT NOT NULL,
  tenant_id        TEXT NOT NULL DEFAULT '',
  tenant_domain    TEXT NOT NULL DEFAULT '',
  client_id        TEXT NOT NULL DEFAULT '',
  client_secret    TEXT NOT NULL DEFAULT '',
  send_mode        TEXT NOT NULL DEFAULT 'graph',
  default_mailbox  TEXT NOT NULL DEFAULT '',
  from_name        TEXT NOT NULL DEFAULT '',
  org_name         TEXT NOT NULL DEFAULT '',
  verified         INTEGER NOT NULL DEFAULT 0,
  token_cache      TEXT NOT NULL DEFAULT '',
  token_expires    TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS short_links (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label         TEXT NOT NULL DEFAULT '',
  code          TEXT UNIQUE NOT NULL,
  destination   TEXT NOT NULL,
  mode          TEXT NOT NULL DEFAULT 'redirect',
  title         TEXT NOT NULL DEFAULT '',
  clicks        INTEGER NOT NULL DEFAULT 0,
  bot_hits      INTEGER NOT NULL DEFAULT 0,
  human_hits    INTEGER NOT NULL DEFAULT 0,
  last_score    INTEGER NOT NULL DEFAULT 0,
  last_verdict  TEXT NOT NULL DEFAULT '',
  last_checked  TEXT,
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS link_clicks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  link_id     INTEGER NOT NULL REFERENCES short_links(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL DEFAULT 'human',
  marker      TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_short_code ON short_links(code);
CREATE INDEX IF NOT EXISTS idx_clicks_link ON link_clicks(link_id, created_at);

CREATE TABLE IF NOT EXISTS admin_events (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action         TEXT NOT NULL,
  target_user_id INTEGER,
  detail         TEXT NOT NULL DEFAULT '',
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_admin_events ON admin_events(created_at DESC);

CREATE TABLE IF NOT EXISTS warmup_plans (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id            INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sender_id          INTEGER NOT NULL REFERENCES senders(id) ON DELETE CASCADE,
  name               TEXT NOT NULL DEFAULT '',
  status             TEXT NOT NULL DEFAULT 'paused',
  start_per_day      INTEGER NOT NULL DEFAULT 5,
  increase_per_day   INTEGER NOT NULL DEFAULT 3,
  max_per_day        INTEGER NOT NULL DEFAULT 40,
  progress_days      INTEGER NOT NULL DEFAULT 0,
  started_at         TEXT,
  paused_at          TEXT,
  last_queued_on     TEXT,
  pause_reason       TEXT NOT NULL DEFAULT '',
  auto_reply         INTEGER NOT NULL DEFAULT 1,
  created_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS warmup_seeds (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id      INTEGER NOT NULL REFERENCES warmup_plans(id) ON DELETE CASCADE,
  email        TEXT NOT NULL,
  name         TEXT NOT NULL DEFAULT '',
  kind         TEXT NOT NULL DEFAULT 'owned',
  active       INTEGER NOT NULL DEFAULT 1,
  reply_count  INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(plan_id, email)
);

CREATE INDEX IF NOT EXISTS idx_warmup_user ON warmup_plans(user_id, status);
CREATE INDEX IF NOT EXISTS idx_warmup_msgs ON messages(warmup_plan_id, created_at);

CREATE TABLE IF NOT EXISTS mx_cache (
  domain     TEXT PRIMARY KEY,
  mx_json    TEXT NOT NULL DEFAULT '[]',
  error      TEXT NOT NULL DEFAULT '',
  checked_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

addColumn('warmup_plans', 'auto_reply', 'INTEGER NOT NULL DEFAULT 1');
addColumn('campaigns', 'attachments', "TEXT NOT NULL DEFAULT '[]'");
addColumn('messages', 'attachments', "TEXT NOT NULL DEFAULT '[]'");

db.exec(`
CREATE TABLE IF NOT EXISTS vnc_targets (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label       TEXT NOT NULL,
  host        TEXT NOT NULL,
  port        INTEGER NOT NULL DEFAULT 5900,
  password    TEXT NOT NULL DEFAULT '',
  view_only   INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_vnc_user ON vnc_targets(user_id);
`);

export default db;
