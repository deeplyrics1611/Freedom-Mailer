import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth, requireFeature } from '../auth.js';
import {
  WARMUP_PRESETS,
  MAX_SEEDS,
  MAX_PLANS,
  warmupPreset,
  parseSeeds,
  publicPlan,
  insertSeeds,
} from '../warmup.js';

const router = Router();
router.use(requireAuth, requireFeature('warmup'));

function planFor(req, id) {
  return db
    .prepare('SELECT * FROM warmup_plans WHERE id = ? AND user_id = ?')
    .get(parseInt(id, 10), req.user.id);
}

router.get('/', (req, res) => {
  const plans = db
    .prepare(
      `SELECT w.*, s.from_email AS sender_email, s.label AS sender_label, s.verified AS sender_verified
       FROM warmup_plans w
       LEFT JOIN senders s ON s.id = w.sender_id
       WHERE w.user_id = ?
       ORDER BY w.id DESC`
    )
    .all(req.user.id)
    .map(publicPlan);
  const senders = db
    .prepare(
      `SELECT id, label, from_email, from_name, verified, kind
       FROM senders WHERE user_id = ? AND kind != 'smtp_sms' ORDER BY id DESC`
    )
    .all(req.user.id);
  res.json({ plans, senders, presets: WARMUP_PRESETS });
});

router.post('/', (req, res) => {
  const { sender_id, name = '', preset = 'standard', seeds = '', owned_ok, start_per_day, increase_per_day, max_per_day } =
    req.body || {};
  if (!owned_ok) {
    return res.status(400).json({
      error: 'Confirm these seed inboxes are yours or people who agreed to receive warmup mail.',
    });
  }
  const count = db.prepare('SELECT COUNT(*) n FROM warmup_plans WHERE user_id = ?').get(req.user.id).n;
  if (count >= MAX_PLANS) return res.status(400).json({ error: `At most ${MAX_PLANS} warmup plans per account` });

  const sender = db
    .prepare("SELECT * FROM senders WHERE id = ? AND user_id = ? AND kind != 'smtp_sms'")
    .get(parseInt(sender_id, 10), req.user.id);
  if (!sender) return res.status(400).json({ error: 'Pick a sender mailbox you own (not SMTP-to-SMS)' });

  const parsed = parseSeeds(String(seeds || ''));
  if (!parsed.seeds.length) {
    return res.status(400).json({ error: 'Paste at least one seed inbox you control' });
  }
  if (parsed.seeds.length > MAX_SEEDS) {
    return res.status(400).json({ error: `At most ${MAX_SEEDS} seeds per plan` });
  }

  const p = warmupPreset(preset);
  const start = start_per_day !== undefined && start_per_day !== '' ? parseInt(start_per_day, 10) : p.start_per_day;
  const inc = increase_per_day !== undefined && increase_per_day !== '' ? parseInt(increase_per_day, 10) : p.increase_per_day;
  const cap = max_per_day !== undefined && max_per_day !== '' ? parseInt(max_per_day, 10) : p.max_per_day;
  if (![start, inc, cap].every((n) => Number.isFinite(n) && n >= 0) || start < 1 || cap < start || cap > 80) {
    return res.status(400).json({ error: 'Ramp must stay between 1 and 80 messages/day' });
  }

  const info = db
    .prepare(
      `INSERT INTO warmup_plans
         (user_id, sender_id, name, status, start_per_day, increase_per_day, max_per_day)
       VALUES (?, ?, ?, 'paused', ?, ?, ?)`
    )
    .run(
      req.user.id,
      sender.id,
      String(name || sender.label || sender.from_email).slice(0, 80),
      start,
      inc,
      cap
    );
  insertSeeds(info.lastInsertRowid, parsed.seeds);
  const row = db
    .prepare(
      `SELECT w.*, s.from_email AS sender_email, s.label AS sender_label, s.verified AS sender_verified
       FROM warmup_plans w LEFT JOIN senders s ON s.id = w.sender_id WHERE w.id = ?`
    )
    .get(info.lastInsertRowid);
  res.status(201).json(publicPlan(row));
});

