// ---- QuoteMail admin panel (vanilla SPA) ----
const state = { token: localStorage.getItem('fm_token') || null, user: null, route: 'dashboard', lastFocus: null };

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const res = await fetch(path, { ...opts, headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  if (res.status === 401) { logout(); throw new Error('Session expired'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

function toast(msg, kind = 'ok') {
  const t = $('toast'); t.textContent = msg; t.className = `toast ${kind}`;
  setTimeout(() => t.classList.add('hidden'), 3200);
}

function logout() {
  state.token = null; state.user = null; localStorage.removeItem('fm_token');
  $('app').classList.add('hidden'); $('login').classList.remove('hidden');
}

$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('login-error').textContent = '';
  try {
    const data = await api('/api/auth/login', {
      method: 'POST',
      body: { email: $('login-email').value, password: $('login-password').value },
    });
    state.token = data.token; localStorage.setItem('fm_token', data.token);
    await boot();
  } catch (err) { $('login-error').textContent = err.message; }
});
$('logout').addEventListener('click', logout);

const NAV = [
  ['dashboard', 'Dashboard'],
  ['quota', 'Quotas & usage'],
  ['gmail', 'Gmail pool'],
  ['sms', 'SMS'],
  ['campaigns', 'RFQ campaigns'],
  ['lists', 'Lists'],
  ['contacts', 'Contacts'],
  ['leads', 'Lead validation'],
  ['deliverability', 'Deliverability'],
  ['templates', 'Templates'],
  ['senders', 'SMTP senders'],
  ['suppressions', 'Suppressions'],
  ['messages', 'Message log'],
  ['apikeys', 'API keys'],
  ['account', 'Account'],
];
const ADMIN_NAV = [['users', 'Users (admin)']];

function renderNav() {
  const items = [...NAV, ...(state.user.role === 'admin' ? ADMIN_NAV : [])];
  $('nav').innerHTML = items
    .map(([r, label]) => `<a data-route="${r}" class="${r === state.route ? 'active' : ''}">${label}</a>`)
    .join('');
  $('nav').querySelectorAll('a').forEach((a) =>
    a.addEventListener('click', () => go(a.dataset.route)));
  $('who').textContent = `${state.user.email} · ${state.user.role}`;
}

function go(route) { state.route = route; renderNav(); views[route](); }

async function boot() {
  state.user = await api('/api/auth/me');
  $('login').classList.add('hidden'); $('app').classList.remove('hidden');
  renderNav(); go('dashboard');
}

const views = {};
const view = (html) => { $('view').innerHTML = html; };
const badge = (status) => {
  const map = {
    sent: 'ok', confirmed: 'ok', verified: 'ok', deliverable: 'ok', good: 'ok', pass: 'ok', inbox: 'ok',
    queued: 'warn', pending: 'warn', sending: 'warn', risky: 'warn', caution: 'warn', warn: 'warn', promotions: 'warn',
    draft: 'muted', failed: 'err', skipped: 'muted', unsubscribed: 'muted', undeliverable: 'err',
    bad: 'err', fail: 'err', spam: 'err',
  };
  return `<span class="badge ${map[status] || 'muted'}">${esc(status)}</span>`;
};

function formBody(form) {
  return Object.fromEntries(new FormData(form));
}

function trackFocus(root) {
  root.querySelectorAll('input, textarea').forEach((el) => {
    el.addEventListener('focus', () => { state.lastFocus = el; });
  });
}

function insertPlaceholder(key) {
  const token = `{{${key}}}`;
  const el = state.lastFocus;
  if (!el || !('value' in el)) {
    toast(`Copied ${token}`);
    navigator.clipboard?.writeText(token);
    return;
  }
  const start = el.selectionStart ?? el.value.length;
  el.value = el.value.slice(0, start) + token + el.value.slice(el.selectionEnd ?? start);
  el.focus();
}

function placeholderChips(keys) {
  return `<div class="chips">${keys.map((k) => `<button type="button" class="chip" data-ph="${esc(k)}">{{${esc(k)}}}</button>`).join('')}</div>`;
}

const PH = ['first_name', 'last_name', 'name', 'email', 'company', 'title', 'phone',
  'sender_name', 'sender_email', 'sender_company', 'rfq_item', 'rfq_qty', 'rfq_needed_by', 'physical_address', 'today'];

views.dashboard = async () => {
  view(`<div class="page-head"><div><h1>Dashboard</h1></div></div>
    <p class="sub">Gmail RFQ sending, validation, and placement tools.</p>
    <div id="d-cards" class="cards"></div>
    <div class="notice" style="margin-top:18px">Add Gmail <b>app passwords</b> under Gmail pool, import leads, run MX validation, then send a personalized RFQ campaign. Rotation spreads sends across the accounts you own, each with a daily cap.</div>`);
  const s = await api('/api/stats');
  const card = (n, label) => `<div class="card"><div class="stat">${n}</div><div class="stat-label">${label}</div></div>`;
  $('d-cards').innerHTML = [
    card(s.gmail_ready, 'Gmail accounts ready'), card(s.sms_providers ?? (s.sms_enabled ? 1 : 0), 'SMS providers'),
    card(s.contacts, 'Contacts'), card(s.confirmed, 'Confirmed on lists'),
    card(s.campaigns, 'Campaigns'), card(s.sms_sent || 0, 'SMS sent'),
    card(s.sent, 'Messages sent'),     card(s.queued, 'In queue'),
    card(s.failed, 'Failed'), card(s.suppressed, 'Suppressed'),
  ].join('');
};

views.quota = async () => {
  view(`<div class="page-head"><h1>Quotas &amp; usage</h1>
    <button class="tiny secondary" id="q-refresh">Refresh live lookup</button></div>
    <p class="sub">Looks up remaining send capacity for email (Gmail pool / SMTP) and SMS (Twilio and other gateways), plus QuoteMail API key usage. Live balances come from each provider’s API using the keys you saved.</p>
    <div id="q-body"><p class="muted">Loading…</p></div>`);
  $('q-refresh').addEventListener('click', views.quota);
  try {
    const q = await api('/api/quota');
    const a = q.account;
    const pct = a.daily_quota ? Math.min(100, Math.round((a.used_today / a.daily_quota) * 100)) : 0;
    const meter = pct >= 90 ? 'err' : pct >= 70 ? 'warn' : '';
    const money = (p) => {
      if (p.balance == null && p.cash_credits == null) return '—';
      const v = p.balance != null ? p.balance : p.cash_credits;
      return `${esc(v)}${p.currency ? ` ${esc(p.currency)}` : ''}`;
    };
    const usage = (u) => u ? `${u.count || 0}${u.price != null ? ` · ${esc(u.price)}` : ''}` : '—';

    $('q-body').innerHTML = `
      <h2>This account (email + SMS)</h2>
      <div class="card">
        <div class="score-big">${a.remaining_today}</div>
        <div class="stat-label">remaining of ${a.daily_quota} daily quota</div>
        <div class="meter ${meter}"><span style="width:${pct}%"></span></div>
        <p class="help">Used today ${a.used_today} · email sent ${a.email_today} · SMS sent ${a.sms_today} · failed ${a.failed_today}
        · this month email ${a.email_month} / SMS ${a.sms_month}
        · queued email ${a.email_queued} / SMS ${a.sms_queued}</p>
      </div>

      <h2>Email — Gmail pool</h2>
      <p class="help">${esc(q.gmail.note)}</p>
      <div class="cards">
        <div class="card"><div class="stat">${q.gmail.remaining_today}</div><div class="stat-label">Gmail remaining today</div></div>
        <div class="card"><div class="stat">${q.gmail.accounts_ready}</div><div class="stat-label">Mailboxes ready</div></div>
        <div class="card"><div class="stat">${q.gmail.verified}</div><div class="stat-label">Verified</div></div>
      </div>
      <table>
        <tr><th>Mailbox</th><th>Today</th><th>Remaining</th><th>Cap</th><th>Rotation</th><th>Last used</th></tr>
        ${(q.gmail.accounts || []).map((s) => `<tr>
          <td><b>${esc(s.label)}</b><div class="mono small">${esc(s.email)}</div></td>
          <td>${s.sent_today}</td>
          <td><b>${s.remaining_today}</b></td>
          <td>${s.daily_limit}</td>
          <td>${s.in_rotation && s.verified ? badge('verified') : badge('pending')}</td>
          <td class="muted small">${esc(s.last_used_at || '—')}</td>
        </tr>`).join('') || '<tr><td colspan="6" class="muted">No Gmail accounts. Add them under Gmail pool.</td></tr>'}
      </table>
      ${q.smtp.length ? `<h2>SMTP identities</h2>
        <table><tr><th>Label</th><th>From</th><th>Host</th><th>Today</th><th>Remaining</th></tr>
        ${q.smtp.map((s) => `<tr><td>${esc(s.label)}</td><td>${esc(s.from_email)}</td>
          <td class="mono small">${esc(s.host)}</td><td>${s.sent_today}</td><td>${s.remaining_today}</td></tr>`).join('')}
        </table>` : ''}

      <h2>SMS — Twilio &amp; other APIs</h2>
      <p class="help">Live lookup uses the Account SID / API key you saved (or <span class="mono">TWILIO_*</span> in .env). Secrets are masked.</p>
      ${(q.sms_providers || []).map((p) => `<div class="card" style="margin-bottom:12px">
        <div class="row" style="justify-content:space-between;align-items:center">
          <div><b>${esc(p.label)}</b> ${badge(p.ok ? 'verified' : 'failed')}
            <span class="muted small">${esc(p.provider)}${p.system ? ' · .env' : ''}</span>
            ${p.console_url ? ` · <a href="${esc(p.console_url)}" target="_blank" rel="noopener">console</a>` : ''}
          </div>
          <div class="stat">${money(p)}</div>
        </div>
        ${p.error ? `<div class="issue high" style="margin-top:8px">${esc(p.error)}</div>` : ''}
        ${p.note ? `<p class="help">${esc(p.note)}</p>` : ''}
        <table style="margin-top:10px">
          <tr><th>Key</th><th>Status</th><th>From</th><th>SMS today (provider)</th><th>SMS month</th><th>Local today</th></tr>
          <tr>
            <td class="mono small">${esc(p.key_masked || '—')}</td>
            <td>${esc(p.status || p.type || (p.live ? 'live' : 'local'))}${p.friendly_name ? ` · ${esc(p.friendly_name)}` : ''}</td>
            <td class="mono small">${esc(p.from_number || '—')}</td>
            <td>${usage(p.sms_today)}</td>
            <td>${usage(p.sms_month)}</td>
            <td>${p.local ? `${p.local.sent_today} sent / ${p.local.queued} queued / ${p.local.failed_today} failed` : '—'}</td>
          </tr>
        </table>
        ${p.numbers?.length ? `<p class="help" style="margin-top:8px">Numbers: ${p.numbers.map((n) => esc(n.phone || n.msisdn || '')).filter(Boolean).join(', ')}</p>` : ''}
        ${p.messaging_service_sid ? `<p class="help">Messaging Service ${esc(p.messaging_service_sid)}</p>` : ''}
      </div>`).join('') || '<div class="notice">No SMS providers yet. Add Twilio (Account SID + Auth Token) under SMS, or set TWILIO_* in .env.</div>'}

      <h2>QuoteMail API keys</h2>
      <p class="help">Keys for <code>POST /api/v1/email</code> and <code>POST /api/v1/sms</code>. Usage is counted after this update; older sends may show as unattributed.
      Quota for a key: <code>GET /api/v1/quota</code> with header <code>X-API-Key</code>.</p>
      <table>
        <tr><th>Name</th><th>Prefix</th><th>Today</th><th>Email</th><th>SMS</th><th>All sends</th><th>Last used</th><th></th></tr>
        ${(q.api_keys.keys || []).map((k) => `<tr>
          <td>${esc(k.name)}</td>
          <td class="mono">${esc(k.key_prefix)}…</td>
          <td>${k.today}</td><td>${k.email}</td><td>${k.sms}</td><td>${k.sends}</td>
          <td class="muted small">${esc(k.last_used || 'never')}</td>
          <td>${k.revoked ? badge('failed') : badge('confirmed')}</td>
        </tr>`).join('') || '<tr><td colspan="8" class="muted">No API keys. Create one under API keys.</td></tr>'}
      </table>
      ${q.api_keys.unattributed_sends ? `<p class="help">${q.api_keys.unattributed_sends} older API send(s) are not tied to a key.</p>` : ''}
      <p class="muted small">Fetched ${esc(q.fetched_at)}</p>`;
  } catch (err) {
    $('q-body').innerHTML = `<div class="issue high">${esc(err.message)}</div>`;
  }
};

views.gmail = async () => {
  view(`<div class="page-head"><h1>Gmail pool</h1></div>
    <p class="sub">Add as many Google accounts as you own. Each uses an <b>App Password</b> (not your normal Gmail password). Verified accounts in rotation are used round-robin, respecting per-account daily caps.</p>
    <div class="notice">
      <b>Create an app password:</b>
      <ol class="ol">
        <li>Turn on 2-Step Verification on the Google account.</li>
        <li>Google Account → Security → App passwords (or <span class="mono">myaccount.google.com/apppasswords</span>).</li>
        <li>Generate a Mail / Other password. Paste the 16 characters (spaces optional).</li>
        <li>Workspace users: the admin must allow app passwords, or use a mailbox you control.</li>
      </ol>
    </div>
    <div id="pool-status" class="cards" style="margin-bottom:16px"></div>
    <form id="gmail-form" class="form-grid">
      <div class="field"><label>Gmail / Workspace email</label><input name="email" type="email" required placeholder="you@gmail.com"></div>
      <div class="field"><label>App password</label><input name="app_password" type="password" required placeholder="xxxx xxxx xxxx xxxx" autocomplete="off"></div>
      <div class="field"><label>From name</label><input name="from_name" placeholder="Jordan Lee"></div>
      <div class="field"><label>Label</label><input name="label" placeholder="Quotes mailbox"></div>
      <div class="field"><label>Daily cap</label><input name="daily_limit" type="number" value="80" min="1" max="2000"></div>
      <div class="field"><label>Include in rotation</label>
        <select name="in_rotation"><option value="true">Yes</option><option value="false">No</option></select></div>
      <div class="actions full"><button type="submit">Add &amp; verify</button></div>
    </form>
    <table id="gmail-table"></table>`);

  $('gmail-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const b = formBody(e.target);
    b.daily_limit = parseInt(b.daily_limit, 10);
    b.in_rotation = b.in_rotation === 'true';
    b.verify = true;
    try {
      const r = await api('/api/gmail', { method: 'POST', body: b });
      toast(r.verified ? 'Gmail verified and added' : (r.warning || 'Saved'));
      e.target.reset();
      views.gmail();
    } catch (err) { toast(err.message, 'err'); }
  });

  const data = await api('/api/gmail');
  const st = data.status || {};
  $('pool-status').innerHTML = [
    ['Accounts', st.accounts || 0],
    ['Verified', st.verified || 0],
    ['In rotation', st.in_rotation || 0],
    ['Ready now', st.accounts_ready || 0],
    ['Remaining today', st.remaining_today || 0],
  ].map(([label, n]) => `<div class="card"><div class="stat">${n}</div><div class="stat-label">${label}</div></div>`).join('');

  const rows = data.pool || [];
  $('gmail-table').innerHTML = `<tr><th>Account</th><th>From</th><th>Today</th><th>Rotation</th><th>Status</th><th></th></tr>` +
    (rows.map((s) => `<tr>
      <td><b>${esc(s.label)}</b><div class="muted small mono">${esc(s.username)}</div></td>
      <td>${esc(s.from_name)}</td>
      <td>${s.sent_today || 0} / ${s.daily_limit}</td>
      <td>${s.in_rotation ? badge('verified') : badge('draft')} ${s.in_rotation ? 'on' : 'off'}</td>
      <td>${s.verified ? badge('verified') : badge('pending')}</td>
      <td>
        <button class="tiny secondary" data-v="${s.id}">Verify</button>
        <button class="tiny secondary" data-r="${s.id}" data-on="${s.in_rotation ? 1 : 0}">${s.in_rotation ? 'Pause' : 'Rotate'}</button>
        <button class="tiny danger" data-d="${s.id}">Delete</button>
      </td></tr>`).join('')
      || `<tr><td colspan="6" class="muted">No Gmail accounts yet.</td></tr>`);

  $('gmail-table').querySelectorAll('[data-v]').forEach((b) => b.addEventListener('click', async () => {
    try { await api(`/api/gmail/${b.dataset.v}/verify`, { method: 'POST' }); toast('Verified'); views.gmail(); }
    catch (err) { toast(err.message, 'err'); }
  }));
  $('gmail-table').querySelectorAll('[data-r]').forEach((b) => b.addEventListener('click', async () => {
    await api(`/api/gmail/${b.dataset.r}`, { method: 'PATCH', body: { in_rotation: b.dataset.on !== '1' } });
    views.gmail();
  }));
  $('gmail-table').querySelectorAll('[data-d]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Remove this Gmail identity?')) return;
    await api(`/api/gmail/${b.dataset.d}`, { method: 'DELETE' }); views.gmail();
  }));
};

