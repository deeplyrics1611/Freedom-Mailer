import { api, $, esc, view, badge, toast, busy, progress, fmtDate, download } from '../core.js';

let presets = null;

export async function poolView() {
  if (!presets) presets = await api('/api/mailboxes/presets');

  view(`<div class="page-head"><h1>Sending pool</h1>
      <button class="tiny secondary" id="verify-all">Verify all</button></div>
    <p class="sub">Mailboxes you own, each authenticated with its own app password. Sends are spread across
      them so no single account goes past the limit its provider enforces.</p>

    <div class="notice">
      <b>What rotation does here.</b> Gmail cuts a free account off at about 500 recipients a day and a
      Workspace account at about 2,000; exceeding that locks the account out of sending for around 24 hours.
      The pool spreads a campaign across the mailboxes you have added, keeps each one inside its own quota,
      and paces sends. Every message is sent under the identity of the account that sent it, with normal
      authentication. It does not disguise who you are, and it will not rescue mail that recipients mark as
      spam — that is a content and list-quality problem, which the Deliverability section is for.
    </div>

    <div class="cards" id="pool-cards"></div>

    <details class="panel" id="add-panel">
      <summary>Add a mailbox</summary>
      <div class="notice">
        <b>Getting a Google app password:</b> turn on 2-Step Verification on the account, then visit
        <span class="mono">myaccount.google.com/apppasswords</span> and create one for "Mail". Google shows it
        as four groups of four characters — paste it with or without spaces. Use the account's normal password
        and the connection will be rejected. Only add accounts you own or are authorised to send from.
      </div>
      <form id="mb-form" class="form-grid">
        <div class="field"><label>Account type</label>
          <select name="provider" id="mb-provider">
            <option value="gmail">Gmail (free @gmail.com)</option>
            <option value="workspace">Google Workspace (your own domain)</option>
            <option value="custom">Other SMTP host</option>
          </select>
          <div class="hint" id="preset-note"></div>
        </div>
        <div class="field"><label>Label</label><input name="label" placeholder="Sales — Dana"></div>
        <div class="field"><label>Mailbox address</label>
          <input name="email" type="email" required placeholder="dana@yourcompany.com"></div>
        <div class="field"><label>App password</label>
          <input name="app_password" type="password" required placeholder="abcd efgh ijkl mnop" autocomplete="off"></div>
        <div class="field"><label>From name</label><input name="from_name" placeholder="Dana Okoye"></div>
        <div class="field"><label>Reply-to (optional)</label><input name="reply_to" type="email"></div>
        <div class="field custom-only hidden"><label>SMTP host</label><input name="host" placeholder="smtp.yourhost.com"></div>
        <div class="field custom-only hidden"><label>Port</label><input name="port" type="number" value="587"></div>
        <div class="field"><label>Daily cap</label><input name="daily_limit" type="number" value="400"></div>
        <div class="field"><label>Hourly cap</label><input name="hourly_limit" type="number" value="40"></div>
        <div class="field"><label>Minimum gap between sends (seconds)</label>
          <input name="min_gap_sec" type="number" value="45">
          <div class="hint">A steady trickle is treated far better than a burst.</div></div>
        <div class="field"><label>Warm-up</label>
          <select name="warmup"><option value="1">On — ramp volume over the first weeks</option>
            <option value="0">Off — go straight to the daily cap</option></select>
          <div class="hint">A new mailbox that suddenly sends hundreds of messages looks compromised.</div></div>
        <div class="actions full"><button type="submit">Add mailbox</button></div>
      </form>
    </details>

    <table id="mb-table"></table>
    <div id="mb-detail"></div>`);

  const providerSelect = $('mb-provider');
  const applyPreset = () => {
    const p = presets[providerSelect.value];
    $('preset-note').textContent = p.note;
    document.querySelectorAll('.custom-only').forEach((el) => el.classList.toggle('hidden', providerSelect.value !== 'custom'));
    const form = $('mb-form');
    form.daily_limit.value = p.daily_limit;
    form.hourly_limit.value = p.hourly_limit;
    if (form.host) form.host.value = p.host;
    if (form.port) form.port.value = p.port;
  };
  providerSelect.addEventListener('change', applyPreset);
  applyPreset();

  $('mb-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const b = Object.fromEntries(new FormData(e.target));
    b.warmup = b.warmup === '1';
    ['daily_limit', 'hourly_limit', 'min_gap_sec', 'port'].forEach((k) => {
      if (b[k] !== undefined) b[k] = parseInt(b[k], 10);
    });
    const btn = e.target.querySelector('button[type=submit]');
    busy(btn, true, 'Adding…');
    try {
      const created = await api('/api/mailboxes', { method: 'POST', body: b });
      e.target.reset();
      applyPreset();
      toast('Mailbox added — verifying the credentials now');
      await verify(created.id, { silent: true });
      poolView();
    } catch (err) {
      toast(err.message, 'err');
    } finally {
      busy(btn, false);
    }
  });

  $('verify-all').addEventListener('click', async (e) => {
    busy(e.target, true, 'Verifying…');
    try {
      const r = await api('/api/mailboxes/verify-all', { method: 'POST' });
      toast(`${r.verified} of ${r.total} mailboxes signed in successfully`, r.verified === r.total ? 'ok' : 'err');
      poolView();
    } catch (err) {
      toast(err.message, 'err');
    } finally {
      busy(e.target, false);
    }
  });

  await renderPool();
}

