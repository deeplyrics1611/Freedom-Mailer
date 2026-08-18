// Unit test for the mailbox pool's rolling 24-hour accounting and warm-up ramp.
// Runs directly against the database, no server required.

import { db } from '../src/db.js';
import { usageFor, effectiveDailyLimit, poolStatus, pickMailbox } from '../src/pool.js';
import { encryptSecret } from '../src/lib/secrets.js';

let pass = 0;
let fail = 0;
const check = (ok, label, extra = '') => {
  if (ok) {
    pass++;
    console.log(`  \x1b[32mPASS\x1b[0m ${label}`);
  } else {
    fail++;
    console.log(`  \x1b[31mFAIL\x1b[0m ${label}${extra ? ` — ${extra}` : ''}`);
  }
};
const step = (s) => console.log(`\n\x1b[1m== ${s}\x1b[0m`);

const RUN = Date.now().toString(36);
const userId = db.prepare('SELECT id FROM users ORDER BY id LIMIT 1').get()?.id;
if (!userId) {
  console.error('No users in the database. Start the server once to bootstrap the admin.');
  process.exit(1);
}

// Selection tests need a pool containing only this test's mailboxes, so any
// existing ones are stood down for the duration and restored in `finally`.
const suspended = db
  .prepare('SELECT id FROM mailboxes WHERE user_id = ? AND active = 1')
  .all(userId)
  .map((r) => r.id);
for (const id of suspended) db.prepare('UPDATE mailboxes SET active = 0 WHERE id = ?').run(id);

const created = [];
function makeMailbox(overrides = {}) {
  const info = db
    .prepare(
      `INSERT INTO mailboxes
        (user_id, label, provider, host, port, secure, email, app_password, daily_limit, hourly_limit,
         min_gap_sec, warmup, warmup_start, warmup_step, verified, active, created_at)
       VALUES (?, ?, 'custom', 'localhost', 25, 0, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?)`
    )
    .run(
      userId,
      overrides.label || `window-${RUN}-${created.length}`,
      `window-${RUN}-${created.length}@test.local`,
      encryptSecret('x'),
      overrides.daily_limit ?? 100,
      overrides.hourly_limit ?? 1000,
      overrides.min_gap_sec ?? 0,
      overrides.warmup ?? 0,
      overrides.warmup_start ?? 10,
      overrides.warmup_step ?? 5,
      overrides.created_at || new Date().toISOString().slice(0, 19).replace('T', ' ')
    );
  created.push(info.lastInsertRowid);
  return info.lastInsertRowid;
}

// Record `count` sends in the hourly bucket `hoursAgo` hours before now.
function recordAt(mailboxId, hoursAgo, count) {
  const when = new Date(Date.now() - hoursAgo * 3_600_000);
  db.prepare(
    `INSERT INTO mailbox_usage (mailbox_id, day, hour, sent) VALUES (?, ?, ?, ?)
     ON CONFLICT(mailbox_id, day, hour) DO UPDATE SET sent = sent + excluded.sent`
  ).run(mailboxId, when.toISOString().slice(0, 10), when.getUTCHours(), count);
}

