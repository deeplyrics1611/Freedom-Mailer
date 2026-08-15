import { db } from './db.js';

export function logAdmin(admin, action, targetUserId = null, detail = '') {
  const text = typeof detail === 'string' ? detail : JSON.stringify(detail || {});
  db.prepare(
    `INSERT INTO admin_events (admin_id, action, target_user_id, detail) VALUES (?, ?, ?, ?)`
  ).run(admin?.id || null, String(action).slice(0, 80), targetUserId || null, String(text).slice(0, 500));
}

export function recentAdminEvents(limit = 25) {
  return db
    .prepare(
      `SELECT e.id, e.action, e.target_user_id, e.detail, e.created_at,
              a.email AS admin_email, t.email AS target_email
       FROM admin_events e
       LEFT JOIN users a ON a.id = e.admin_id
       LEFT JOIN users t ON t.id = e.target_user_id
       ORDER BY e.id DESC LIMIT ?`
    )
    .all(limit);
}