async function verify(id, { silent = false } = {}) {
  try {
    await api(`/api/mailboxes/${id}/verify`, { method: 'POST' });
    if (!silent) toast('Signed in successfully');
    return true;
  } catch (err) {
    toast(err.message, 'err');
    return false;
  }
}

async function renderPool() {
  const { mailboxes, capacity_today, available_now } = await api('/api/mailboxes');

  const card = (n, label, hint) =>
    `<div class="card"><div class="stat">${n}</div><div class="stat-label">${label}</div>
      ${hint ? `<div class="muted small">${esc(hint)}</div>` : ''}</div>`;
  $('pool-cards').innerHTML = [
    card(mailboxes.length, 'Mailboxes'),
    card(mailboxes.filter((m) => m.verified && m.active).length, 'Ready to send'),
    card(available_now, 'Free right now', 'The rest are at a cap or pacing'),
    card(capacity_today, 'Messages left today', 'Across the whole pool'),
  ].join('');

  if (!mailboxes.length) {
    $('mb-table').innerHTML = '';
    $('add-panel').open = true;
    $('mb-detail').innerHTML = '<p class="muted">No mailboxes yet. Add one above to start.</p>';
    return;
  }

  $('mb-table').innerHTML =
    `<tr><th>Mailbox</th><th>Status</th><th>Today</th><th>This hour</th><th>Warm-up</th><th></th></tr>` +
    mailboxes
      .map((m) => `<tr>
        <td><b>${esc(m.label)}</b><div class="muted small mono">${esc(m.email)}</div></td>
        <td>${m.verified ? badge(m.available ? 'verified' : 'pending') : badge('failed')}
          ${m.blockers.length ? `<div class="muted small">${esc(m.blockers.join(' · '))}</div>` : ''}
          ${m.last_error ? `<div class="err-text small">${esc(m.last_error.slice(0, 140))}</div>` : ''}</td>
        <td>${progress(m.sent_today, m.warmup_day_limit)}</td>
        <td class="small">${m.sent_this_hour} / ${m.hourly_limit}</td>
        <td class="small">${m.warmup ? `${m.warmup_day_limit} of ${m.daily_limit}` : 'off'}</td>
        <td class="nowrap">
          <button class="tiny secondary" data-v="${m.id}">Verify</button>
          <button class="tiny secondary" data-t="${m.id}">Test</button>
          <button class="tiny secondary" data-o="${m.id}">Details</button>
          <button class="tiny secondary" data-p="${m.id}" data-active="${m.active ? 1 : 0}">${m.active ? 'Pause' : 'Resume'}</button>
          <button class="tiny danger" data-d="${m.id}">Delete</button>
        </td></tr>`)
      .join('');

  const table = $('mb-table');
  table.querySelectorAll('[data-v]').forEach((b) =>
    b.addEventListener('click', async () => {
      busy(b, true, '…');
      if (await verify(b.dataset.v)) poolView();
      busy(b, false);
    }));
  table.querySelectorAll('[data-p]').forEach((b) =>
    b.addEventListener('click', async () => {
      await api(`/api/mailboxes/${b.dataset.p}`, { method: 'PATCH', body: { active: b.dataset.active === '0' } });
      poolView();
    }));
  table.querySelectorAll('[data-d]').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirm('Remove this mailbox from the pool?')) return;
      await api(`/api/mailboxes/${b.dataset.d}`, { method: 'DELETE' });
      poolView();
    }));
  table.querySelectorAll('[data-t]').forEach((b) =>
    b.addEventListener('click', () => testSend(parseInt(b.dataset.t, 10), mailboxes)));
  table.querySelectorAll('[data-o]').forEach((b) =>
    b.addEventListener('click', () => showDetail(parseInt(b.dataset.o, 10), mailboxes)));
}

