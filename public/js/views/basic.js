import { api, $, esc, view, badge, toast, state, fmtDate } from '../core.js';

export const basicViews = {};

basicViews.lists = async () => {
  view(`<div class="page-head"><h1>Opt-in lists</h1></div>
    <p class="sub">Audience lists use <b>double opt-in</b>: new subscribers must confirm before campaigns can
      reach them. For contacts who have not opted in, use <b>Leads</b> instead.</p>
    <form id="list-form" class="row">
      <div class="field"><label>List name</label><input name="name" required placeholder="Newsletter"></div>
      <div class="field" style="flex:1"><label>Description</label><input name="description"></div>
      <button type="submit">Create list</button>
    </form>
    <table id="list-table" style="margin-top:16px"></table>
    <div id="list-detail"></div>`);

  $('list-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    await api('/api/lists', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
    e.target.reset();
    toast('List created');
    basicViews.lists();
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
    await api(`/api/lists/${b.dataset.del}`, { method: 'DELETE' });
    basicViews.lists();
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
      if (r.confirm_url) prompt('Send this confirmation link to the subscriber:', r.confirm_url);
      toast('Subscriber added');
      openList(id, lists);
    } catch (err) {
      toast(err.message, 'err');
    }
  });

  const subs = await api(`/api/lists/${id}/subscribers`);
  $('sub-table').innerHTML = `<tr><th>Email</th><th>Name</th><th>Status</th><th>Since</th></tr>` +
    (subs.map((s) => `<tr><td>${esc(s.email)}</td><td>${esc(s.name || '')}</td>
      <td>${badge(s.status)}</td><td class="muted small">${esc((s.created_at || '').slice(0, 10))}</td></tr>`).join('')
      || `<tr><td colspan="4" class="muted">No subscribers yet.</td></tr>`);
  box.scrollIntoView({ behavior: 'smooth' });
}

basicViews.contacts = async () => {
  view(`<div class="page-head"><h1>Contacts</h1></div><p class="sub">Everyone in your account.</p><table id="c-table"></table>`);
  const rows = await api('/api/contacts');
  $('c-table').innerHTML = `<tr><th>Email</th><th>Name</th><th>Phone</th><th></th></tr>` +
    (rows.map((c) => `<tr><td>${esc(c.email)}</td><td>${esc(c.name || '')}</td><td>${esc(c.phone || '')}</td>
      <td><button class="tiny danger" data-d="${c.id}">Delete</button></td></tr>`).join('')
      || `<tr><td colspan="4" class="muted">No contacts yet.</td></tr>`);
  $('c-table').querySelectorAll('[data-d]').forEach((b) => b.addEventListener('click', async () => {
    await api(`/api/contacts/${b.dataset.d}`, { method: 'DELETE' });
    basicViews.contacts();
  }));
};

basicViews.suppressions = async () => {
  view(`<div class="page-head"><h1>Suppression list</h1></div>
    <p class="sub">Addresses here are never emailed — unsubscribes, complaints and bounces land here automatically,
      across every list and campaign.</p>
    <form id="sup-form" class="row">
      <div class="field"><label>Email</label><input name="email" type="email" required></div>
      <div class="field"><label>Reason</label><select name="reason"><option>manual</option><option>bounce</option><option>complaint</option></select></div>
      <button type="submit">Suppress</button>
    </form>
    <table id="sup-table" style="margin-top:16px"></table>`);

  $('sup-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    await api('/api/contacts/suppressions', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
    e.target.reset();
    toast('Added');
    basicViews.suppressions();
  });

  const rows = await api('/api/contacts/suppressions');
  $('sup-table').innerHTML = `<tr><th>Email</th><th>Reason</th><th>Since</th><th></th></tr>` +
    (rows.map((s) => `<tr><td>${esc(s.email)}</td><td>${badge(s.reason)}</td>
      <td class="muted small">${esc((s.created_at || '').slice(0, 10))}</td>
      <td><button class="tiny secondary" data-d="${s.id}">Remove</button></td></tr>`).join('')
      || `<tr><td colspan="4" class="muted">Empty.</td></tr>`);
  $('sup-table').querySelectorAll('[data-d]').forEach((b) => b.addEventListener('click', async () => {
    await api(`/api/contacts/suppressions/${b.dataset.d}`, { method: 'DELETE' });
    basicViews.suppressions();
  }));
};

basicViews.templates = async () => {
  view(`<div class="page-head"><h1>Templates</h1></div>
    <p class="sub">Reusable content. Merge fields support fallbacks: <code>{{first_name|there}}</code>.</p>
    <form id="tpl-form" class="form-grid">
      <div class="field"><label>Name</label><input name="name" required></div>
      <div class="field"><label>Subject</label><input name="subject"></div>
      <div class="field full"><label>HTML</label><textarea name="html" rows="5" class="mono"></textarea></div>
      <div class="field full"><label>Plain text</label><textarea name="text" rows="3" class="mono"></textarea></div>
      <div class="actions full"><button type="submit">Save template</button></div>
    </form>
    <table id="tpl-table"></table>`);

  $('tpl-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    await api('/api/templates', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
    e.target.reset();
    toast('Saved');
    basicViews.templates();
  });

  const rows = await api('/api/templates');
  $('tpl-table').innerHTML = `<tr><th>Name</th><th>Subject</th><th></th></tr>` +
    (rows.map((t) => `<tr><td>${esc(t.name)}</td><td>${esc(t.subject || '')}</td>
      <td><button class="tiny danger" data-d="${t.id}">Delete</button></td></tr>`).join('')
      || `<tr><td colspan="3" class="muted">No templates yet.</td></tr>`);
  $('tpl-table').querySelectorAll('[data-d]').forEach((b) => b.addEventListener('click', async () => {
    await api(`/api/templates/${b.dataset.d}`, { method: 'DELETE' });
    basicViews.templates();
  }));
};