views.sms = async () => {
  const data = await api('/api/sms/providers');
  const lists = await api('/api/lists');
  const catalog = data.catalog || [];
  const fieldHtml = (fields) => (fields || []).map((f) => {
    const ta = f.name === 'body_template';
    return `<div class="field ${ta ? 'full' : ''}"><label>${esc(f.label)}</label>${
      ta
        ? `<textarea name="${esc(f.name)}" rows="3" placeholder="${esc(f.placeholder || '')}"></textarea>`
        : `<input name="${esc(f.name)}" type="${f.type === 'password' ? 'password' : 'text'}" placeholder="${esc(f.placeholder || '')}" autocomplete="off">`
    }</div>`;
  }).join('');

  view(`<div class="page-head"><h1>SMS</h1></div>
    <p class="sub">Send texts through <b>Twilio</b> (<span class="mono">TWILIO_ACCOUNT_SID</span> / <span class="mono">TWILIO_AUTH_TOKEN</span>) or another gateway. Add providers here, or set env vars on the server.</p>
    ${data.system ? `<div class="notice">System provider from .env: <b>${esc(data.system.label)}</b> · from ${esc(data.system.from_number || '—')}</div>` : '<div class="notice">No .env Twilio/Vonage yet. Add a provider below (Twilio Account SID + Auth Token is the usual setup).</div>'}
    <h2>Providers</h2>
    <form id="sms-prov-form" class="form-grid">
      <div class="field"><label>Gateway</label>
        <select name="provider" id="sms-kind">
          ${catalog.map((p) => `<option value="${esc(p.id)}">${esc(p.label)}</option>`).join('')}
        </select></div>
      <div class="field"><label>Label</label><input name="label" placeholder="RFQ SMS"></div>
      <div id="sms-fields" class="full form-grid"></div>
      <p class="help full" id="sms-hint"></p>
      <div class="actions full"><button type="submit">Add &amp; verify</button></div>
    </form>
    <table id="sms-prov-table"></table>
    <h2>Send one SMS</h2>
    <form id="sms-send-form" class="form-grid">
      <div class="field"><label>Provider</label><select name="provider_id" id="sms-prov-sel"></select></div>
      <div class="field"><label>To (E.164)</label><input name="to" required placeholder="+15551234567"></div>
      <div class="field full"><label>Message</label><textarea name="body" id="sms-body" rows="4" placeholder="Hi {{first_name}}, requesting a quote for {{rfq_item}}…"></textarea>
        <div class="muted small" id="sms-seg"></div></div>
      <div class="actions full"><button type="submit">Queue SMS</button></div>
    </form>
    <h2>Send to a list</h2>
    <p class="help">Contacts need a phone number. Placeholders work the same as email. A STOP opt-out line is appended.</p>
    ${placeholderChips(['first_name', 'company', 'rfq_item', 'sender_name'])}
    <form id="sms-camp-form" class="form-grid">
      <div class="field"><label>Name</label><input name="name" placeholder="RFQ SMS blast"></div>
      <div class="field"><label>List</label><select name="list_id" required>
        <option value="">— choose —</option>
        ${lists.map((l) => `<option value="${l.id}">${esc(l.name)} (${l.confirmed} confirmed)</option>`).join('')}
      </select></div>
      <div class="field"><label>Provider</label><select name="provider_id" class="sms-prov-copy"></select></div>
      <div class="field"><label>Who</label>
        <select name="send_to"><option value="confirmed">Confirmed only</option><option value="all_in_list">All on list except unsubscribed</option></select></div>
      <div class="field full"><label>Message</label><textarea name="body" rows="4" required></textarea></div>
      <div class="actions full"><button type="submit">Queue to list</button></div>
    </form>
    <h2>API</h2>
    <pre>curl -X POST ${location.origin}/api/v1/sms \\
  -H "X-API-Key: YOUR_KEY" -H "Content-Type: application/json" \\
  -d '{"to":"+15551234567","body":"Quote request from Your Company"}'</pre>
    <h2>Recent SMS</h2>
    <table id="sms-log"></table>`);

  const kind = $('sms-kind');
  const paintFields = () => {
    const p = catalog.find((x) => x.id === kind.value) || catalog[0];
    $('sms-fields').innerHTML = fieldHtml(p?.fields);
    $('sms-hint').textContent = p?.hint || '';
  };
  paintFields();
  kind.addEventListener('change', paintFields);

  const provOptions = () => {
    const rows = (data.providers || []).filter((p) => p.verified && p.active);
    const sys = data.system ? `<option value="">${esc(data.system.label)}</option>` : '<option value="">— default —</option>';
    return sys + rows.map((p) => `<option value="${p.id}">${esc(p.label)} (${esc(p.provider)})</option>`).join('');
  };
  $('sms-prov-sel').innerHTML = provOptions();
  $('view').querySelectorAll('.sms-prov-copy').forEach((s) => { s.innerHTML = provOptions(); });

  $('sms-prov-table').innerHTML = `<tr><th>Label</th><th>Gateway</th><th>From</th><th>Status</th><th></th></tr>` +
    ((data.providers || []).map((p) => `<tr>
      <td>${esc(p.label)}</td><td>${esc(p.provider)}</td>
      <td class="mono small">${esc(p.from_number || p.extra?.messaging_service_sid || '—')}</td>
      <td>${p.verified ? badge('verified') : badge('pending')}</td>
      <td><button class="tiny secondary" data-v="${p.id}">Verify</button>
          <button class="tiny danger" data-d="${p.id}">Delete</button></td></tr>`).join('')
      || `<tr><td colspan="5" class="muted">No panel providers yet — add Twilio or another gateway, or use .env.</td></tr>`);

  $('sms-prov-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const b = formBody(e.target);
    b.verify = true;
    try {
      const r = await api('/api/sms/providers', { method: 'POST', body: b });
      toast(r.verified ? 'Provider verified' : (r.warning || 'Saved'));
      views.sms();
    } catch (err) { toast(err.message, 'err'); }
  });
  $('sms-prov-table').querySelectorAll('[data-v]').forEach((b) => b.addEventListener('click', async () => {
    try { await api(`/api/sms/providers/${b.dataset.v}/verify`, { method: 'POST' }); toast('Verified'); views.sms(); }
    catch (err) { toast(err.message, 'err'); }
  }));
  $('sms-prov-table').querySelectorAll('[data-d]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Remove this SMS provider?')) return;
    await api(`/api/sms/providers/${b.dataset.d}`, { method: 'DELETE' }); views.sms();
  }));

  const seg = () => {
    const t = $('sms-body')?.value || '';
    const uni = /[^\x00-\x7F]/.test(t);
    const n = [...t].length;
    const segs = n === 0 ? 0 : n <= (uni ? 70 : 160) ? 1 : Math.ceil(n / (uni ? 67 : 153));
    $('sms-seg').textContent = `${n} chars · ${segs} segment${segs === 1 ? '' : 's'}${uni ? ' · Unicode' : ''}`;
  };
  $('sms-body')?.addEventListener('input', seg); seg();

  $('sms-send-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const b = formBody(e.target);
    b.provider_id = b.provider_id || null;
    try {
      const r = await api('/api/sms/send', { method: 'POST', body: b });
      toast(`Queued to ${r.to}`); views.sms();
    } catch (err) { toast(err.message, 'err'); }
  });
  trackFocus($('sms-camp-form'));
  $('view').querySelectorAll('[data-ph]').forEach((b) => b.addEventListener('click', () => insertPlaceholder(b.dataset.ph)));
  $('sms-camp-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!confirm('Queue SMS to this list? Confirm you have consent or another lawful basis (TCPA / local rules).')) return;
    const b = formBody(e.target);
    b.list_id = parseInt(b.list_id, 10);
    b.provider_id = b.provider_id || null;
    b.lawful_basis = true;
    try {
      const r = await api('/api/sms/campaign', { method: 'POST', body: b });
      toast(`Queued ${r.queued} · skipped ${r.skipped}`); views.sms();
    } catch (err) { toast(err.message, 'err'); }
  });

  const log = await api('/api/sms/messages');
  $('sms-log').innerHTML = `<tr><th>To</th><th>Body</th><th>Status</th><th>When</th></tr>` +
    (log.map((m) => `<tr><td class="mono">${esc(m.to_address)}</td>
      <td class="small">${esc((m.text || '').slice(0, 120))}${m.error ? `<div class="muted">${esc(m.error)}</div>` : ''}</td>
      <td>${badge(m.status)}</td>
      <td class="muted small">${esc((m.sent_at || m.created_at || '').replace('T', ' ').slice(0, 16))}</td></tr>`).join('')
      || `<tr><td colspan="4" class="muted">No SMS yet.</td></tr>`);
};