function testSend(id, mailboxes) {
  const mailbox = mailboxes.find((m) => m.id === id);
  const box = $('mb-detail');
  box.innerHTML = `<h2>Send a test from ${esc(mailbox.email)}</h2>
    <p class="sub">Delivers a real message so you can check the From name and how it renders.</p>
    <form id="test-form" class="row">
      <div class="field" style="min-width:280px"><label>Send to</label><input name="to" type="email" required></div>
      <div class="field" style="flex:1"><label>Subject</label><input name="subject" value="Delivery test"></div>
      <button type="submit">Send test</button>
    </form>`;
  box.scrollIntoView({ behavior: 'smooth' });
  $('test-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    busy(btn, true, 'Sending…');
    try {
      await api(`/api/mailboxes/${id}/test`, { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
      toast('Test sent — check the destination inbox');
    } catch (err) {
      toast(err.message, 'err');
    } finally {
      busy(btn, false);
    }
  });
}

async function showDetail(id, mailboxes) {
  const mailbox = mailboxes.find((m) => m.id === id);
  const { days, recent, effective_daily_limit } = await api(`/api/mailboxes/${id}/usage`);
  const box = $('mb-detail');

  box.innerHTML = `<h2>${esc(mailbox.label)} — ${esc(mailbox.email)}</h2>
    <div class="split">
      <div>
        <h3>Limits</h3>
        <form id="limit-form" class="form-grid">
          <div class="field"><label>Daily cap</label><input name="daily_limit" type="number" value="${mailbox.daily_limit}"></div>
          <div class="field"><label>Hourly cap</label><input name="hourly_limit" type="number" value="${mailbox.hourly_limit}"></div>
          <div class="field"><label>Gap between sends (s)</label><input name="min_gap_sec" type="number" value="${mailbox.min_gap_sec}"></div>
          <div class="field"><label>From name</label><input name="from_name" value="${esc(mailbox.from_name)}"></div>
          <div class="field full"><label>Replace the app password (leave blank to keep)</label>
            <input name="app_password" type="password" autocomplete="off" placeholder="abcd efgh ijkl mnop"></div>
          <div class="actions full"><button type="submit">Save</button></div>
        </form>
        <p class="muted small">Warm-up currently allows ${effective_daily_limit} sends per day.</p>
      </div>
      <div>
        <h3>Last 30 days</h3>
        ${days.length
          ? `<div class="bars">${days.slice().reverse().map((d) =>
              `<div class="bar" title="${esc(d.day)}: ${d.sent} sent" style="height:${Math.max(3, Math.round((d.sent / Math.max(1, Math.max(...days.map((x) => x.sent)))) * 100))}%"></div>`).join('')}</div>`
          : '<p class="muted">Nothing sent yet.</p>'}
        <h3>Recent messages</h3>
        <table><tr><th>To</th><th>Status</th><th>When</th></tr>
          ${recent.map((r) => `<tr><td class="small">${esc(r.to_address)}</td>
            <td>${badge(r.status)}${r.error ? `<div class="err-text small">${esc(r.error.slice(0, 90))}</div>` : ''}</td>
            <td class="muted small">${fmtDate(r.sent_at)}</td></tr>`).join('')
            || '<tr><td colspan="3" class="muted">None yet.</td></tr>'}</table>
      </div>
    </div>`;
  box.scrollIntoView({ behavior: 'smooth' });

  $('limit-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const b = Object.fromEntries(new FormData(e.target));
    ['daily_limit', 'hourly_limit', 'min_gap_sec'].forEach((k) => (b[k] = parseInt(b[k], 10)));
    if (!b.app_password) delete b.app_password;
    try {
      await api(`/api/mailboxes/${id}`, { method: 'PATCH', body: b });
      toast(b.app_password ? 'Saved — verify the mailbox again' : 'Saved');
      poolView();
    } catch (err) {
      toast(err.message, 'err');
    }
  });
}
