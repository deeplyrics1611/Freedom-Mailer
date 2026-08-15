import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth, requireAdmin } from '../auth.js';
import { publicUser } from '../license.js';
import { CLIENT_FEATURES, FEATURE_PRESETS, parseFeatures, applyPreset } from '../features.js';
import { allSettings, setSetting } from '../settings.js';
import { config, smsEnabled } from '../config.js';
import { aiEnabled } from '../ai.js';
import { logAdmin, recentAdminEvents } from '../audit.js';

const router = Router();
router.use(requireAuth, requireAdmin);

router.get('/overview', (req, res) => {
  const users = db
    .prepare(
      `SELECT id, email, role, daily_quota, active, license_plan, license_expires_at, features, notes, last_login, created_at
       FROM users ORDER BY id DESC`
    )
    .all()
    .map((u) => {
      const pub = publicUser(u);
      const sentToday = db
        .prepare(
          `SELECT COUNT(*) n FROM messages
           WHERE user_id = ? AND created_at >= datetime('now','-1 day')`
        )
        .get(u.id).n;
      const sent = db.prepare("SELECT COUNT(*) n FROM messages WHERE user_id = ? AND status='sent'").get(u.id).n;
      const queued = db.prepare("SELECT COUNT(*) n FROM messages WHERE user_id = ? AND status='queued'").get(u.id).n;
      const failed = db.prepare("SELECT COUNT(*) n FROM messages WHERE user_id = ? AND status='failed'").get(u.id).n;
      const senders = db.prepare('SELECT COUNT(*) n FROM senders WHERE user_id = ?').get(u.id).n;
      const lists = db.prepare('SELECT COUNT(*) n FROM lists WHERE user_id = ?').get(u.id).n;
      return { ...pub, usage_today: sentToday, sent, queued, failed, senders, lists };
    });

  const clients = users.filter((u) => u.role !== 'admin');
  const licenseOk = clients.filter((u) => u.license?.ok).length;
  const expired = clients.filter((u) => !u.license?.ok).length;
  const totals = db
    .prepare(
      `SELECT
         SUM(CASE WHEN status='sent' THEN 1 ELSE 0 END) sent,
         SUM(CASE WHEN status='queued' THEN 1 ELSE 0 END) queued,
         SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) failed,
         SUM(CASE WHEN created_at >= datetime('now','-1 day') THEN 1 ELSE 0 END) today
       FROM messages`
    )
    .get();

  const recent = db
    .prepare(
      `SELECT m.id, m.user_id, u.email AS user_email, m.to_address, m.subject, m.status, m.created_at
       FROM messages m
       JOIN users u ON u.id = m.user_id
       ORDER BY m.id DESC LIMIT 20`
    )
    .all();

  res.json({
    users,
    clients,
    features: CLIENT_FEATURES,
    presets: FEATURE_PRESETS,
    events: recentAdminEvents(20),
    settings: allSettings(),
    system: {
      app_base_url: config.appBaseUrl,
      rate_per_minute: config.globalRatePerMinute,
      sms: smsEnabled(),
      ai: aiEnabled(),
    },
    summary: {
      admins: users.filter((u) => u.role === 'admin').length,
      clients: clients.length,
      license_ok: licenseOk,
      expired,
      disabled: users.filter((u) => !u.active).length,
      sent: totals.sent || 0,
      queued: totals.queued || 0,
      failed: totals.failed || 0,
      today: totals.today || 0,
    },
    recent,
  });
});

router.patch('/settings', (req, res) => {
  const { banner, maintenance, pause_sends } = req.body || {};
  if (banner !== undefined) setSetting('banner', String(banner).slice(0, 280));
  if (maintenance !== undefined) setSetting('maintenance', maintenance ? '1' : '0');
  if (pause_sends !== undefined) setSetting('pause_sends', pause_sends ? '1' : '0');
  logAdmin(req.user, 'settings', null, {
    banner: banner !== undefined,
    maintenance,
    pause_sends,
  });
  res.json(allSettings());
});

router.patch('/clients/:id/features', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: 'Not found' });
  if (user.role === 'admin') return res.status(400).json({ error: 'Admin accounts always have every tool' });
  const body = req.body || {};
  const current = parseFeatures(user.features);
  let next = current;
  if (body.preset) {
    const applied = applyPreset(body.preset);
    if (!applied) return res.status(400).json({ error: 'Unknown tool preset' });
    next = applied;
  } else {
    const incoming = body.features && typeof body.features === 'object' ? body.features : body;
    next = { ...current, ...incoming };
  }
  const features = JSON.stringify(parseFeatures(next));
  db.prepare('UPDATE users SET features = ? WHERE id = ?').run(features, id);
  logAdmin(req.user, body.preset ? `preset:${body.preset}` : 'features', id, parseFeatures(next));
  res.json(publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id)));
});

export default router;