views.campaigns = async () => {
  const [senders, lists, gmail, templates] = await Promise.all([
    api('/api/senders'), api('/api/lists'), api('/api/gmail'), api('/api/tools/rfq-templates'),
  ]);
  const gmailPool = gmail.pool || [];
  view(`<div class="page-head"><h1>RFQ campaigns</h1></div>
    <p class="sub">Personalize with placeholders. Rotate the Gmail pool, or send from one identity. Unsubscribe + physical address are added automatically.</p>
    <div class="notice">Click a placeholder to insert it into the last field you focused.</div>
    ${placeholderChips(PH)}
    <div class="row" style="margin-bottom:12px">
      ${(templates || []).map((t) => `<button type="button" class="secondary tiny" data-tpl="${esc(t.key)}">${esc(t.name)}</button>`).join('')}
    </div>
    <form id="camp-form" class="form-grid">
      <div class="field"><label>Campaign name</label><input name="name" required placeholder="Q3 housing RFQ"></div>
      <div class="field"><label>Subject</label><input name="subject" required placeholder="Request for quote — {{rfq_item}}"></div>
      <div class="field"><label>Sending</label>
        <select name="rotate_pool">
          <option value="true">Rotate Gmail pool (${gmail.status?.accounts_ready || 0} ready)</option>
          <option value="false">Single identity</option>
        </select></div>
      <div class="field"><label>Single sender</label><select name="sender_id">
        <option value="">— none / pool —</option>
        ${senders.map((s) => `<option value="${s.id}" ${s.verified ? '' : 'disabled'}>${esc(s.label)}${s.verified ? '' : ' (unverified)'}</option>`).join('')}
      </select></div>
      <div class="field"><label>List</label><select name="list_id" required>
        <option value="">— choose —</option>
        ${lists.map((l) => `<option value="${l.id}">${esc(l.name)} (${l.confirmed} confirmed / ${l.pending} pending)</option>`).join('')}
      </select></div>
      <div class="field"><label>Who to send</label>
        <select name="send_to">
          <option value="confirmed">Confirmed subscribers only</option>
          <option value="all_in_list">All on list except unsubscribed</option>
        </select></div>
      <div class="field"><label>RFQ item</label><input name="rfq_item" placeholder="CNC aluminum housings"></div>
      <div class="field"><label>Quantity</label><input name="rfq_qty" placeholder="2,500"></div>
      <div class="field"><label>Needed by</label><input name="rfq_needed_by" placeholder="2026-09-30"></div>
      <div class="field"><label>Your name ({{sender_name}})</label><input name="sender_name" placeholder="Jordan Lee"></div>
      <div class="field"><label>Your company</label><input name="sender_company" value="${esc(state.user.company_name || '')}"></div>
      <div class="field"><label>Physical address (CAN-SPAM)</label><input name="physical_address" value="${esc(state.user.physical_address || '')}" placeholder="123 Market St, Austin, TX"></div>
      <div class="field full"><label>HTML body</label><textarea name="html" id="camp-html" rows="8" placeholder="<p>Hi {{first_name}}…</p>"></textarea></div>
      <div class="field full"><label>Plain text</label><textarea name="text" id="camp-text" rows="4"></textarea></div>
      <div class="actions full">
        <button type="submit">Save draft</button>
        <button type="button" class="secondary" id="btn-preview">Preview merge</button>
        <button type="button" class="secondary" id="btn-spam">Spam check</button>
        <button type="button" class="secondary" id="btn-links">Link check</button>
      </div>
    </form>
    <div id="camp-tools"></div>
    <h2>Saved campaigns</h2>
    <table id="camp-table"></table>`);

  trackFocus($('camp-form'));
  $('view').querySelectorAll('[data-ph]').forEach((b) => b.addEventListener('click', () => insertPlaceholder(b.dataset.ph)));
  $('view').querySelectorAll('[data-tpl]').forEach((b) => b.addEventListener('click', () => {
    const t = templates.find((x) => x.key === b.dataset.tpl);
    if (!t) return;
    const f = $('camp-form');
    if (!f.name.value) f.name.value = t.name;
    f.subject.value = t.subject;
    f.html.value = t.html;
    f.text.value = t.text;
    toast('Template loaded — edit then save');
  }));

  const extraFrom = (f) => ({
    rfq_item: f.rfq_item.value, rfq_qty: f.rfq_qty.value, rfq_needed_by: f.rfq_needed_by.value,
    sender_name: f.sender_name.value, sender_company: f.sender_company.value,
    physical_address: f.physical_address.value,
  });

  $('camp-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const b = formBody(f);
    try {
      await api('/api/campaigns', { method: 'POST', body: {
        name: b.name, subject: b.subject, html: b.html, text: b.text,
        list_id: parseInt(b.list_id, 10), sender_id: b.sender_id || null,
        rotate_pool: b.rotate_pool === 'true', send_to: b.send_to,
        physical_address: b.physical_address, extra_vars: extraFrom(f),
      }});
      toast('Draft saved'); views.campaigns();
    } catch (err) { toast(err.message, 'err'); }
  });

  $('btn-preview').addEventListener('click', async () => {
    const f = $('camp-form');
    try {
      const r = await api('/api/tools/preview', { method: 'POST', body: {
        subject: f.subject.value, html: f.html.value, text: f.text.value, extra_vars: extraFrom(f),
      }});
      $('camp-tools').innerHTML = `<h2>Preview</h2><p class="muted">${esc(r.subject)}</p>
        <div class="preview-box">${r.html || `<pre>${esc(r.text)}</pre>`}</div>`;
    } catch (err) { toast(err.message, 'err'); }
  });
  $('btn-spam').addEventListener('click', async () => {
    const f = $('camp-form');
    const r = await api('/api/tools/spam-check', { method: 'POST', body: { subject: f.subject.value, html: f.html.value, text: f.text.value } });
    renderSpam($('camp-tools'), r);
  });
  $('btn-links').addEventListener('click', async () => {
    const f = $('camp-form');
    const r = await api('/api/tools/link-check', { method: 'POST', body: { html: f.html.value, text: f.text.value } });
    renderLinks($('camp-tools'), r);
  });

  const rows = await api('/api/campaigns');
  $('camp-table').innerHTML = `<tr><th>Name</th><th>List</th><th>Send</th><th>Status</th><th>Sent</th><th></th></tr>` +
    (rows.map((c) => `<tr>
      <td><b>${esc(c.name)}</b><div class="muted small">${esc(c.subject || '')}</div></td>
      <td>${esc(c.list_name || '—')}</td>
      <td>${c.rotate_pool ? 'Gmail pool' : esc(c.sender_label || 'single')}</td>
      <td>${badge(c.status)}</td>
      <td>${c.sent}/${c.total}${c.failed ? ` <span class="badge err">${c.failed} failed</span>` : ''}</td>
      <td>${c.status === 'draft'
        ? `<button class="tiny" data-send="${c.id}">Send</button> <button class="tiny danger" data-del="${c.id}">Delete</button>`
        : `<span class="muted small">—</span>`}</td></tr>`).join('')
      || `<tr><td colspan="6" class="muted">No campaigns yet.</td></tr>`);
  $('camp-table').querySelectorAll('[data-send]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Queue this campaign? Confirm you have a lawful basis to contact these people (B2B RFQ / applicable anti-spam law). Unsubscribed and undeliverable addresses are skipped.')) return;
    try {
      const r = await api(`/api/campaigns/${b.dataset.send}/send`, { method: 'POST', body: { lawful_basis: true } });
      toast(`Queued ${r.queued} · skipped ${r.skipped}`); views.campaigns();
    } catch (err) { toast(err.message, 'err'); }
  }));
  $('camp-table').querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    await api(`/api/campaigns/${b.dataset.del}`, { method: 'DELETE' }); views.campaigns();
  }));
  void gmailPool;
};