basicViews.messages = async () => {
  view(`<div class="page-head"><h1>Message log</h1><button class="tiny secondary" id="refresh">Refresh</button></div>
    <p class="sub">Most recent 100 messages.</p><table id="m-table"></table>`);
  $('refresh').addEventListener('click', basicViews.messages);

  const rows = await api('/api/messages');
  $('m-table').innerHTML = `<tr><th>To</th><th>Sent from</th><th>Subject</th><th>Status</th><th>When</th></tr>` +
    (rows.map((m) => `<tr><td>${esc(m.to_address)}</td>
      <td class="small muted mono">${esc(m.mailbox || m.channel)}</td>
      <td>${esc(m.subject || '')}${m.error ? `<div class="err-text small">${esc(m.error)}</div>` : ''}</td>
      <td>${badge(m.status)}</td>
      <td class="muted small">${fmtDate(m.sent_at || m.not_before || m.created_at)}</td></tr>`).join('')
      || `<tr><td colspan="5" class="muted">No messages yet.</td></tr>`);
};

basicViews.apikeys = async () => {
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
    basicViews.apikeys();
  });

  const rows = await api('/api/apikeys');
  $('key-table').innerHTML = `<tr><th>Name</th><th>Prefix</th><th>Last used</th><th>Status</th><th></th></tr>` +
    (rows.map((k) => `<tr><td>${esc(k.name)}</td><td class="mono">${esc(k.key_prefix)}…</td>
      <td class="muted small">${esc(k.last_used || 'never')}</td>
      <td>${k.revoked ? badge('failed') : badge('confirmed')}</td>
      <td>${k.revoked ? '' : `<button class="tiny danger" data-r="${k.id}">Revoke</button>`}</td></tr>`).join('')
      || `<tr><td colspan="5" class="muted">No keys yet.</td></tr>`);
  $('key-table').querySelectorAll('[data-r]').forEach((b) => b.addEventListener('click', async () => {
    await api(`/api/apikeys/${b.dataset.r}/revoke`, { method: 'POST' });
    basicViews.apikeys();
  }));
};

basicViews.senders = async () => {
  view(`<div class="page-head"><h1>Sender identities</h1></div>
    <p class="sub">Standalone SMTP credentials, kept for the transactional API and opt-in campaigns. For cold
      outreach use the <b>Sending pool</b>, which adds quota tracking and rotation.</p>
    <form id="sender-form" class="form-grid">
      <div class="field"><label>Label</label><input name="label" required placeholder="Marketing mailbox"></div>
      <div class="field"><label>From email</label><input name="from_email" type="email" required></div>
      <div class="field"><label>From name</label><input name="from_name"></div>
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
    const b = Object.fromEntries(new FormData(e.target));
    b.secure = b.secure === 'true';
    b.port = parseInt(b.port, 10);
    try {
      await api('/api/senders', { method: 'POST', body: b });
      e.target.reset();
      toast('Identity added');
      basicViews.senders();
    } catch (err) {
      toast(err.message, 'err');
    }
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
    try {
      await api(`/api/senders/${b.dataset.v}/verify`, { method: 'POST' });
      toast('Verified');
      basicViews.senders();
    } catch (err) {
      toast(err.message, 'err');
    }
  }));
  $('sender-table').querySelectorAll('[data-d]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Delete this identity?')) return;
    await api(`/api/senders/${b.dataset.d}`, { method: 'DELETE' });
    basicViews.senders();
  }));
};

basicViews.account = async () => {
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
    try {
      await api('/api/auth/change-password', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
      e.target.reset();
      toast('Password updated');
    } catch (err) {
      toast(err.message, 'err');
    }
  });
};

basicViews.users = async () => {
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
    const b = Object.fromEntries(new FormData(e.target));
    b.daily_quota = parseInt(b.daily_quota, 10);
    try {
      await api('/api/users', { method: 'POST', body: b });
      e.target.reset();
      toast('User created');
      basicViews.users();
    } catch (err) {
      toast(err.message, 'err');
    }
  });

  const rows = await api('/api/users');
  $('u-table').innerHTML = `<tr><th>Email</th><th>Role</th><th>Quota/day</th><th>Active</th><th></th></tr>` +
    rows.map((u) => `<tr><td>${esc(u.email)}</td><td>${badge(u.role === 'admin' ? 'verified' : 'pending')} ${u.role}</td>
      <td>${u.daily_quota}</td><td>${u.active ? '✓' : '—'}</td>
      <td>${u.id !== state.user.id ? `<button class="tiny secondary" data-t="${u.id}" data-a="${u.active}">${u.active ? 'Disable' : 'Enable'}</button>
        <button class="tiny danger" data-d="${u.id}">Delete</button>` : '<span class="muted small">you</span>'}</td></tr>`).join('');

  $('u-table').querySelectorAll('[data-t]').forEach((b) => b.addEventListener('click', async () => {
    await api(`/api/users/${b.dataset.t}`, { method: 'PATCH', body: { active: b.dataset.a === '0' } });
    basicViews.users();
  }));
  $('u-table').querySelectorAll('[data-d]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Delete this user and all their data?')) return;
    await api(`/api/users/${b.dataset.d}`, { method: 'DELETE' });
    basicViews.users();
  }));
};
