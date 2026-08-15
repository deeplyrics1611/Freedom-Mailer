import { db } from './db.js';
import { parseLeads, isEmail } from './leads.js';
import { isSuppressed } from './compliance.js';
import { isLicenseActive } from './license.js';
import { boolSetting } from './settings.js';

export const WARMUP_PRESETS = [
  {
    id: 'gentle',
    label: 'Gentle · new domain',
    start_per_day: 3,
    increase_per_day: 2,
    max_per_day: 25,
    blurb: 'About two to three weeks to 25/day. Use this on a brand-new domain.',
  },
  {
    id: 'standard',
    label: 'Standard',
    start_per_day: 5,
    increase_per_day: 3,
    max_per_day: 40,
    blurb: 'About two weeks to 40/day. Default for a mailbox you already own.',
  },
  {
    id: 'faster',
    label: 'Faster · aged mailbox',
    start_per_day: 8,
    increase_per_day: 5,
    max_per_day: 60,
    blurb: 'Only if SPF/DKIM/DMARC already pass and the domain has some history.',
  },
];

export const MAX_SEEDS = 50;
export const MAX_PLANS = 20;
export const MAX_PER_SEED_PER_DAY = 2;

/** Short 1:1 notes. No links, no pitches, no third-party brands. */
export const WARMUP_NOTES = [
  { subject: 'Quick check-in', text: 'Hey {{name}} — just making sure this mailbox is landing. Reply if you got this.' },
  { subject: 'Testing this address', text: 'Sending a short test from the new address. No action needed unless you want to ping me back.' },
  { subject: 'Did this come through?', text: 'Hi {{name}}, checking that mail from this inbox is reaching you. A one-line reply helps.' },
  { subject: 'Small hello', text: 'Hello — connecting this mailbox. If you see this in the inbox (not spam), a reply is appreciated.' },
  { subject: 'Got a second?', text: '{{name}}, this is a warmup note from my side. Reply “got it” if it landed cleanly.' },
  { subject: 'Mailbox check', text: 'Running a deliverability check on this address. Thanks for being on the seed list.' },
  { subject: 'Morning note', text: 'Morning {{name}}. Quick ping so this domain builds a normal send pattern. Reply when you can.' },
  { subject: 'Following up', text: 'Following up on yesterday’s test. Still just warming the mailbox — a short reply is enough.' },
  { subject: 'Can you see this?', text: 'Hi {{name}}, can you see this in the primary inbox? One-word reply is perfect.' },
  { subject: 'Thanks in advance', text: 'Thanks for helping me warm this inbox. No links, no ask — just a human reply if you have a moment.' },
  { subject: 'Checking in', text: '{{name}} — checking in from the new send address. Let me know if anything looks off.' },
  { subject: 'Still here', text: 'Still sending a few notes a day while this mailbox ages in. Reply if you have time.' },
];

export function warmupPreset(id) {
  return WARMUP_PRESETS.find((p) => p.id === id) || WARMUP_PRESETS[1];
}

export function dailyTarget(plan) {
  const start = Math.max(1, parseInt(plan.start_per_day, 10) || 5);
  const inc = Math.max(0, parseInt(plan.increase_per_day, 10) || 0);
  const cap = Math.max(start, parseInt(plan.max_per_day, 10) || 40);
  const days = Math.max(0, parseInt(plan.progress_days, 10) || 0);
  return Math.min(cap, start + days * inc);
}

export function bounceShouldPause({ sent = 0, failed = 0 } = {}) {
  const s = Number(sent) || 0;
  const f = Number(failed) || 0;
  if (f < 3) return false;
  const n = s + f;
  if (!n) return false;
  return f / n >= 0.15;
}