function renderSpam(box, r) {
  const meter = r.verdict === 'fail' ? 'err' : r.verdict === 'warn' ? 'warn' : '';
  box.innerHTML = `<h2>HTML / spam filter check</h2>
    <div class="card">
      <div>${badge(r.verdict)} ${esc(r.label)} · score ${r.score} (lower is better)</div>
      <div class="meter ${meter}"><span style="width:${Math.min(100, r.score / 10 * 100)}%"></span></div>
      <div class="muted small">Images ${r.stats.images} · links ${r.stats.links} · text ${r.stats.textLength} chars</div>
    </div>
    <div class="issues">${(r.issues || []).map((i) => `<div class="issue ${esc(i.severity)}"><b>${esc(i.code)}</b> — ${esc(i.message)}</div>`).join('')
      || '<div class="muted">No issues found.</div>'}</div>`;
}

function renderLinks(box, r) {
  box.innerHTML = `<h2>Cold-mail link check</h2>
    <p>${badge(r.summary)} ${esc(r.advice)}</p>
    <table><tr><th>URL</th><th>Host</th><th></th><th>Notes</th></tr>
    ${(r.links || []).map((l) => `<tr>
      <td class="small">${esc(l.url)}</td><td class="mono small">${esc(l.host)}</td>
      <td>${badge(l.verdict)}</td><td class="small">${(l.issues || []).map(esc).join(' ')}</td>
    </tr>`).join('') || '<tr><td colspan="4" class="muted">No links.</td></tr>'}</table>`;
}