router.patch('/:id', (req, res) => {
  const plan = planFor(req, req.params.id);
  if (!plan) return res.status(404).json({ error: 'Not found' });
  const { status, name, start_per_day, increase_per_day, max_per_day } = req.body || {};

  if (status !== undefined) {
    if (!['active', 'paused'].includes(status)) {
      return res.status(400).json({ error: 'status must be active or paused' });
    }
    if (status === 'active') {
      const seeds = db
        .prepare('SELECT COUNT(*) n FROM warmup_seeds WHERE plan_id = ? AND active = 1')
        .get(plan.id).n;
      if (!seeds) return res.status(400).json({ error: 'Add seed inboxes before starting' });
      const sender = db.prepare('SELECT id FROM senders WHERE id = ? AND user_id = ?').get(plan.sender_id, req.user.id);
      if (!sender) return res.status(400).json({ error: 'Sender is missing' });
      db.prepare(
        `UPDATE warmup_plans SET status = 'active', pause_reason = '',
           started_at = COALESCE(started_at, datetime('now')), paused_at = NULL
         WHERE id = ?`
      ).run(plan.id);
    } else {
      db.prepare(
        "UPDATE warmup_plans SET status = 'paused', paused_at = datetime('now') WHERE id = ?"
      ).run(plan.id);
    }
  }
  if (name !== undefined) {
    db.prepare('UPDATE warmup_plans SET name = ? WHERE id = ?').run(String(name).slice(0, 80), plan.id);
  }
  if (start_per_day !== undefined || increase_per_day !== undefined || max_per_day !== undefined) {
    const start = start_per_day !== undefined ? parseInt(start_per_day, 10) : plan.start_per_day;
    const inc = increase_per_day !== undefined ? parseInt(increase_per_day, 10) : plan.increase_per_day;
    const cap = max_per_day !== undefined ? parseInt(max_per_day, 10) : plan.max_per_day;
    if (![start, inc, cap].every((n) => Number.isFinite(n) && n >= 0) || start < 1 || cap < start || cap > 80) {
      return res.status(400).json({ error: 'Ramp must stay between 1 and 80 messages/day' });
    }
    db.prepare(
      'UPDATE warmup_plans SET start_per_day = ?, increase_per_day = ?, max_per_day = ? WHERE id = ?'
    ).run(start, inc, cap, plan.id);
  }

  const row = db
    .prepare(
      `SELECT w.*, s.from_email AS sender_email, s.label AS sender_label, s.verified AS sender_verified
       FROM warmup_plans w LEFT JOIN senders s ON s.id = w.sender_id WHERE w.id = ?`
    )
    .get(plan.id);
  res.json(publicPlan(row));
});

router.post('/:id/seeds', (req, res) => {
  const plan = planFor(req, req.params.id);
  if (!plan) return res.status(404).json({ error: 'Not found' });
  if (!req.body?.owned_ok) {
    return res.status(400).json({
      error: 'Confirm these seed inboxes are yours or people who agreed to receive warmup mail.',
    });
  }
  const parsed = parseSeeds(String(req.body.seeds || ''));
  if (!parsed.seeds.length) return res.status(400).json({ error: 'No valid emails in that paste' });
  const have = db.prepare('SELECT COUNT(*) n FROM warmup_seeds WHERE plan_id = ?').get(plan.id).n;
  if (have + parsed.seeds.length > MAX_SEEDS) {
    return res.status(400).json({ error: `At most ${MAX_SEEDS} seeds per plan` });
  }
  insertSeeds(plan.id, parsed.seeds);
  const row = db
    .prepare(
      `SELECT w.*, s.from_email AS sender_email, s.label AS sender_label, s.verified AS sender_verified
       FROM warmup_plans w LEFT JOIN senders s ON s.id = w.sender_id WHERE w.id = ?`
    )
    .get(plan.id);
  res.json(publicPlan(row));
});

router.delete('/:id/seeds/:seedId', (req, res) => {
  const plan = planFor(req, req.params.id);
  if (!plan) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM warmup_seeds WHERE id = ? AND plan_id = ?').run(
    parseInt(req.params.seedId, 10),
    plan.id
  );
  res.json({ ok: true });
});

router.post('/:id/replies', (req, res) => {
  const plan = planFor(req, req.params.id);
  if (!plan) return res.status(404).json({ error: 'Not found' });
  const seedId = parseInt(req.body?.seed_id, 10);
  const seed = db.prepare('SELECT * FROM warmup_seeds WHERE id = ? AND plan_id = ?').get(seedId, plan.id);
  if (!seed) return res.status(404).json({ error: 'Seed not found' });
  db.prepare('UPDATE warmup_seeds SET reply_count = reply_count + 1 WHERE id = ?').run(seed.id);
  const row = db
    .prepare(
      `SELECT w.*, s.from_email AS sender_email, s.label AS sender_label, s.verified AS sender_verified
       FROM warmup_plans w LEFT JOIN senders s ON s.id = w.sender_id WHERE w.id = ?`
    )
    .get(plan.id);
  res.json(publicPlan(row));
});

router.delete('/:id', (req, res) => {
  const plan = planFor(req, req.params.id);
  if (!plan) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM warmup_plans WHERE id = ?').run(plan.id);
  res.json({ ok: true });
});

export default router;
