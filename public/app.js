// ---- Freedom Mailer admin panel (vanilla SPA) ----
const state = { token: localStorage.getItem('fm_token') || null, user: null, route: 'dashboard' };

const $ = (id) => document.getElementById(id);
const el = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstChild; };
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

// ---- Auth ----
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
  ['dashboard', '📊 Dashboard'],
  ['senders', '📮 Sender identities'],
  ['lists', '📋 Lists'],
  ['contacts', '👥 Contacts'],
  ['suppressions', '🚫 Suppressions'],
  ['templates', '📝 Templates'],
  ['campaigns', '🚀 Campaigns'],
  ['messages', '📨 Message log'],
  ['apikeys', '🔑 API keys'],
  ['account', '⚙️ Account'],
];
const ADMIN_NAV = [['users', '🛡️ Users (admin)']];

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

// ---- Views ----
const views = {};
const view = (html) => { $('view').innerHTML = html; };
const badge = (status) => {
  const map = { sent: 'ok', confirmed: 'ok', verified: 'ok', queued: 'warn', pending: 'warn',
    sending: 'warn', draft: 'muted', failed: 'err', skipped: 'muted', unsubscribed: 'muted' };
  return `<span class="badge ${map[status] || 'muted'}">${status}</span>`;
};

views.dashboard = async () => {
  view(`<div class="page-head"><div><h1>Dashboard</h1></div></div>
    <p class="sub">Overview of your sending activity.</p><div id="d-cards" class="cards"></div>`);
  const s = await api('/api/stats');
  const card = (n, label) => `<div class="card"><div class="stat">${n}</div><div class="stat-label">${label}</div></div>`;
  $('d-cards').innerHTML = [
    card(s.confirmed, 'Confirmed subscribers'), card(s.contacts, 'Contacts'),
    card(s.lists, 'Lists'), card(s.campaigns, 'Campaigns'),
    card(s.sent, 'Messages sent'), card(s.queued, 'In queue'),
    card(s.failed, 'Failed'), card(s.suppressed, 'Suppressed'),
    card(s.sms_enabled ? 'On' : 'Off', 'SMS channel'),
  ].join('');
};

