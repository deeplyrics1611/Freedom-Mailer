// Exercises the mailbox pool against a real SMTP conversation.
//
// Starts a local SMTP server that records what it receives, points several
// mailboxes at it, sends a campaign, and asserts that sends were spread across
// the pool and that per-mailbox caps were respected.
//
// Usage: node scripts/test-rotation.js   (requires the app server to be running)

import { SMTPServer } from 'smtp-server';

const BASE = process.env.BASE || 'http://localhost:3000';
const SMTP_PORT = 2526;
const RUN = Date.now().toString(36);
const GOOD_PASSWORD = 'abcdefghijklmnop';

let pass = 0;
let fail = 0;
const check = (ok, label, extra = '') => {
  if (ok) {
    pass++;
    console.log(`  \x1b[32mPASS\x1b[0m ${label}`);
  } else {
    fail++;
    console.log(`  \x1b[31mFAIL\x1b[0m ${label}${extra ? `\n        ${extra}` : ''}`);
  }
};
const step = (s) => console.log(`\n\x1b[1m== ${s}\x1b[0m`);

// ---- Fake SMTP server -------------------------------------------------------

const received = [];
const authAttempts = [];

const smtp = new SMTPServer({
  authOptional: false,
  disabledCommands: ['STARTTLS'],
  onAuth(auth, session, callback) {
    authAttempts.push(auth.username);
    // Only one credential is valid, so the test also covers the failure path.
    if (auth.password === GOOD_PASSWORD) return callback(null, { user: auth.username });
    return callback(new Error('535 5.7.8 Username and Password not accepted'));
  },
  onData(stream, session, callback) {
    let raw = '';
    stream.on('data', (c) => { raw += c; });
    stream.on('end', () => {
      received.push({
        from: session.envelope.mailFrom.address,
        to: session.envelope.rcptTo.map((r) => r.address),
        user: session.user,
        raw,
        at: Date.now(),
      });
      callback();
    });
  },
});

await new Promise((resolve) => smtp.listen(SMTP_PORT, '127.0.0.1', resolve));
console.log(`Fake SMTP server listening on ${SMTP_PORT}`);

// ---- API helpers ------------------------------------------------------------

const login = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    email: process.env.BOOTSTRAP_ADMIN_EMAIL || 'admin@example.com',
    password: process.env.BOOTSTRAP_ADMIN_PASSWORD || 'changeme123',
  }),
}).then((r) => r.json());

if (!login.token) {
  console.error('Could not sign in. Is the app server running?');
  process.exit(1);
}

async function api(path, method = 'GET', body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${login.token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || res.status), { data });
  return data;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cleanup = [];