export function utcDate(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

export function sqliteNow(d = new Date()) {
  return d.toISOString().replace('T', ' ').slice(0, 19);
}

export function spreadTimes(count, now = new Date()) {
  const n = Math.max(0, parseInt(count, 10) || 0);
  if (!n) return [];
  const windowMs = 10 * 60 * 60 * 1000;
  const gap = Math.min(90 * 60 * 1000, Math.max(8 * 60 * 1000, Math.floor(windowMs / n)));
  return Array.from({ length: n }, (_, i) => sqliteNow(new Date(now.getTime() + i * gap)));
}

export function parseSeeds(text) {
  const { leads, invalid, total } = parseLeads(text);
  const seen = new Set();
  const seeds = [];
  for (const l of leads) {
    const email = String(l.email || '').toLowerCase();
    if (!isEmail(email) || seen.has(email)) continue;
    seen.add(email);
    seeds.push({ email, name: l.name || '' });
  }
  return { seeds, invalid, total: seeds.length };
}

export function pickNote(planId, seedId, dayIndex) {
  const i = Math.abs((Number(planId) || 0) + (Number(seedId) || 0) + (Number(dayIndex) || 0)) % WARMUP_NOTES.length;
  return WARMUP_NOTES[i];
}

export function renderNote(note, seed) {
  const name = String(seed?.name || '').trim() || String(seed?.email || '').split('@')[0] || 'there';
  const fill = (s) => String(s || '').replace(/\{\{name\}\}/g, name);
  const text = fill(note.text);
  const subject = fill(note.subject);
  const html = `<p style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5;color:#222">${text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>')}</p>`;
  return { subject, text, html };
}

function sentTodayCount(userId) {
  return db
    .prepare(
      `SELECT COUNT(*) n FROM messages
       WHERE user_id = ? AND created_at >= datetime('now','-1 day')`
    )
    .get(userId).n;
}

function remainingQuota(user) {
  const cap = Number(user.daily_quota) || 0;
  if (cap <= 0) return Infinity;
  return Math.max(0, cap - sentTodayCount(user.id));
}

export function planStats(planId) {
  const today = db
    .prepare(
      `SELECT
         SUM(CASE WHEN status IN ('queued','sending','sent') THEN 1 ELSE 0 END) placed,
         SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) sent,
         SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) failed,
         SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) queued
       FROM messages
       WHERE warmup_plan_id = ? AND created_at >= datetime('now','start of day')`
    )
    .get(planId);
  const recent = db
    .prepare(
      `SELECT
         SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) sent,
         SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) failed
       FROM messages
       WHERE warmup_plan_id = ? AND created_at >= datetime('now','-2 day')`
    )
    .get(planId);
  const all = db
    .prepare(
      `SELECT
         SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) sent,
         SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) failed
       FROM messages WHERE warmup_plan_id = ?`
    )
    .get(planId);
  const replies = db
    .prepare('SELECT COALESCE(SUM(reply_count), 0) n FROM warmup_seeds WHERE plan_id = ?')
    .get(planId).n;
  return {
    today_placed: today?.placed || 0,
    today_sent: today?.sent || 0,
    today_failed: today?.failed || 0,
    today_queued: today?.queued || 0,
    recent_sent: recent?.sent || 0,
    recent_failed: recent?.failed || 0,
    sent: all?.sent || 0,
    failed: all?.failed || 0,
    replies: replies || 0,
  };
}

export function publicPlan(row) {
  const stats = planStats(row.id);
  const seeds = db
    .prepare(
      'SELECT id, email, name, kind, active, reply_count, created_at FROM warmup_seeds WHERE plan_id = ? ORDER BY id'
    )
    .all(row.id);
  const target = dailyTarget(row);
  const atCap = target >= (row.max_per_day || 0) && (row.progress_days || 0) > 0;
  return {
    ...row,
    target_today: target,
    at_cap: atCap,
    seeds,
    seed_count: seeds.filter((s) => s.active).length,
    stats,
    pause_reason: row.pause_reason || '',
  };
}

function maybePauseForBounces(plan) {
  const stats = planStats(plan.id);
  if (!bounceShouldPause({ sent: stats.recent_sent, failed: stats.recent_failed })) return false;
  db.prepare(
    `UPDATE warmup_plans SET status = 'paused', paused_at = datetime('now'),
       pause_reason = 'Auto-paused: bounce rate too high on warmup mail. Fix the mailbox, then resume.'
     WHERE id = ?`
  ).run(plan.id);
  return true;
}

function pickSeedsForDay(plan, need, fromEmail) {
  const rows = db
    .prepare(
      `SELECT s.*,
         (SELECT COUNT(*) FROM messages m
           WHERE m.warmup_plan_id = s.plan_id
             AND lower(m.to_address) = s.email
             AND m.created_at >= datetime('now','start of day')) AS today_n
       FROM warmup_seeds s
       WHERE s.plan_id = ? AND s.active = 1
       ORDER BY today_n ASC, s.id ASC`
    )
    .all(plan.id);
  const out = [];
  for (const s of rows) {
    if (out.length >= need) break;
    if (s.email === String(fromEmail || '').toLowerCase()) continue;
    if (s.today_n >= MAX_PER_SEED_PER_DAY) continue;
    if (isSuppressed(plan.user_id, s.email)) continue;
    out.push(s);
  }
  return out;
}

/** Queue today’s remaining warmup notes, spread through the next ~10 hours. */
export function queueDueWarmup(now = new Date()) {
  if (boolSetting('pause_sends') || boolSetting('maintenance')) return { queued: 0, skipped: 'paused' };
  const today = utcDate(now);
  const plans = db.prepare("SELECT * FROM warmup_plans WHERE status = 'active'").all();
  let queued = 0;
  for (const plan of plans) {
    const owner = db.prepare('SELECT * FROM users WHERE id = ?').get(plan.user_id);
    if (!owner || !isLicenseActive(owner)) continue;
    if (maybePauseForBounces(plan)) continue;

    const sender = db.prepare('SELECT * FROM senders WHERE id = ? AND user_id = ?').get(plan.sender_id, plan.user_id);
    if (!sender) {
      db.prepare(
        "UPDATE warmup_plans SET status = 'paused', pause_reason = 'Sender is missing.', paused_at = datetime('now') WHERE id = ?"
      ).run(plan.id);
      continue;
    }

    const isNewDay = !plan.last_queued_on || plan.last_queued_on !== today;
    let progressDays = plan.progress_days || 0;
    if (isNewDay && plan.last_queued_on) progressDays = (plan.progress_days || 0) + 1;

    const target = dailyTarget({ ...plan, progress_days: progressDays });
    const already = planStats(plan.id).today_placed;
    let need = Math.max(0, target - already);
    const quota = remainingQuota(owner);
    if (quota !== Infinity) need = Math.min(need, quota);
    if (need <= 0) {
      if (already >= target && isNewDay) {
        db.prepare('UPDATE warmup_plans SET last_queued_on = ?, progress_days = ?, pause_reason = ? WHERE id = ?').run(
          today,
          progressDays,
          '',
          plan.id
        );
      }
      continue;
    }

    const seeds = pickSeedsForDay(plan, need, sender.from_email);
    if (!seeds.length) continue;

    const times = spreadTimes(seeds.length, now);
    const insert = db.prepare(
      `INSERT INTO messages
         (user_id, channel, sender_id, to_address, subject, html, text, status, source, warmup_plan_id, not_before)
       VALUES (?, 'email', ?, ?, ?, ?, ?, 'queued', 'warmup', ?, ?)`
    );
    const tx = db.transaction(() => {
      seeds.forEach((seed, i) => {
        const note = renderNote(pickNote(plan.id, seed.id, progressDays), seed);
        insert.run(
          plan.user_id,
          sender.id,
          seed.email,
          note.subject,
          note.html,
          note.text,
          plan.id,
          times[i]
        );
      });
      db.prepare('UPDATE warmup_plans SET last_queued_on = ?, progress_days = ?, pause_reason = ? WHERE id = ?').run(
        today,
        progressDays,
        '',
        plan.id
      );
    });
    tx();
    queued += seeds.length;
  }
  return { queued };
}

export function insertSeeds(planId, seeds) {
  const ins = db.prepare(
    `INSERT INTO warmup_seeds (plan_id, email, name, kind)
     VALUES (?, ?, ?, 'owned')
     ON CONFLICT(plan_id, email) DO UPDATE SET name = excluded.name, active = 1`
  );
  const tx = db.transaction((rows) => {
    for (const s of rows.slice(0, MAX_SEEDS)) {
      ins.run(planId, s.email, String(s.name || '').slice(0, 80));
    }
  });
  tx(seeds);
}