views.senders = async () => {
  view(`<div class="page-head"><h1>Sender identities</h1></div>
    <p class="sub">Add SMTP credentials for a mailbox or domain <b>you own</b>. Each identity must be verified before it can send.</p>
    <div class="notice">Use real credentials from your own mail provider. Set up SPF, DKIM and DMARC on the sending domain for good deliverability.</div>
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
    const f = e.target; const b = Object.fromEntries(new FormData(f));
    b.secure = b.secure === 'true'; b.port = parseInt(b.port, 10);
    try { await api('/api/senders', { method: 'POST', body: b }); f.reset(); toast('Identity added'); views.senders(); }
    catch (err) { toast(err.message, 'err'); }
  });
  const rows = await api('/api/senders');
  $('sender-table').innerHTML = `<tr><th>Label</th><th>From</th><th>Host</th><th>Status</th><th></th></tr>` +
    (rows.map((s) => `<tr>
      <td>${esc(s.label)}</td><td>${esc(s.from_name)} &lt;${esc(s.from_email)}&gt;</td>
      <td class="mono small">${esc(s.host)}:${s.port}</td>
      <td>${s.verified ? badge('verified') : badge('pending')}</td>
      <td><button class="tiny secondary" data-v="${s.id}">Verify</button>
          <button class="tiny danger" data-d="${s.id}">Delete</button></td></tr>`).join('')
      || `<tr><td colspan="5" class="muted">No identities yet.</td></tr>`);
  $('sender-table').querySelectorAll('[data-v]').forEach((b) => b.addEventListener('click', async () => {
    try { await api(`/api/senders/${b.dataset.v}/verify`, { method: 'POST' }); toast('Verified ✓'); views.senders(); }
    catch (err) { toast(err.message, 'err'); }
  }));
  $('sender-table').querySelectorAll('[data-d]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Delete this identity?')) return;
    await api(`/api/senders/${b.dataset.d}`, { method: 'DELETE' }); views.senders();
  }));
};

views.lists = async () => {
  view(`<div class="page-head"><h1>Lists</h1></div>
    <p class="sub">Audience lists use <b>double opt-in</b>: new subscribers must confirm before campaigns can reach them.</p>
    <form id="list-form" class="row">
      <div class="field"><label>List name</label><input name="name" required placeholder="Newsletter"></div>
      <div class="field" style="flex:1"><label>Description</label><input name="description"></div>
      <button type="submit">Create list</button>
    </form>
    <table id="list-table" style="margin-top:16px"></table>
    <div id="list-detail"></div>`);
  $('list-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const b = Object.fromEntries(new FormData(e.target));
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
      <div class="field"><label>Name</label><input name="name"></div>
      <label class="field small"><span>&nbsp;</span><label><input type="checkbox" name="preConfirmed" style="width:auto"> Already have recorded consent</label></label>
      <button type="submit">Add subscriber</button>
    </form>
    <div class="notice">Adding a subscriber creates a <b>pending</b> confirmation. Send them the returned confirm link (or your own signup flow calls this). Only tick "recorded consent" if you already hold proof of opt-in.</div>
    <table id="sub-table"></table>`;
  $('sub-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const b = { email: fd.get('email'), name: fd.get('name') || '', preConfirmed: fd.get('preConfirmed') === 'on' };
    try {
      const r = await api(`/api/lists/${id}/subscribe`, { method: 'POST', body: b });
      e.target.reset();
      if (r.confirm_url) { prompt('Send this confirmation link to the subscriber:', r.confirm_url); }
      toast('Subscriber added'); openList(id, lists);
    } catch (err) { toast(err.message, 'err'); }
  });
  const subs = await api(`/api/lists/${id}/subscribers`);
  $('sub-table').innerHTML = `<tr><th>Email</th><th>Name</th><th>Status</th><th>Since</th></tr>` +
    (subs.map((s) => `<tr><td>${esc(s.email)}</td><td>${esc(s.name || '')}</td>
      <td>${badge(s.status)}</td><td class="muted small">${esc((s.created_at || '').slice(0, 10))}</td></tr>`).join('')
      || `<tr><td colspan="4" class="muted">No subscribers yet.</td></tr>`);
  box.scrollIntoView({ behavior: 'smooth' });
}