function renderInbox(box, r) {
  const meter = r.inbox_likelihood < 45 ? 'err' : r.inbox_likelihood < 70 ? 'warn' : '';
  box.innerHTML = `<h2>Inbox placement estimate</h2>
    <div class="card">
      <div class="score-big">${r.inbox_likelihood}%</div>
      <div>${badge(r.predicted_tab)} ${esc(r.predicted_label)}</div>
      <div class="meter ${meter}"><span style="width:${r.inbox_likelihood}%"></span></div>
      <p class="help">${esc(r.note)}</p>
    </div>
    <div class="issues">${(r.factors || []).map((f) => `<div class="issue ${f.ok ? 'low' : 'high'}">${f.ok ? '✓' : '×'} ${esc(f.text)}</div>`).join('')}</div>`;
}

views.deliverability = async () => {
  view(`<div class="page-head"><h1>Deliverability</h1></div>
    <p class="sub">Inbox estimate, HTML spam-filter check, and cold-mail link review — run these before you queue an RFQ.</p>
    <div class="tabs">
      <button class="active" data-tab="inbox">Inbox placement</button>
      <button data-tab="spam">HTML / spam filters</button>
      <button data-tab="links">Link check</button>
      <button data-tab="probe">IMAP probe</button>
    </div>
    <form id="del-form" class="form-grid">
      <div class="field full"><label>Subject</label><input name="subject" required placeholder="Request for quote — {{rfq_item}}"></div>
      <div class="field full"><label>HTML</label><textarea name="html" rows="8"></textarea></div>
      <div class="field full"><label>Plain text</label><textarea name="text" rows="4"></textarea></div>
      <div class="actions full"><button type="submit" id="del-run">Run check</button></div>
    </form>
    <div id="del-out"></div>
    <div id="probe-box" class="hidden">
      <h2>Live IMAP probe</h2>
      <p class="help">Sends a test to a Gmail mailbox you own, then looks in INBOX vs Spam via IMAP using the same app password. Promotions vs Primary cannot be read over IMAP.</p>
      <form id="probe-form" class="row">
        <div class="field"><label>Gmail identity</label><select name="id" id="probe-id"></select></div>
        <div class="field"><label>Send test to</label><input name="to" type="email" placeholder="same account or another you own"></div>
        <button type="submit">Send &amp; check</button>
      </form>
      <div id="probe-out"></div>
    </div>`);

  const gmail = await api('/api/gmail');
  $('probe-id').innerHTML = (gmail.pool || []).filter((s) => s.verified)
    .map((s) => `<option value="${s.id}">${esc(s.username)}</option>`).join('')
    || '<option value="">— verify a Gmail account first —</option>';

  let tab = 'inbox';
  $('view').querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => {
    tab = b.dataset.tab;
    $('view').querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('active', x === b));
    $('probe-box').classList.toggle('hidden', tab !== 'probe');
    $('del-form').classList.toggle('hidden', tab === 'probe');
    $('del-out').classList.toggle('hidden', tab === 'probe');
  }));

  $('del-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const b = formBody(e.target);
    $('del-out').textContent = 'Running…';
    try {
      if (tab === 'spam') renderSpam($('del-out'), await api('/api/tools/spam-check', { method: 'POST', body: b }));
      else if (tab === 'links') renderLinks($('del-out'), await api('/api/tools/link-check', { method: 'POST', body: { html: b.html, text: b.text } }));
      else renderInbox($('del-out'), await api('/api/gmail/estimate-placement', { method: 'POST', body: b }));
    } catch (err) { $('del-out').textContent = err.message; }
  });

  $('probe-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const b = formBody(e.target);
    if (!b.id) return toast('Add a verified Gmail identity first', 'err');
    $('probe-out').textContent = 'Sending probe and waiting for IMAP…';
    try {
      const r = await api(`/api/gmail/${b.id}/placement-probe`, { method: 'POST', body: { to: b.to, wait_ms: 12000 } });
      $('probe-out').innerHTML = `<div class="card">${badge(r.check.placement)}
        <div class="muted small">Subject token ${esc(r.probe.token)} · folders ${esc((r.check.found.labels || []).join(', ') || 'not found yet')}</div>
        <pre>${esc(JSON.stringify(r.check, null, 2))}</pre></div>`;
    } catch (err) { $('probe-out').innerHTML = `<div class="issue high">${esc(err.message)}</div>`; }
  });
};

