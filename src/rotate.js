import { db } from './db.js';

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

function resetIfNeeded(row, today) {
  if (row.sent_date === today) return row;
  db.prepare('UPDATE senders SET sent_today = 0, sent_date = ? WHERE id = ?').run(today, row.id);
  return { ...row, sent_today: 0, sent_date: today };
}

export function listGmailPool(userId) {
  const today = todayUtc();
  const rows = db
    .prepare(
      `SELECT id, label, username, from_name, from_email, verified, in_rotation, daily_limit,
              sent_today, sent_date, last_used_at, active, created_at, kind
       FROM senders WHERE user_id = ? AND kind = 'gmail' ORDER BY id DESC`
    )
    .all(userId)
    .map((r) => resetIfNeeded(r, today));
  return rows;
}

export function availableGmailSenders(userId) {
  const today = todayUtc();
  const rows = db
    .prepare(
      `SELECT * FROM senders
       WHERE user_id = ? AND kind = 'gmail' AND verified = 1 AND active = 1 AND in_rotation = 1`
    )
    .all(userId)
    .map((r) => resetIfNeeded(r, today))
    .filter((r) => (r.sent_today || 0) < (r.daily_limit || 80));
  rows.sort((a, b) => String(a.last_used_at || '').localeCompare(String(b.last_used_at || '')));
  return rows;
}

/** Least-recently-used Gmail identity that still has daily capacity. */
export function pickGmailSender(userId) {
  const pool = availableGmailSenders(userId);
  return pool[0] || null;
}

export function markSenderUsed(senderId) {
  const today = todayUtc();
  const row = db.prepare('SELECT * FROM senders WHERE id = ?').get(senderId);
  if (!row) return;
  const sent = row.sent_date === today ? (row.sent_today || 0) + 1 : 1;
  db.prepare(
    `UPDATE senders SET last_used_at = datetime('now'), sent_date = ?, sent_today = ? WHERE id = ?`
  ).run(today, sent, senderId);
}

export function poolStatus(userId) {
  const all = listGmailPool(userId);
  const ready = availableGmailSenders(userId);
  const remaining = ready.reduce((n, s) => n + Math.max(0, (s.daily_limit || 80) - (s.sent_today || 0)), 0);
  return {
    accounts: all.length,
    verified: all.filter((s) => s.verified).length,
    in_rotation: all.filter((s) => s.in_rotation && s.active && s.verified).length,
    remaining_today: remaining,
    accounts_ready: ready.length,
  };
}