views.contacts = async () => {
  view(`<div class="page-head"><h1>Contacts</h1></div><p class="sub">Everyone in your account.</p><table id="c-table"></table>`);
  const rows = await api('/api/contacts');
  $('c-table').innerHTML = `<tr><th>Email</th><th>Name</th><th>Phone</th><th></th></tr>` +
    (rows.map((c) => `<tr><td>${esc(c.email)}</td><td>${esc(c.name || '')}</td><td>${esc(c.phone || '')}</td>
      <td><button class="tiny danger" data-d="${c.id}">Delete</button></td></tr>`).join('')
      || `<tr><td colspan="4" class="muted">No contacts yet.</td></tr>`);
  $('c-table').querySelectorAll('[data-d]').forEach((b) => b.addEventListener('click', async () => {
    await api(`/api/contacts/${b.dataset.d}`, { method: 'DELETE' }); views.contacts();
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
    await api('/api/contacts/suppressions', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
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
    <p class="sub">Reusable content. Use <code>{{name}}</code> and <code>{{email}}</code> merge fields.</p>
    <form id="tpl-form" class="form-grid">
      <div class="field"><label>Name</label><input name="name" required></div>
      <div class="field"><label>Subject</label><input name="subject"></div>
      <div class="field full"><label>HTML</label><textarea name="html" rows="5"></textarea></div>
      <div class="field full"><label>Plain text</label><textarea name="text" rows="3"></textarea></div>
      <div class="actions full"><button type="submit">Save template</button></div>
    </form>
    <table id="tpl-table"></table>`);
  $('tpl-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    await api('/api/templates', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
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

views.campaigns = async () => {
  const [senders, lists] = await Promise.all([api('/api/senders'), api('/api/lists')]);
  view(`<div class="page-head"><h1>Campaigns</h1></div>
    <p class="sub">Send to <b>confirmed</b> subscribers of a list. Suppressed addresses are skipped; an unsubscribe footer is added automatically.</p>
    <form id="camp-form" class="form-grid">
      <div class="field"><label>Name</label><input name="name" required></div>
      <div class="field"><label>Subject</label><input name="subject" required></div>
      <div class="field"><label>Sender identity</label><select name="sender_id">
        <option value="">— system default —</option>
        ${senders.map((s) => `<option value="${s.id}" ${s.verified ? '' : 'disabled'}>${esc(s.label)}${s.verified ? '' : ' (unverified)'}</option>`).join('')}
      </select></div>
      <div class="field"><label>List</label><select name="list_id" required>
        <option value="">— choose —</option>
        ${lists.map((l) => `<option value="${l.id}">${esc(l.name)} (${l.confirmed} confirmed)</option>`).join('')}
      </select></div>
      <div class="field full"><label>HTML body</label><textarea name="html" rows="6" placeholder="<p>Hi {{name}}…</p>"></textarea></div>
      <div class="field full"><label>Plain text</label><textarea name="text" rows="3"></textarea></div>
      <div class="actions full"><button type="submit">Save draft</button></div>
    </form>
    <table id="camp-table"></table>`);
  $('camp-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const b = Object.fromEntries(new FormData(e.target));
    b.sender_id = b.sender_id || null; b.list_id = parseInt(b.list_id, 10);
    await api('/api/campaigns', { method: 'POST', body: b }); e.target.reset(); toast('Draft saved'); views.campaigns();
  });
  const rows = await api('/api/campaigns');
  $('camp-table').innerHTML = `<tr><th>Name</th><th>List</th><th>Status</th><th>Sent</th><th></th></tr>` +
    (rows.map((c) => `<tr>
      <td><b>${esc(c.name)}</b><div class="muted small">${esc(c.subject || '')}</div></td>
      <td>${esc(c.list_name || '—')}</td><td>${badge(c.status)}</td>
      <td>${c.sent}/${c.total}${c.failed ? ` <span class="badge err">${c.failed} failed</span>` : ''}</td>
      <td>${c.status === 'draft'
        ? `<button class="tiny" data-send="${c.id}">Send</button> <button class="tiny danger" data-del="${c.id}">Delete</button>`
        : `<span class="muted small">—</span>`}</td></tr>`).join('')
      || `<tr><td colspan="5" class="muted">No campaigns yet.</td></tr>`);
  $('camp-table').querySelectorAll('[data-send]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Queue this campaign for sending to all confirmed subscribers?')) return;
    try {
      const r = await api(`/api/campaigns/${b.dataset.send}/send`, { method: 'POST' });
      toast(`Queued ${r.queued} · skipped ${r.skipped}`); views.campaigns();
    } catch (err) { toast(err.message, 'err'); }
  }));
  $('camp-table').querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    await api(`/api/campaigns/${b.dataset.del}`, { method: 'DELETE' }); views.campaigns();
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
  -d '{"to":"user@example.com","subject":"Hi","html":"&lt;p&gt;Hello&lt;/p&gt;"}'</pre>
    <form id="key-form" class="row">
      <div class="field"><label>Key name</label><input name="name" required placeholder="Production app"></div>
      <button type="submit">Create key</button>
    </form>
    <table id="key-table" style="margin-top:16px"></table>`);
  $('key-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const r = await api('/api/apikeys', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
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
    <h2>Change password</h2>
    <form id="pw-form" class="form-grid" style="max-width:520px">
      <div class="field full"><label>Current password</label><input name="current" type="password" required></div>
      <div class="field full"><label>New password (min 8)</label><input name="next" type="password" required></div>
      <div class="actions full"><button type="submit">Update password</button></div>
    </form>`);
  $('pw-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api('/api/auth/change-password', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
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
    const b = Object.fromEntries(new FormData(e.target)); b.daily_quota = parseInt(b.daily_quota, 10);
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

// ---- Start ----
(async () => {
  if (state.token) { try { await boot(); return; } catch { /* fall through */ } }
  $('login').classList.remove('hidden');
})();
