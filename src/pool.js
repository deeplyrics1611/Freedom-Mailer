import { db } from './db.js';

// Sending is spread across a pool of mailboxes you own so that no single
// account exceeds the limits its provider actually enforces. Gmail cuts off a
// free account at roughly 500 recipients a day and a Workspace account at
// 2,000; going over gets the account temporarily locked for sending.
//
// This is capacity management, not filter evasion: every mailbox authenticates
// normally, sends under its own identity, and stays inside its published quota.

export const GMAIL_PRESETS = {
  gmail: { host: 'smtp.gmail.com', port: 465, secure: 1, daily_limit: 400, hourly_limit: 40,
    note: 'Free gmail.com account. Google enforces ~500 recipients/day; 400 leaves headroom.' },
  workspace: { host: 'smtp.gmail.com', port: 465, secure: 1, daily_limit: 1500, hourly_limit: 120,
    note: 'Google Workspace account on your own domain. Google enforces ~2,000 recipients/day.' },
  custom: { host: '', port: 587, secure: 0, daily_limit: 500, hourly_limit: 50,
    note: 'Any other SMTP host that supports an app-specific password.' },
};

const utcDay = (d = new Date()) => d.toISOString().slice(0, 10);
const utcHour = (d = new Date()) => d.getUTCHours();

function parseSqlTime(value) {
  if (!value) return null;
  // SQLite datetime('now') yields "YYYY-MM-DD HH:MM:SS" in UTC.
  const t = Date.parse(`${String(value).replace(' ', 'T')}${/[Zz]|[+-]\d\d:?\d\d$/.test(value) ? '' : 'Z'}`);
  return Number.isNaN(t) ? null : t;
}

/**
 * A brand-new mailbox that suddenly sends hundreds of messages looks exactly
 * like a compromised account, so volume ramps up over the first few weeks.
 */
export function effectiveDailyLimit(mailbox) {
  if (!mailbox.warmup) return mailbox.daily_limit;
  const created = parseSqlTime(mailbox.created_at) ?? Date.now();
  const daysActive = Math.max(0, Math.floor((Date.now() - created) / 86_400_000));
  const ramped = mailbox.warmup_start + mailbox.warmup_step * daysActive;
  return Math.max(1, Math.min(mailbox.daily_limit, ramped));
}

const bucketOf = (d) => `${utcDay(d)}T${String(utcHour(d)).padStart(2, '0')}`;

/**
 * Usage over a rolling 24-hour window, not a calendar day.
 *
 * This matters: providers enforce a rolling window — Google's own wording is
 * that the limit clears about 24 hours after it was hit. Counting per calendar
 * day would let a mailbox send its full allowance at 23:00 and again at 00:01,
 * which is exactly the burst that gets an account locked out.
 */
export function usageFor(mailboxId, now = new Date()) {
  const since = bucketOf(new Date(now.getTime() - 23 * 3_600_000));
  const rolling24 = db
    .prepare(
      `SELECT COALESCE(SUM(sent), 0) n FROM mailbox_usage
       WHERE mailbox_id = ? AND (day || 'T' || printf('%02d', hour)) >= ?`
    )
    .get(mailboxId, since).n;

  const thisHour = db
    .prepare('SELECT COALESCE(sent, 0) n FROM mailbox_usage WHERE mailbox_id = ? AND day = ? AND hour = ?')
    .get(mailboxId, utcDay(now), utcHour(now))?.n ?? 0;

  return { rolling24, thisHour, day: utcDay(now), hour: utcHour(now) };
}

export function recordSend(mailboxId, now = new Date()) {
  db.prepare(
    `INSERT INTO mailbox_usage (mailbox_id, day, hour, sent) VALUES (?, ?, ?, 1)
     ON CONFLICT(mailbox_id, day, hour) DO UPDATE SET sent = sent + 1`
  ).run(mailboxId, utcDay(now), utcHour(now));
  db.prepare("UPDATE mailboxes SET last_send_at = datetime('now') WHERE id = ?").run(mailboxId);
}