views.leads = async () => {
  view(`<div class="page-head"><h1>Lead validation</h1></div>
    <p class="sub">Debounce-style checks: syntax, typo domains, disposable, role accounts, and <b>MX records</b>. Scores 90–99 are MX-valid corporate addresses. SMTP mailbox probes are optional (need outbound port 25).</p>
    <form id="val-form" class="form-grid">
      <div class="field full"><label>Emails (one per line, or CSV with an email column)</label>
        <textarea name="text" rows="10" placeholder="alex@acme.com&#10;info@vendor.com"></textarea></div>
      <div class="field"><label>SMTP mailbox probe</label>
        <select name="smtp_probe"><option value="false">MX only (recommended)</option><option value="true">MX + SMTP RCPT (slow)</option></select></div>
      <div class="actions full"><button type="submit">Validate</button></div>
    </form>
    <div id="val-sum" class="cards"></div>
    <table id="val-table"></table>`);
  $('val-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const b = formBody(e.target);
    try {
      const r = await api('/api/tools/validate', { method: 'POST', body: { text: b.text, smtp_probe: b.smtp_probe === 'true' } });
      const s = r.summary;
      $('val-sum').innerHTML = [
        ['Total', s.total], ['Deliverable', s.deliverable], ['Risky', s.risky], ['Undeliverable', s.undeliverable],
      ].map(([l, n]) => `<div class="card"><div class="stat">${n}</div><div class="stat-label">${l}</div></div>`).join('');
      $('val-table').innerHTML = `<tr><th>Email</th><th>Score</th><th>Result</th><th>Why</th></tr>` +
        r.results.map((x) => `<tr>
          <td class="mono">${esc(x.email)}</td>
          <td><b>${x.score}</b></td>
          <td>${badge(x.result)}</td>
          <td class="small">${esc((x.reasons || []).join(' '))}</td>
        </tr>`).join('');
    } catch (err) { toast(err.message, 'err'); }
  });
};

views.lists = async () => {
  view(`<div class="page-head"><h1>Lists</h1></div>
    <p class="sub">Audience lists. New subscribers start pending unless you record existing consent on import.</p>
    <form id="list-form" class="row">
      <div class="field"><label>List name</label><input name="name" required placeholder="RFQ suppliers"></div>
      <div class="field" style="flex:1"><label>Description</label><input name="description"></div>
      <button type="submit">Create list</button>
    </form>
    <table id="list-table" style="margin-top:16px"></table>
    <div id="list-detail"></div>`);
  $('list-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const b = formBody(e.target);
    await api('/api/lists', { method: 'POST', body: b }); e.target.reset(); toast('List created'); views.lists();
  });
  const lists = await api('/api/lists');
  $('list-table').innerHTML = `<tr><th>Name</th><th>Confirmed</th><th>Pending</th><th></th></tr>` +
    (lists.map((l) => `<tr>
      <td><b>${esc(l.name)}</b><div class="muted small">${esc(l.description || '')}</div></td>
      <td>${l.confirmed}</td><td>${l.pending}</td>
      <td><button class="tiny secondary" data-open="${l.id}">Manage</button>
          <button class="tiny danger" data-del="${l.id}">Delete</button></td></tr>`).join('')
      || `<tr><td colspan="4" class="muted">No lists yet.</td></tr>`);
  $('list-table').querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Delete list and its subscriptions?')) return;
    await api(`/api/lists/${b.dataset.del}`, { method: 'DELETE' }); views.lists();
  }));
  $('list-table').querySelectorAll('[data-open]').forEach((b) =>
    b.addEventListener('click', () => openList(parseInt(b.dataset.open, 10), lists)));
};

async function openList(id, lists) {
  const list = lists.find((l) => l.id === id);
  const box = $('list-detail');
  box.innerHTML = `<h2>${esc(list.name)} — subscribers</h2>
    <form id="sub-form" class="row">
      <div class="field"><label>Email</label><input name="email" type="email" required></div>
      <div class="field"><label>First name</label><input name="first_name"></div>
      <div class="field"><label>Phone</label><input name="phone" placeholder="+15551234567"></div>
      <div class="field"><label>Company</label><input name="company"></div>
      <label class="field small"><span>&nbsp;</span><label><input type="checkbox" name="preConfirmed" style="width:auto"> Recorded consent / B2B lead</label></label>
      <button type="submit">Add subscriber</button>
    </form>
    <table id="sub-table"></table>`;
  $('sub-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const b = {
      email: fd.get('email'), first_name: fd.get('first_name') || '', phone: fd.get('phone') || '',
      company: fd.get('company') || '',
      preConfirmed: fd.get('preConfirmed') === 'on',
    };
    try {
      const r = await api(`/api/lists/${id}/subscribe`, { method: 'POST', body: b });
      e.target.reset();
      if (r.confirm_url) prompt('Send this confirmation link to the subscriber:', r.confirm_url);
      toast('Subscriber added'); openList(id, lists);
    } catch (err) { toast(err.message, 'err'); }
  });
  const subs = await api(`/api/lists/${id}/subscribers`);
  $('sub-table').innerHTML = `<tr><th>Email</th><th>Name</th><th>Company</th><th>MX</th><th>Status</th></tr>` +
    (subs.map((s) => `<tr><td>${esc(s.email)}</td><td>${esc(s.first_name || s.name || '')}</td>
      <td>${esc(s.company || '')}</td>
      <td>${s.validation_status ? badge(s.validation_status) : '—'}${s.validation_score != null ? ` ${s.validation_score}` : ''}</td>
      <td>${badge(s.status)}</td></tr>`).join('')
      || `<tr><td colspan="5" class="muted">No subscribers yet.</td></tr>`);
  box.scrollIntoView({ behavior: 'smooth' });
}

