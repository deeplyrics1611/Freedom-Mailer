import { db } from './db.js';

db.exec(`
CREATE TABLE IF NOT EXISTS app_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);
`);

const DEFAULTS = {
  banner: '',
  maintenance: '0',
  pause_sends: '0',
};

export function getSetting(key, def) {
  const fallback = def !== undefined ? def : DEFAULTS[key] || '';
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

export function setSetting(key, value) {
  db.prepare(
    `INSERT INTO app_settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, value == null ? '' : String(value));
}

export function allSettings() {
  const out = { ...DEFAULTS };
  for (const row of db.prepare('SELECT key, value FROM app_settings').all()) {
    out[row.key] = row.value;
  }
  return out;
}

export function boolSetting(key) {
  return ['1', 'true', 'yes', 'on'].includes(String(getSetting(key, '0')).toLowerCase());
}