/** Full pool state, including why any mailbox is currently unavailable. */
export function poolStatus(userId, now = new Date()) {
  const rows = db.prepare('SELECT * FROM mailboxes WHERE user_id = ? ORDER BY id').all(userId);
  return rows.map((m) => {
    const usage = usageFor(m.id, now);
    const dailyLimit = effectiveDailyLimit(m);
    const pausedUntil = parseSqlTime(m.paused_until);
    const lastSend = parseSqlTime(m.last_send_at);
    const gapRemaining = lastSend ? Math.max(0, m.min_gap_sec * 1000 - (now.getTime() - lastSend)) : 0;

    const blockers = [];
    if (!m.active) {
      // A mailbox is deactivated either by the operator or automatically after
      // an authentication failure; saying which one avoids a confusing
      // "paused by you" on a mailbox nobody touched.
      blockers.push(m.verified ? 'paused by you' : 'deactivated after a sign-in failure');
    }
    if (!m.verified) blockers.push('not verified');
    if (pausedUntil && pausedUntil > now.getTime()) {
      blockers.push(`cooling down until ${new Date(pausedUntil).toISOString().slice(11, 16)} UTC`);
    }
    if (usage.rolling24 >= dailyLimit) blockers.push(`daily cap reached (${usage.rolling24}/${dailyLimit} in the last 24h)`);
    if (usage.thisHour >= m.hourly_limit) blockers.push(`hourly cap reached (${usage.thisHour}/${m.hourly_limit})`);
    if (gapRemaining > 0) blockers.push(`pacing (${Math.ceil(gapRemaining / 1000)}s to go)`);

    return {
      id: m.id,
      label: m.label,
      email: m.email,
      provider: m.provider,
      host: m.host,
      port: m.port,
      from_name: m.from_name,
      reply_to: m.reply_to,
      active: !!m.active,
      verified: !!m.verified,
      verified_at: m.verified_at,
      last_error: m.last_error,
      last_send_at: m.last_send_at,
      warmup: !!m.warmup,
      effective_daily_limit: dailyLimit,
      daily_limit: m.daily_limit,
      hourly_limit: m.hourly_limit,
      min_gap_sec: m.min_gap_sec,
      sent_24h: usage.rolling24,
      sent_this_hour: usage.thisHour,
      remaining_24h: Math.max(0, dailyLimit - usage.rolling24),
      available: blockers.length === 0,
      blockers,
    };
  });
}

/** Total messages the pool can still send within the current 24-hour window. */
export function poolCapacity(userId) {
  return poolStatus(userId).reduce(
    (sum, m) => (m.active && m.verified ? sum + m.remaining_24h : sum),
    0
  );
}

/**
 * Choose the next mailbox to send from.
 *
 * Least-utilised first (as a fraction of its own daily allowance) so a pool of
 * mixed free and Workspace accounts drains evenly rather than exhausting the
 * smallest one first; ties break toward whichever mailbox has been idle longest.
 */
export function pickMailbox(userId, { only = null, now = new Date() } = {}) {
  const candidates = poolStatus(userId, now).filter((m) => m.available);
  const eligible = only ? candidates.filter((m) => m.id === only) : candidates;
  if (!eligible.length) return null;

  eligible.sort((a, b) => {
    const ua = a.sent_24h / Math.max(1, a.effective_daily_limit);
    const ub = b.sent_24h / Math.max(1, b.effective_daily_limit);
    if (Math.abs(ua - ub) > 0.001) return ua - ub;
    const la = parseSqlTime(a.last_send_at) ?? 0;
    const lb = parseSqlTime(b.last_send_at) ?? 0;
    return la - lb;
  });

  return db.prepare('SELECT * FROM mailboxes WHERE id = ?').get(eligible[0].id);
}

/**
 * Back a mailbox off after the provider pushes back. Gmail's rate-limit and
 * quota errors are temporary; authentication failures are not, so those pause
 * the mailbox until the credentials are fixed.
 */
export function handleSendFailure(mailboxId, errorMessage) {
  const message = String(errorMessage || '').slice(0, 500);
  const authFailure = /invalid login|username and password not accepted|authentication failed|535|534|application-specific password required/i.test(message);
  const rateLimited = /rate|too many|quota|limit exceeded|421|450|4\.7\.0|try again later|temporarily/i.test(message);

  if (authFailure) {
    db.prepare("UPDATE mailboxes SET verified = 0, active = 0, last_error = ? WHERE id = ?").run(message, mailboxId);
    return { paused: true, reason: 'authentication' };
  }
  if (rateLimited) {
    db.prepare("UPDATE mailboxes SET paused_until = datetime('now', '+2 hours'), last_error = ? WHERE id = ?")
      .run(message, mailboxId);
    return { paused: true, reason: 'rate-limited' };
  }
  db.prepare('UPDATE mailboxes SET last_error = ? WHERE id = ?').run(message, mailboxId);
  return { paused: false };
}