views.contacts = async () => {
  const lists = await api('/api/lists');
  view(`<div class="page-head"><h1>Contacts</h1></div>
    <p class="sub">Import CSV with headers: <span class="mono">email,first_name,last_name,company,title,phone</span></p>
    <form id="imp-form" class="form-grid">
      <div class="field full"><label>CSV</label><textarea name="csv" rows="6" placeholder="email,first_name,company&#10;alex@acme.com,Alex,Acme"></textarea></div>
      <div class="field"><label>Add to list</label><select name="list_id">
        <option value="">— contacts only —</option>
        ${lists.map((l) => `<option value="${l.id}">${esc(l.name)}</option>`).join('')}
      </select></div>
      <div class="field"><label>Consent</label><select name="preConfirmed"><option value="false">Pending confirm</option><option value="true">I have recorded consent / B2B basis</option></select></div>
      <div class="actions full"><button type="submit">Import</button></div>
    </form>
    <table id="c-table"></table>`);
  $('imp-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const b = formBody(e.target);
    try {
      const r = await api('/api/contacts/import', { method: 'POST', body: {
        csv: b.csv, list_id: b.list_id || null, preConfirmed: b.preConfirmed === 'true',
      }});
      toast(`Imported ${r.imported}`); views.contacts();
    } catch (err) { toast(err.message, 'err'); }
  });
  const rows = await api('/api/contacts');
  $('c-table').innerHTML = `<tr><th>Email</th><th>Name</th><th>Company</th><th>Validation</th><th></th></tr>` +
    (rows.map((c) => `<tr><td>${esc(c.email)}</td><td>${esc(c.first_name || c.name || '')}</td>
      <td>${esc(c.company || '')}</td>
      <td>${c.validation_status ? `${badge(c.validation_status)} ${c.validation_score ?? ''}` : '—'}</td>
      <td><button class="tiny danger" data-d="${c.id}">Delete</button></td></tr>`).join('')
      || `<tr><td colspan="5" class="muted">No contacts yet.</td></tr>`);
  $('c-table').querySelectorAll('[data-d]').forEach((b) => b.addEventListener('click', async () => {
    await api(`/api/contacts/${b.dataset.d}`, { method: 'DELETE' }); views.contacts();
  }));
};

views.senders = async () => {
  view(`<div class="page-head"><h1>SMTP sender identities</h1></div>
    <p class="sub">Non-Gmail SMTP (your own domain). For Gmail app passwords use <b>Gmail pool</b>.</p>
    <form id="sender-form" class="form-grid">
      <div class="field"><label>Label</label><input name="label" required placeholder="Marketing mailbox"></div>
      <div class="field"><label>From email</label><input name="from_email" type="email" required placeholder="hello@yourdomain.com"></div>
      <div class="field"><label>From name</label><input name="from_name" placeholder="Your Company"></div>
      <div class="field"><label>SMTP host</label><input name="host" required placeholder="smtp.yourprovider.com"></div>
      <div class="field"><label>Port</label><input name="port" type="number" value="587"></div>
      <div class="field"><label>Secure (TLS on connect)</label><select name="secure"><option value="false">No (STARTTLS)</option><option value="true">Yes (465)</option></select></div>
      <div class="field"><label>Username</label><input name="username" required></div>
      <div class="field"><label>Password</label><input name="password" type="password" required></div>
      <div class="actions full"><button type="submit">Add identity</button></div>
    </form>
    <table id="sender-table"></table>`);
  $('sender-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const b = formBody(e.target);
    b.secure = b.secure === 'true'; b.port = parseInt(b.port, 10);
    try { await api('/api/senders', { method: 'POST', body: b }); e.target.reset(); toast('Identity added'); views.senders(); }
    catch (err) { toast(err.message, 'err'); }
  });
  const rows = (await api('/api/senders')).filter((s) => s.kind !== 'gmail');
  $('sender-table').innerHTML = `<tr><th>Label</th><th>From</th><th>Host</th><th>Kind</th><th>Status</th><th></th></tr>` +
    (rows.map((s) => `<tr>
      <td>${esc(s.label)}</td><td>${esc(s.from_name)} &lt;${esc(s.from_email)}&gt;</td>
      <td class="mono small">${esc(s.host)}:${s.port}</td>
      <td>${esc(s.kind || 'smtp')}</td>
      <td>${s.verified ? badge('verified') : badge('pending')}</td>
      <td><button class="tiny secondary" data-v="${s.id}">Verify</button>
          <button class="tiny danger" data-d="${s.id}">Delete</button></td></tr>`).join('')
      || `<tr><td colspan="6" class="muted">No identities yet.</td></tr>`);
  $('sender-table').querySelectorAll('[data-v]').forEach((b) => b.addEventListener('click', async () => {
    try { await api(`/api/senders/${b.dataset.v}/verify`, { method: 'POST' }); toast('Verified ✓'); views.senders(); }
    catch (err) { toast(err.message, 'err'); }
  }));
  $('sender-table').querySelectorAll('[data-d]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Delete this identity?')) return;
    await api(`/api/senders/${b.dataset.d}`, { method: 'DELETE' }); views.senders();
  }));
};

views.suppressions = async () => {
  view(`<div class="page-head"><h1>Suppression list</h1></div>
    <p class="sub">Addresses here are never emailed — unsubscribes, complaints and bounces land here automatically.</p>
    <form id="sup-form" class="row">
      <div class="field"><label>Email</label><input name="email" type="email" required></div>
      <div class="field"><label>Reason</label><select name="reason"><option>manual</option><option>bounce</option><option>complaint</option></select></div>
      <button type="submit">Suppress</button>
    </form>
    <table id="sup-table" style="margin-top:16px"></table>`);
  $('sup-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    await api('/api/contacts/suppressions', { method: 'POST', body: formBody(e.target) });
    e.target.reset(); toast('Added'); views.suppressions();
  });
  const rows = await api('/api/contacts/suppressions');
  $('sup-table').innerHTML = `<tr><th>Email</th><th>Reason</th><th>Since</th><th></th></tr>` +
    (rows.map((s) => `<tr><td>${esc(s.email)}</td><td>${badge(s.reason)}</td>
      <td class="muted small">${esc((s.created_at || '').slice(0, 10))}</td>
      <td><button class="tiny secondary" data-d="${s.id}">Remove</button></td></tr>`).join('')
      || `<tr><td colspan="4" class="muted">Empty.</td></tr>`);
  $('sup-table').querySelectorAll('[data-d]').forEach((b) => b.addEventListener('click', async () => {
    await api(`/api/contacts/suppressions/${b.dataset.d}`, { method: 'DELETE' }); views.suppressions();
  }));
};

views.templates = async () => {
  view(`<div class="page-head"><h1>Templates</h1></div>
    <p class="sub">Reusable content. Use placeholders such as <code>{{first_name}}</code> and <code>{{company}}</code>.</p>
    ${placeholderChips(['first_name', 'company', 'rfq_item', 'sender_name'])}
    <form id="tpl-form" class="form-grid">
      <div class="field"><label>Name</label><input name="name" required></div>
      <div class="field"><label>Subject</label><input name="subject"></div>
      <div class="field full"><label>HTML</label><textarea name="html" rows="5"></textarea></div>
      <div class="field full"><label>Plain text</label><textarea name="text" rows="3"></textarea></div>
      <div class="actions full"><button type="submit">Save template</button></div>
    </form>
    <table id="tpl-table"></table>`);
  trackFocus($('tpl-form'));
  $('view').querySelectorAll('[data-ph]').forEach((b) => b.addEventListener('click', () => insertPlaceholder(b.dataset.ph)));
  $('tpl-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    await api('/api/templates', { method: 'POST', body: formBody(e.target) });
    e.target.reset(); toast('Saved'); views.templates();
  });
  const rows = await api('/api/templates');
  $('tpl-table').innerHTML = `<tr><th>Name</th><th>Subject</th><th></th></tr>` +
    (rows.map((t) => `<tr><td>${esc(t.name)}</td><td>${esc(t.subject || '')}</td>
      <td><button class="tiny danger" data-d="${t.id}">Delete</button></td></tr>`).join('')
      || `<tr><td colspan="3" class="muted">No templates yet.</td></tr>`);
  $('tpl-table').querySelectorAll('[data-d]').forEach((b) => b.addEventListener('click', async () => {
    await api(`/api/templates/${b.dataset.d}`, { method: 'DELETE' }); views.templates();
  }));
};