try {
  // ---- Mailboxes ------------------------------------------------------------
  step('Pool setup against a live SMTP server');

  const mailboxes = [];
  for (const [i, cap] of [4, 4, 2].entries()) {
    const mb = await api('/api/mailboxes', 'POST', {
      provider: 'custom',
      label: `Pool ${i + 1}`,
      email: `pool${i + 1}-${RUN}@test.local`,
      app_password: GOOD_PASSWORD,
      host: '127.0.0.1',
      port: SMTP_PORT,
      secure: false,
      from_name: `Pool ${i + 1}`,
      daily_limit: cap,
      hourly_limit: cap,
      min_gap_sec: 0,
      warmup: false,
    });
    mailboxes.push(mb.id);
    cleanup.push(() => api(`/api/mailboxes/${mb.id}`, 'DELETE'));
  }
  check(mailboxes.length === 3, 'created three mailboxes with caps of 4, 4 and 2');

  const verified = await api('/api/mailboxes/verify-all', 'POST');
  check(verified.verified === 3, 'all three authenticated over SMTP', JSON.stringify(verified.results));
  check(authAttempts.length >= 3, `server saw ${authAttempts.length} AUTH attempts`);

  // A wrong app password must be reported, not silently accepted.
  const bad = await api('/api/mailboxes', 'POST', {
    provider: 'custom', label: 'Bad creds', email: `bad-${RUN}@test.local`,
    app_password: 'definitely-not-the-right-one', host: '127.0.0.1', port: SMTP_PORT, secure: false,
  });
  cleanup.push(() => api(`/api/mailboxes/${bad.id}`, 'DELETE'));
  let badVerified = true;
  try {
    await api(`/api/mailboxes/${bad.id}/verify`, 'POST');
  } catch (err) {
    badVerified = false;
    check(/not accepted|rejected the credentials/i.test(err.message),
      'a bad app password is rejected with a readable explanation', err.message);
  }
  if (badVerified) check(false, 'a bad app password should not verify');
  await api(`/api/mailboxes/${bad.id}`, 'PATCH', { active: false });

  // ---- Leads and campaign ---------------------------------------------------
  step('Paced campaign across the pool');

  const list = await api('/api/lead-lists', 'POST', { name: `Rotation test ${RUN}` });
  cleanup.push(() => api(`/api/lead-lists/${list.id}`, 'DELETE'));

  const LEADS = 10;
  const csv = ['email,first_name,company']
    .concat(Array.from({ length: LEADS }, (_, i) => `lead${i}-${RUN}@example.test,Person${i},Company${i}`))
    .join('\n');
  const imported = await api(`/api/lead-lists/${list.id}/import`, 'POST', { csv });
  check(imported.imported === LEADS, `imported ${imported.imported} leads`);

  const campaign = await api('/api/campaigns', 'POST', {
    name: `Rotation test ${RUN}`,
    mode: 'outreach',
    lead_list_id: list.id,
    use_pool: true,
    subject: 'Quote request for {{company}}',
    text: 'Hi {{first_name|there}},\n\nCan you quote for {{company}}?\n\nThanks',
    postal_address: '1 Test Street, Testville',
    only_valid: false,
    min_delay_sec: 0,
    max_delay_sec: 0,
  });
  cleanup.push(() => api(`/api/campaigns/${campaign.id}`, 'DELETE'));

  const sent = await api(`/api/campaigns/${campaign.id}/send`, 'POST', {});
  check(sent.queued === LEADS, `queued ${sent.queued} messages`);
  check(sent.pool_capacity_today === 10, `reported pool capacity of ${sent.pool_capacity_today} for today`);

  // The worker ticks every 5s with a budget derived from GLOBAL_RATE_PER_MINUTE.
  for (let i = 0; i < 30 && received.length < LEADS; i++) await sleep(1000);

  check(received.length === LEADS, `SMTP server received ${received.length} of ${LEADS} messages`);

  // ---- Rotation -------------------------------------------------------------
  step('Rotation and quota behaviour');

  const byUser = received.reduce((acc, m) => {
    const user = m.user || 'unknown';
    acc[user] = (acc[user] || 0) + 1;
    return acc;
  }, {});
  const counts = Object.values(byUser);
  console.log(`  distribution: ${JSON.stringify(byUser)}`);

  check(Object.keys(byUser).length === 3, 'every mailbox in the pool was used');
  check(counts.every((n) => n <= 4), 'no mailbox exceeded its daily cap', JSON.stringify(byUser));
  const smallest = byUser[`pool3-${RUN}@test.local`];
  check(smallest !== undefined && smallest <= 2,
    `the mailbox capped at 2 sent no more than 2 (sent ${smallest})`);

  // ---- Message content ------------------------------------------------------
  step('Message content and compliance');

  const sample = received[0];
  // Headers may be folded onto continuation lines, and nodemailer only quotes a
  // display name when it contains characters that require it.
  const headers = sample.raw.split(/\r?\n\r?\n/)[0].replace(/\r?\n[ \t]+/g, ' ');
  check(/^From: "?Pool \d"? <pool\d-/m.test(headers),
    'From header carries the sending mailbox identity', headers.match(/^From:.*/m)?.[0]);
  check(/List-Unsubscribe: <http/i.test(headers), 'List-Unsubscribe header present');
  check(/List-Unsubscribe-Post: List-Unsubscribe=One-Click/i.test(sample.raw), 'one-click unsubscribe header present');
  check(/1 Test Street, Testville/.test(sample.raw), 'postal address present in the body');
  check(!/\{\{/.test(sample.raw), 'no unrendered merge fields left in the message');

  const subjects = received.map((m) => (m.raw.match(/^Subject: (.*)$/m) || [])[1] || '');
  check(subjects.every((s) => /Quote request for Company\d/.test(s)),
    'every subject was personalised per recipient', subjects.slice(0, 3).join(' | '));
  check(new Set(subjects).size === LEADS, 'each recipient got a distinct personalised subject');

  const envelopes = new Set(received.map((m) => m.from));
  check(envelopes.size === 3, `envelope sender matched the sending mailbox (${envelopes.size} distinct)`);

  // ---- Capacity exhaustion --------------------------------------------------
  step('Behaviour when the pool is exhausted');

  // Scoped to the mailboxes this test created: the account may hold others.
  const status = await api('/api/mailboxes');
  const ours = status.mailboxes.filter((m) => mailboxes.includes(m.id));
  const otherCapacity = status.mailboxes
    .filter((m) => !mailboxes.includes(m.id))
    .reduce((sum, m) => (m.verified && m.active ? sum + m.remaining_24h : sum), 0);

  check(status.capacity_today - otherCapacity === 0,
    `the test mailboxes report no capacity left (pool total ${status.capacity_today}, other mailboxes ${otherCapacity})`);
  check(ours.every((m) => m.blockers.some((b) => /daily cap/.test(b))),
    'each test mailbox reports its daily cap as the blocker',
    JSON.stringify(ours.map((m) => m.blockers)));

  const second = await api('/api/campaigns', 'POST', {
    name: `Overflow ${RUN}`, mode: 'outreach', lead_list_id: list.id, use_pool: true,
    subject: 'Follow-up for {{company}}', text: 'Hi {{first_name|there}}, following up.',
    postal_address: '1 Test Street, Testville', only_valid: false, min_delay_sec: 0, max_delay_sec: 0,
  });
  cleanup.push(() => api(`/api/campaigns/${second.id}`, 'DELETE'));
  const overflow = await api(`/api/campaigns/${second.id}/send`, 'POST', {});
  check(/remainder will send automatically/.test(overflow.note || ''),
    'warns that queued messages exceed today\'s capacity', overflow.note);

  const before = received.length;
  await sleep(8000);
  check(received.length === before,
    `nothing was sent past the caps (still ${received.length} received)`);

  const log = await api('/api/messages');
  const deferred = log.filter((m) => m.status === 'queued' && /no mailbox in the pool is available/.test(m.error || ''));
  check(deferred.length > 0, `${deferred.length} message(s) deferred with a clear reason rather than failed`);

  await api(`/api/campaigns/${second.id}/pause`, 'POST');
} catch (err) {
  fail++;
  console.error('\n\x1b[31mUnexpected error:\x1b[0m', err.message, err.data ? JSON.stringify(err.data) : '');
} finally {
  step('Cleanup');
  for (const fn of cleanup.reverse()) await fn().catch(() => {});
  console.log('  removed test data');
  smtp.close();
}

console.log(`\n\x1b[1m${pass} passed, ${fail} failed\x1b[0m`);
process.exit(fail === 0 ? 0 : 1);