try {
  step('Rolling 24-hour window');

  const mb = makeMailbox({ daily_limit: 100 });
  recordAt(mb, 0, 5);
  recordAt(mb, 5, 10);
  recordAt(mb, 20, 7);
  check(usageFor(mb).rolling24 === 22, 'counts sends from across the last 24 hours', `got ${usageFor(mb).rolling24}`);

  // The whole point of the rolling window: sends that have aged out stop
  // counting, and sends from "yesterday" but within 24h still do.
  recordAt(mb, 30, 50);
  check(usageFor(mb).rolling24 === 22, 'ignores sends older than the window', `got ${usageFor(mb).rolling24}`);

  const straddler = makeMailbox({ daily_limit: 100 });
  // 20 hours ago is very likely the previous calendar day; a calendar-day
  // counter would report 0 here and wrongly grant a full fresh allowance.
  recordAt(straddler, 20, 40);
  recordAt(straddler, 22, 40);
  const usage = usageFor(straddler);
  check(usage.rolling24 === 80,
    'counts sends that fall on the previous calendar day but inside the window', `got ${usage.rolling24}`);

  const status = poolStatus(userId).find((m) => m.id === straddler);
  check(status.remaining_24h === 20, `remaining capacity reflects the window (${status.remaining_24h})`);

  step('Hourly cap');

  const hourly = makeMailbox({ daily_limit: 100, hourly_limit: 3 });
  recordAt(hourly, 0, 3);
  const hourlyStatus = poolStatus(userId).find((m) => m.id === hourly);
  check(!hourlyStatus.available, 'a mailbox at its hourly cap is unavailable');
  check(hourlyStatus.blockers.some((b) => /hourly cap/.test(b)),
    'the hourly cap is named as the blocker', JSON.stringify(hourlyStatus.blockers));

  step('Warm-up ramp');

  const today = makeMailbox({ daily_limit: 400, warmup: 1, warmup_start: 10, warmup_step: 5 });
  check(effectiveDailyLimit(db.prepare('SELECT * FROM mailboxes WHERE id = ?').get(today)) === 10,
    'a mailbox added today is limited to the warm-up starting volume');

  const tenDays = new Date(Date.now() - 10 * 86_400_000).toISOString().slice(0, 19).replace('T', ' ');
  const older = makeMailbox({ daily_limit: 400, warmup: 1, warmup_start: 10, warmup_step: 5, created_at: tenDays });
  check(effectiveDailyLimit(db.prepare('SELECT * FROM mailboxes WHERE id = ?').get(older)) === 60,
    'volume ramps by the daily step (10 + 10 days x 5 = 60)');

  const veryOld = new Date(Date.now() - 500 * 86_400_000).toISOString().slice(0, 19).replace('T', ' ');
  const mature = makeMailbox({ daily_limit: 400, warmup: 1, warmup_start: 10, warmup_step: 5, created_at: veryOld });
  check(effectiveDailyLimit(db.prepare('SELECT * FROM mailboxes WHERE id = ?').get(mature)) === 400,
    'the ramp never exceeds the configured cap');

  step('Selection order');

  // Everything created above is still in the pool, so stand it down and compare
  // two fresh mailboxes with a known amount of usage between them.
  for (const id of created) db.prepare('UPDATE mailboxes SET active = 0 WHERE id = ?').run(id);

  const busy = makeMailbox({ daily_limit: 100 });
  const idle = makeMailbox({ daily_limit: 100 });
  recordAt(busy, 1, 40);
  recordAt(idle, 1, 5);
  check(pickMailbox(userId)?.id === idle, 'picks the least-utilised mailbox');

  // Utilisation is relative to each mailbox's own allowance, so a small
  // mailbox is not drained first just because its absolute count is lower.
  for (const id of created) db.prepare('UPDATE mailboxes SET active = 0 WHERE id = ?').run(id);
  const big = makeMailbox({ daily_limit: 1000 });
  const small = makeMailbox({ daily_limit: 50 });
  recordAt(big, 1, 100); // 10% used
  recordAt(small, 1, 20); // 40% used
  check(pickMailbox(userId)?.id === big, 'compares utilisation as a fraction of each mailbox\'s own cap');

  step('Exhaustion');

  for (const id of created) db.prepare('UPDATE mailboxes SET active = 0 WHERE id = ?').run(id);
  const full = makeMailbox({ daily_limit: 5 });
  recordAt(full, 2, 5);
  check(pickMailbox(userId) === null, 'returns nothing when every mailbox is at its cap');
} finally {
  step('Cleanup');
  for (const id of created) db.prepare('DELETE FROM mailboxes WHERE id = ?').run(id);
  for (const id of suspended) db.prepare('UPDATE mailboxes SET active = 1 WHERE id = ?').run(id);
  console.log(`  removed ${created.length} test mailboxes, restored ${suspended.length} existing`);
}

console.log(`\n\x1b[1m${pass} passed, ${fail} failed\x1b[0m`);
process.exit(fail === 0 ? 0 : 1);