views.messages = async () => {
  view(`<div class="page-head"><h1>Message log</h1><button class="tiny secondary" id="refresh">Refresh</button></div>
    <p class="sub">Most recent 100 messages.</p><table id="m-table"></table>`);
  $('refresh').addEventListener('click', views.messages);
  const rows = await api('/api/messages');
  $('m-table').innerHTML = `<tr><th>To</th><th>Channel</th><th>Subject</th><th>Status</th><th>When</th></tr>` +
    (rows.map((m) => `<tr><td>${esc(m.to_address)}</td><td>${m.channel}</td>
      <td>${esc(m.subject || '')}${m.error ? `<div class="muted small">${esc(m.error)}</div>` : ''}</td>
      <td>${badge(m.status)}</td><td class="muted small">${esc((m.sent_at || m.created_at || '').replace('T', ' ').slice(0, 16))}</td></tr>`).join('')
      || `<tr><td colspan="5" class="muted">No messages yet.</td></tr>`);
};

views.apikeys = async () => {
  view(`<div class="page-head"><h1>API keys</h1></div>
    <p class="sub">Use these with the transactional API. Send with header <code>X-API-Key: &lt;key&gt;</code>.</p>
    <pre>curl -X POST ${location.origin}/api/v1/email \\
  -H "X-API-Key: YOUR_KEY" -H "Content-Type: application/json" \\
  -d '{"to":"user@example.com","subject":"Hi","html":"&lt;p&gt;Hello&lt;/p&gt;"}'

curl -X POST ${location.origin}/api/v1/sms \\
  -H "X-API-Key: YOUR_KEY" -H "Content-Type: application/json" \\
  -d '{"to":"+15551234567","body":"Quote request","provider_id":null}'</pre>
    <form id="key-form" class="row">
      <div class="field"><label>Key name</label><input name="name" required placeholder="Production app"></div>
      <button type="submit">Create key</button>
    </form>
    <table id="key-table" style="margin-top:16px"></table>`);
  $('key-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const r = await api('/api/apikeys', { method: 'POST', body: formBody(e.target) });
    e.target.reset();
    prompt('Copy your API key now — it will not be shown again:', r.key);
    views.apikeys();
  });
  const rows = await api('/api/apikeys');
  $('key-table').innerHTML = `<tr><th>Name</th><th>Prefix</th><th>Last used</th><th>Status</th><th></th></tr>` +
    (rows.map((k) => `<tr><td>${esc(k.name)}</td><td class="mono">${esc(k.key_prefix)}…</td>
      <td class="muted small">${esc(k.last_used || 'never')}</td>
      <td>${k.revoked ? badge('failed') : badge('confirmed')}</td>
      <td>${k.revoked ? '' : `<button class="tiny danger" data-r="${k.id}">Revoke</button>`}</td></tr>`).join('')
      || `<tr><td colspan="5" class="muted">No keys yet.</td></tr>`);
  $('key-table').querySelectorAll('[data-r]').forEach((b) => b.addEventListener('click', async () => {
    await api(`/api/apikeys/${b.dataset.r}/revoke`, { method: 'POST' }); views.apikeys();
  }));
};

views.account = async () => {
  view(`<div class="page-head"><h1>Account</h1></div>
    <p class="sub">${esc(state.user.email)} · role ${esc(state.user.role)}</p>
    <h2>Sending profile</h2>
    <form id="prof-form" class="form-grid" style="max-width:640px">
      <div class="field full"><label>Company name</label><input name="company_name" value="${esc(state.user.company_name || '')}"></div>
      <div class="field full"><label>Your title</label><input name="sender_title" value="${esc(state.user.sender_title || '')}"></div>
      <div class="field full"><label>Physical mailing address (CAN-SPAM)</label><input name="physical_address" value="${esc(state.user.physical_address || '')}" placeholder="123 Market St, Suite 400, Austin, TX 78701"></div>
      <div class="actions full"><button type="submit">Save profile</button></div>
    </form>
    <h2>Change password</h2>
    <form id="pw-form" class="form-grid" style="max-width:520px">
      <div class="field full"><label>Current password</label><input name="current" type="password" required></div>
      <div class="field full"><label>New password (min 8)</label><input name="next" type="password" required></div>
      <div class="actions full"><button type="submit">Update password</button></div>
    </form>`);
  $('prof-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const b = formBody(e.target);
      await api('/api/auth/profile', { method: 'POST', body: b });
      state.user = { ...state.user, ...b };
      toast('Profile saved');
    } catch (err) { toast(err.message, 'err'); }
  });
  $('pw-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api('/api/auth/change-password', { method: 'POST', body: formBody(e.target) });
      e.target.reset(); toast('Password updated'); }
    catch (err) { toast(err.message, 'err'); }
  });
};

views.users = async () => {
  view(`<div class="page-head"><h1>Users</h1></div><p class="sub">Admin-only user management.</p>
    <form id="u-form" class="form-grid" style="max-width:640px">
      <div class="field"><label>Email</label><input name="email" type="email" required></div>
      <div class="field"><label>Password</label><input name="password" type="password" required></div>
      <div class="field"><label>Role</label><select name="role"><option>user</option><option>admin</option></select></div>
      <div class="field"><label>Daily quota</label><input name="daily_quota" type="number" value="1000"></div>
      <div class="actions full"><button type="submit">Create user</button></div>
    </form>
    <table id="u-table"></table>`);
  $('u-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const b = formBody(e.target); b.daily_quota = parseInt(b.daily_quota, 10);
    try { await api('/api/users', { method: 'POST', body: b }); e.target.reset(); toast('User created'); views.users(); }
    catch (err) { toast(err.message, 'err'); }
  });
  const rows = await api('/api/users');
  $('u-table').innerHTML = `<tr><th>Email</th><th>Role</th><th>Quota/day</th><th>Active</th><th></th></tr>` +
    (rows.map((u) => `<tr><td>${esc(u.email)}</td><td>${badge(u.role === 'admin' ? 'verified' : 'pending')} ${u.role}</td>
      <td>${u.daily_quota}</td><td>${u.active ? '✓' : '—'}</td>
      <td>${u.id !== state.user.id ? `<button class="tiny secondary" data-t="${u.id}" data-a="${u.active}">${u.active ? 'Disable' : 'Enable'}</button>
        <button class="tiny danger" data-d="${u.id}">Delete</button>` : '<span class="muted small">you</span>'}</td></tr>`).join(''));
  $('u-table').querySelectorAll('[data-t]').forEach((b) => b.addEventListener('click', async () => {
    await api(`/api/users/${b.dataset.t}`, { method: 'PATCH', body: { active: b.dataset.a === '0' } }); views.users();
  }));
  $('u-table').querySelectorAll('[data-d]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Delete this user and all their data?')) return;
    await api(`/api/users/${b.dataset.d}`, { method: 'DELETE' }); views.users();
  }));
};

(async () => {
  if (state.token) { try { await boot(); return; } catch { /* fall through */ } }
  $('login').classList.remove('hidden');
})();
