// Freedom Mailer panel
const state = { token: localStorage.getItem('fm_token') || null, user: null, route: 'compose' };
let o365Selected = null;
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
  setTimeout(() => t.classList.add('hidden'), 3600);
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
  ['compose', '✍️ Compose'],
  ['dashboard', '📊 Dashboard'],
  ['office365', '🏢 Office 365'],
  ['senders', '📮 Senders'],
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
  $('nav').querySelectorAll('a').forEach((a) => a.addEventListener('click', () => go(a.dataset.route)));
  $('who').textContent = `${state.user.email} · ${state.user.role}`;
}

function go(route) { state.route = route; renderNav(); views[route](); }

async function boot() {
  state.user = await api('/api/auth/me');
  $('login').classList.add('hidden'); $('app').classList.remove('hidden');
  renderNav(); go('compose');
}

const views = {};
const view = (html) => { $('view').innerHTML = html; };
const badge = (status) => {
  const map = {
    sent: 'ok', confirmed: 'ok', verified: 'ok', queued: 'warn', pending: 'warn',
    sending: 'warn', draft: 'muted', failed: 'err', skipped: 'muted', unsubscribed: 'muted',
    smtp: 'muted', ovh: 'ok', webmail: 'warn', japan: 'ok', smtp_sms: 'warn',
    office365: 'ok', graph: 'ok', smtp_auth: 'warn',
  };
  return `<span class="badge ${map[status] || 'muted'}">${esc(status)}</span>`;
};

function insertAt(id, text) {
  const el = $(id);
  if (!el) return;
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? el.value.length;
  el.value = el.value.slice(0, start) + text + el.value.slice(end);
  el.focus();
  el.selectionStart = el.selectionEnd = start + text.length;
  el.dispatchEvent(new Event('input'));
}

views.dashboard = async () => {
  view(`<div class="page-head"><div><h1>Dashboard</h1></div>
    <button class="secondary" id="go-compose">New compose</button></div>
    <p class="sub">Sending activity for this account.</p><div id="d-cards" class="cards"></div>`);
  $('go-compose').addEventListener('click', () => go('compose'));
  const s = await api('/api/stats');
  const card = (n, label) => `<div class="card"><div class="stat">${n}</div><div class="stat-label">${label}</div></div>`;
  $('d-cards').innerHTML = [
    card(s.confirmed, 'Confirmed subscribers'), card(s.contacts, 'Contacts'),
    card(s.lists, 'Lists'), card(s.campaigns, 'Campaigns'),
    card(s.sent, 'Messages sent'), card(s.queued, 'In queue'),
    card(s.failed, 'Failed'),     card(s.suppressed, 'Suppressed'),
    card(s.office_tenants || 0, 'Office 365 tenants'),
    card(s.sms_enabled ? 'On' : 'Off', 'Twilio SMS'),
    card(s.ai_enabled ? 'On' : 'Local', 'AI help'),
  ].join('');
};

views.compose = async () => {
  const [senders, letters, ai, lists] = await Promise.all([
    api('/api/senders'),
    api('/api/letters'),
    api('/api/ai/status'),
    api('/api/lists'),
  ]);
  const verified = senders.filter((s) => s.verified);
  view(`<div class="page-head"><h1>Compose &amp; send</h1></div>
    <p class="sub">Paste recipients, pick a letter, merge placeholders, then queue the send from a verified identity you own.</p>
    <div class="compose">
      <div>
        <form id="compose-form">
          <div class="form-grid">
            <div class="field"><label>Campaign name</label><input id="c-name" placeholder="August invoice batch"></div>
            <div class="field"><label>Sender</label>
              <select id="c-sender">
                <option value="">— system default —</option>
                ${verified.map((s) => `<option value="${s.id}" data-kind="${esc(s.kind)}">${esc(s.label)} · ${esc(s.kind)}</option>`).join('')}
                ${senders.filter((s) => !s.verified).map((s) => `<option value="" disabled>${esc(s.label)} (unverified)</option>`).join('')}
              </select>
            </div>
            <div class="field full"><label>Subject</label><input id="c-subject" placeholder="Invoice {{invoice_number}} for {{company}}"></div>
          </div>

          <h2>Recipients — paste, don’t upload</h2>
          <p class="muted small">One per line. <code>email</code>, <code>Name &lt;email&gt;</code>, or <code>email, name, phone, company</code>. Optional header row.</p>
          <textarea id="c-leads" rows="8" placeholder="email, name, phone, company
alex@example.com, Alex Rivera, +1 555 0100, Northwind
Jane Doe <jane@example.com>"></textarea>
          <div class="actions" style="margin:8px 0 4px">
            <button type="button" class="secondary tiny" id="c-parse">Parse paste</button>
            <span id="c-parse-count" class="muted small"></span>
          </div>
          <div id="c-parse-box" class="parse-box hidden"></div>

          <h2>HTML letters</h2>
          <p class="muted small">These are <b>your</b> company notices (sign, invoice, file share, meeting). They are not third-party brand clones.</p>
          <div id="letter-grid" class="letter-grid"></div>
          <div id="letter-fields" class="form-grid"></div>
          <div class="actions">
            <button type="button" class="secondary" id="c-gen" disabled>Generate letter</button>
            <select id="c-locale" style="max-width:140px"><option value="en">English</option><option value="ja">日本語</option></select>
          </div>

          <h2>Body</h2>
          <div class="chips" id="ph-chips"></div>
          <div class="field full" style="margin-top:10px"><label>HTML</label><textarea id="c-html" rows="10" placeholder="<p>Hi {{first_name|there}}…</p>"></textarea></div>
          <div class="field full"><label>Plain text</label><textarea id="c-text" rows="4"></textarea></div>

          <div class="ai-box">
            <h2 style="margin-top:0">AI help</h2>
            <p class="muted small">${ai.enabled ? 'Model connected. Rewrite, translate, or draft from a prompt.' : 'No API key — local help can generate letters and plain text. Set OPENAI_API_KEY for full rewrites.'}</p>
            <div class="form-grid">
              <div class="field"><label>Action</label>
                <select id="ai-action">
                  <option value="rewrite">Rewrite</option>
                  <option value="compose">Compose from prompt</option>
                  <option value="translate">Translate</option>
                  <option value="shorten">Shorten</option>
                  <option value="subject">Suggest subject</option>
                  <option value="text">HTML → plain text</option>
                  <option value="placeholders">Explain placeholders</option>
                </select>
              </div>
              <div class="field"><label>Language</label>
                <select id="ai-lang"><option value="en">English</option><option value="ja">日本語</option></select>
              </div>
              <div class="field full"><label>Prompt</label><textarea id="ai-prompt" rows="2" placeholder="Make this warmer. Keep {{first_name}} and the pay button."></textarea></div>
            </div>
            <button type="button" class="secondary" id="ai-run">Run AI help</button>
            <div id="ai-notes" class="muted small" style="margin-top:8px"></div>
          </div>

          <div class="field"><label>Save onto list (optional)</label>
            <select id="c-list">
              <option value="">Create a new list from this paste</option>
              ${lists.map((l) => `<option value="${l.id}">${esc(l.name)}</option>`).join('')}
            </select>
          </div>
          <label class="check" style="margin:14px 0">
            <input type="checkbox" id="c-consent">
            <span>I confirm these people asked to hear from my organization. I will not impersonate another brand, and I understand unsubscribes are honored automatically.</span>
          </label>
          <div class="actions">
            <button type="submit">Queue send</button>
            <button type="button" class="secondary" id="c-save-tpl">Save as template</button>
            <button type="button" class="secondary" id="c-preview-btn">Refresh preview</button>
          </div>
        </form>
      </div>
      <div class="preview-wrap">
        <header><span>Live preview</span><span class="small" id="pv-count"></span></header>
        <div class="preview-meta" id="pv-subject">Subject —</div>
        <iframe id="pv-frame" class="preview-frame" sandbox="allow-same-origin" title="Email preview"></iframe>
      </div>
    </div>`);

  let selectedKind = '';
  const letterMap = Object.fromEntries(letters.letters.map((l) => [l.id, l]));
  $('letter-grid').innerHTML = letters.letters.map((l) =>
    `<button type="button" class="letter-card" data-kind="${l.id}">
      <b>${esc(l.title)}</b><span>${esc(l.blurb)}</span></button>`
  ).join('');
  $('ph-chips').innerHTML = letters.placeholders.map((p) =>
    `<button type="button" class="chip" data-ph="{{${p.key}}}">${p.key}</button>`
  ).join('');

  $('ph-chips').querySelectorAll('.chip').forEach((b) => b.addEventListener('click', () => {
    insertAt('c-html', b.dataset.ph);
    refreshPreview();
  }));

  function renderLetterFields() {
    const meta = letterMap[selectedKind];
    const box = $('letter-fields');
    if (!meta) { box.innerHTML = ''; $('c-gen').disabled = true; return; }
    $('c-gen').disabled = false;
    box.innerHTML = meta.fields.map((f) =>
      `<div class="field ${['note','description','agenda'].includes(f.key) ? 'full' : ''}">
        <label>${esc(f.label)}</label>
        <input data-fk="${esc(f.key)}" placeholder="${esc(f.placeholder || '')}">
      </div>`
    ).join('');
  }

  $('letter-grid').querySelectorAll('.letter-card').forEach((b) => b.addEventListener('click', () => {
    selectedKind = b.dataset.kind;
    $('letter-grid').querySelectorAll('.letter-card').forEach((x) => x.classList.toggle('active', x === b));
    renderLetterFields();
  }));

  $('c-gen').addEventListener('click', async () => {
    const fields = {};
    $('letter-fields').querySelectorAll('[data-fk]').forEach((i) => { if (i.value) fields[i.dataset.fk] = i.value; });
    try {
      const r = await api('/api/letters/generate', {
        method: 'POST',
        body: { kind: selectedKind, fields, locale: $('c-locale').value },
      });
      $('c-subject').value = r.subject;
      $('c-html').value = r.html;
      $('c-text').value = r.text;
      toast('Letter generated');
      refreshPreview();
    } catch (err) { toast(err.message, 'err'); }
  });

  async function parsePaste() {
    const r = await api('/api/leads/parse', { method: 'POST', body: { text: $('c-leads').value } });
    $('c-parse-count').textContent = `${r.total} valid` + (r.invalid.length ? ` · ${r.invalid.length} skipped` : '');
    const box = $('c-parse-box');
    if (!r.total) { box.classList.remove('hidden'); box.innerHTML = '<span class="muted">No valid emails yet.</span>'; return r; }
    box.classList.remove('hidden');
    box.innerHTML = `<table><tr><th>Email</th><th>Name</th><th>Phone</th><th>Company</th></tr>` +
      r.leads.slice(0, 25).map((l) => `<tr><td>${esc(l.email)}</td><td>${esc(l.name)}</td><td>${esc(l.phone)}</td><td>${esc(l.company)}</td></tr>`).join('') +
      (r.total > 25 ? `<tr><td colspan="4" class="muted">…and ${r.total - 25} more</td></tr>` : '') + `</table>`;
    return r;
  }
  $('c-parse').addEventListener('click', () => parsePaste().catch((e) => toast(e.message, 'err')));

  async function refreshPreview() {
    const parsed = await api('/api/leads/parse', { method: 'POST', body: { text: $('c-leads').value } }).catch(() => ({ leads: [] }));
    const lead = parsed.leads?.[0] || null;
    const r = await api('/api/leads/preview', {
      method: 'POST',
      body: { subject: $('c-subject').value, html: $('c-html').value, text: $('c-text').value, lead },
    });
    $('pv-subject').textContent = `Subject · ${r.subject || '—'} `;
    $('pv-count').textContent = lead ? `merged with ${lead.email}` : 'sample data';
    $('pv-frame').srcdoc = r.html || '<p style="font-family:sans-serif;color:#888;padding:24px">Nothing to preview yet.</p>';
  }
  $('c-preview-btn').addEventListener('click', () => refreshPreview().catch((e) => toast(e.message, 'err')));
  ['c-subject', 'c-html'].forEach((id) => $(id).addEventListener('change', () => refreshPreview().catch(() => {})));

  $('ai-run').addEventListener('click', async () => {
    $('ai-notes').textContent = 'Working…';
    try {
      const r = await api('/api/ai/help', {
        method: 'POST',
        body: {
          action: $('ai-action').value,
          prompt: $('ai-prompt').value,
          subject: $('c-subject').value,
          html: $('c-html').value,
          text: $('c-text').value,
          language: $('ai-lang').value,
          kind: selectedKind,
        },
      });
      if (r.subject) $('c-subject').value = r.subject;
      if (r.html) $('c-html').value = r.html;
      if (r.text) $('c-text').value = r.text;
      $('ai-notes').textContent = Array.isArray(r.notes) ? r.notes.filter(Boolean).join(' ') : (r.notes || 'Done.');
      refreshPreview();
    } catch (err) { $('ai-notes').textContent = ''; toast(err.message, 'err'); }
  });

  $('c-save-tpl').addEventListener('click', async () => {
    const name = $('c-name').value || $('c-subject').value;
    if (!name) return toast('Add a name or subject first', 'err');
    try {
      await api('/api/templates', {
        method: 'POST',
        body: { name, subject: $('c-subject').value, html: $('c-html').value, text: $('c-text').value },
      });
      toast('Template saved');
    } catch (err) { toast(err.message, 'err'); }
  });

  $('compose-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await parsePaste();
      const r = await api('/api/campaigns/compose', {
        method: 'POST',
        body: {
          name: $('c-name').value || $('c-subject').value,
          sender_id: $('c-sender').value || null,
          subject: $('c-subject').value,
          html: $('c-html').value,
          text: $('c-text').value,
          leads_text: $('c-leads').value,
          consent: $('c-consent').checked,
          list_id: $('c-list').value || null,
          save_list: true,
        },
      });
      toast(`Queued ${r.queued} · skipped ${r.skipped}`);
      go('messages');
    } catch (err) { toast(err.message, 'err'); }
  });
};

views.office365 = async () => {
  const [tenants, guide] = await Promise.all([
    api('/api/office365'),
    api('/api/office365/guide'),
  ]);
  const selectedId = o365Selected && tenants.some((t) => t.id === o365Selected) ? o365Selected : (tenants[0]?.id || null);
  o365Selected = selectedId;

  view(`<div class="page-head"><h1>Office 365 admin</h1></div>
    <p class="sub">Send through <b>your</b> Microsoft 365 tenant: Graph <code>sendMail</code> (app registration) or SMTP AUTH on <code>smtp.office365.com</code>.</p>
    <div class="kind-tabs" id="o365-tabs">
      <button type="button" data-tab="tenant" class="active">Tenant</button>
      <button type="button" data-tab="mailboxes">Mailboxes</button>
      <button type="button" data-tab="smtp">SMTP AUTH</button>
      <button type="button" data-tab="ai">AI</button>
    </div>

    <section data-pane="tenant">
      <form id="o365-form" class="form-grid">
        <div class="field"><label>Label</label><input name="label" required placeholder="Contoso production"></div>
        <div class="field"><label>Send mode</label>
          <select name="send_mode">
            ${guide.modes.map((m) => `<option value="${m.id}">${esc(m.label)}</option>`).join('')}
          </select>
        </div>
        <div class="field"><label>Directory (tenant) ID</label><input name="tenant_id" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"></div>
        <div class="field"><label>Tenant domain</label><input name="tenant_domain" placeholder="contoso.onmicrosoft.com or contoso.com"></div>
        <div class="field"><label>Application (client) ID</label><input name="client_id" placeholder="Entra app ID"></div>
        <div class="field"><label>Client secret</label><input name="client_secret" type="password" placeholder="shown once in Entra"></div>
        <div class="field"><label>Default from mailbox (UPN)</label><input name="default_mailbox" placeholder="noreply@contoso.com"></div>
        <div class="field"><label>From name</label><input name="from_name" placeholder="Contoso"></div>
        <div class="actions full"><button type="submit">Save tenant</button></div>
      </form>
      <p class="muted small" id="o365-mode-blurb">${esc(guide.modes[0]?.blurb || '')}</p>
      <table id="o365-table"></table>
      <h2>Entra app checklist</h2>
      <ol class="muted" style="padding-left:18px">${guide.entra.map((s) => `<li style="margin:6px 0">${esc(s)}</li>`).join('')}</ol>
      <p class="muted small">Graph permissions: ${guide.permissions.map((p) => `<code>${esc(p.id)}</code>${p.required ? '*' : ''}`).join(' · ')}</p>
    </section>

    <section data-pane="mailboxes" class="hidden">
      <div class="notice">Pick a tenant, then add a licensed mailbox in that tenant as the From address. Graph does not need the mailbox password. SMTP AUTH does.</div>
      <div class="row">
        <div class="field" style="min-width:240px"><label>Tenant</label>
          <select id="mb-tenant">${tenants.map((t) => `<option value="${t.id}" ${t.id === selectedId ? 'selected' : ''}>${esc(t.label)} · ${esc(t.send_mode)}</option>`).join('')}</select>
        </div>
      </div>
      <form id="mb-form" class="form-grid" style="margin-top:12px">
        <div class="field"><label>Mailbox UPN / email</label><input name="email" required placeholder="billing@contoso.com"></div>
        <div class="field"><label>Display name</label><input name="display_name" placeholder="Billing"></div>
        <div class="field full" id="mb-pass-wrap"><label>Mailbox password (SMTP AUTH only)</label><input name="password" type="password"></div>
        <div class="actions full">
          <button type="submit">Add mailbox sender</button>
          <button type="button" class="secondary" id="mb-refresh">Load from Graph</button>
        </div>
      </form>
      <div id="mb-graph" class="parse-box hidden"></div>
      <table id="mb-table" style="margin-top:12px"></table>
    </section>

    <section data-pane="smtp" class="hidden">
      <div class="notice">Host <code>smtp.office365.com</code> port <code>587</code> STARTTLS. Authenticated SMTP must be on for the mailbox. Graph mode is preferred when SMTP AUTH is locked down.</div>
      <ol class="muted" style="padding-left:18px">${guide.smtp.map((s) => `<li style="margin:6px 0">${esc(s)}</li>`).join('')}</ol>
      <pre>Set-CASMailbox -Identity user@yourdomain.com -SmtpClientAuthenticationDisabled $false</pre>
    </section>

    <section data-pane="ai" class="hidden">
      <div class="ai-box">
        <h2 style="margin-top:0">AI for this tenant</h2>
        <p class="muted small">${guide.ai_enabled ? 'Model connected — rewrite copy as your organization (not as Microsoft).' : 'Local setup assistant is always available. Set OPENAI_API_KEY to rewrite tenant mail in your voice.'}</p>
        <div class="form-grid">
          <div class="field"><label>Action</label>
            <select id="o365-ai-action">
              <option value="office_setup">Setup assistant (Entra + SMTP)</option>
              <option value="office_tone">Rewrite as tenant org mail</option>
              <option value="placeholders">Placeholders</option>
            </select>
          </div>
          <div class="field"><label>Language</label>
            <select id="o365-ai-lang"><option value="en">English</option><option value="ja">日本語</option></select>
          </div>
          <div class="field full"><label>Prompt / letter HTML to rewrite</label>
            <textarea id="o365-ai-prompt" rows="4" placeholder="Rewrite this announcement from our company, keep {{first_name}}."></textarea>
          </div>
        </div>
        <button type="button" id="o365-ai-run">Run AI</button>
        <div id="o365-ai-out" class="parse-box" style="margin-top:12px"></div>
      </div>
    </section>`);

  const panes = [...document.querySelectorAll('[data-pane]')];
  $('o365-tabs').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
    $('o365-tabs').querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
    panes.forEach((p) => p.classList.toggle('hidden', p.dataset.pane !== b.dataset.tab));
  }));

  $('o365-form').querySelector('[name=send_mode]').addEventListener('change', (e) => {
    const m = guide.modes.find((x) => x.id === e.target.value);
    $('o365-mode-blurb').textContent = m ? m.blurb : '';
  });

  $('o365-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const b = Object.fromEntries(new FormData(e.target));
    try {
      const r = await api('/api/office365', { method: 'POST', body: b });
      o365Selected = r.id; toast('Tenant saved'); views.office365();
    } catch (err) { toast(err.message, 'err'); }
  });

  $('o365-table').innerHTML = `<tr><th>Label</th><th>Mode</th><th>Tenant</th><th>Mailbox</th><th>Status</th><th></th></tr>` +
    (tenants.map((t) => `<tr>
      <td><b>${esc(t.label)}</b>${t.org_name ? `<div class="muted small">${esc(t.org_name)}</div>` : ''}</td>
      <td>${badge(t.send_mode)}</td>
      <td class="mono small">${esc(t.tenant_domain || t.tenant_id || '—')}</td>
      <td>${esc(t.default_mailbox || '—')}</td>
      <td>${t.verified ? badge('verified') : badge('pending')}</td>
      <td>
        <button class="tiny secondary" data-use="${t.id}">Select</button>
        <button class="tiny secondary" data-v="${t.id}">Verify</button>
        <button class="tiny danger" data-d="${t.id}">Delete</button>
      </td></tr>`).join('')
      || `<tr><td colspan="6" class="muted">No tenants yet. Save your Entra app above.</td></tr>`);

  $('o365-table').querySelectorAll('[data-use]').forEach((b) => b.addEventListener('click', () => {
    o365Selected = parseInt(b.dataset.use, 10); views.office365();
  }));
  $('o365-table').querySelectorAll('[data-v]').forEach((b) => b.addEventListener('click', async () => {
    try {
      const r = await api(`/api/office365/${b.dataset.v}/verify`, { method: 'POST' });
      toast(r.org ? `Verified · ${r.org}` : (r.note || 'Verified'));
      if (r.consent_url) prompt('Admin consent URL (open as a tenant admin):', r.consent_url);
      views.office365();
    } catch (err) { toast(err.message, 'err'); }
  }));
  $('o365-table').querySelectorAll('[data-d]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Delete this tenant and its Office 365 senders?')) return;
    await api(`/api/office365/${b.dataset.d}`, { method: 'DELETE' });
    if (o365Selected === parseInt(b.dataset.d, 10)) o365Selected = null;
    views.office365();
  }));

  async function loadMailboxes() {
    const tid = $('mb-tenant')?.value;
    if (!tid) return;
    o365Selected = parseInt(tid, 10);
    const t = tenants.find((x) => x.id === o365Selected);
    $('mb-pass-wrap').classList.toggle('hidden', t?.send_mode !== 'smtp_auth');
    const data = await api(`/api/office365/${tid}/mailboxes`);
    $('mb-table').innerHTML = `<tr><th>From</th><th>Mode</th><th>Status</th><th></th></tr>` +
      (data.local.map((s) => `<tr>
        <td>${esc(s.from_name)} &lt;${esc(s.from_email)}&gt;</td>
        <td>${badge(s.auth_mode || data.send_mode)}</td>
        <td>${s.verified ? badge('verified') : badge('pending')}</td>
        <td><button class="tiny secondary" data-mv="${s.id}">Verify</button>
            <button class="tiny danger" data-md="${s.id}">Remove</button></td></tr>`).join('')
        || `<tr><td colspan="4" class="muted">No mailboxes linked yet.</td></tr>`);
    $('mb-table').querySelectorAll('[data-mv]').forEach((b) => b.addEventListener('click', async () => {
      try {
        await api(`/api/office365/${tid}/mailboxes/${b.dataset.mv}/verify`, { method: 'POST' });
        toast('Mailbox verified'); loadMailboxes();
      } catch (err) { toast(err.message, 'err'); }
    }));
    $('mb-table').querySelectorAll('[data-md]').forEach((b) => b.addEventListener('click', async () => {
      await api(`/api/senders/${b.dataset.md}`, { method: 'DELETE' }); loadMailboxes();
    }));
    return data;
  }

  if ($('mb-tenant')) {
    $('mb-tenant').addEventListener('change', () => loadMailboxes().catch((e) => toast(e.message, 'err')));
    loadMailboxes().catch(() => {});
  }

  $('mb-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const tid = $('mb-tenant').value;
    if (!tid) return toast('Save a tenant first', 'err');
    const b = Object.fromEntries(new FormData(e.target));
    try {
      await api(`/api/office365/${tid}/mailboxes`, { method: 'POST', body: b });
      e.target.reset(); toast('Mailbox added — it appears in Compose senders after verify');
      loadMailboxes();
    } catch (err) { toast(err.message, 'err'); }
  });

  $('mb-refresh')?.addEventListener('click', async () => {
    const tid = $('mb-tenant')?.value;
    if (!tid) return toast('Save a tenant first', 'err');
    try {
      const data = await loadMailboxes();
      const box = $('mb-graph');
      if (data.graph_error) {
        box.classList.remove('hidden');
        box.innerHTML = `<span class="muted">${esc(data.graph_error)} (User.Read.All is optional.)</span>`;
        return;
      }
      if (!data.graph.length) {
        box.classList.remove('hidden');
        box.innerHTML = '<span class="muted">Graph returned no users. Check User.Read.All + admin consent, or paste a UPN above.</span>';
        return;
      }
      box.classList.remove('hidden');
      box.innerHTML = data.graph.slice(0, 30).map((u) =>
        `<button type="button" class="chip" data-upn="${esc(u.email)}" data-dn="${esc(u.displayName)}">${esc(u.displayName || u.email)} · ${esc(u.email)}</button>`
      ).join(' ');
      box.querySelectorAll('[data-upn]').forEach((ch) => ch.addEventListener('click', () => {
        $('mb-form').email.value = ch.dataset.upn;
        $('mb-form').display_name.value = ch.dataset.dn || '';
      }));
    } catch (err) { toast(err.message, 'err'); }
  });

  $('o365-ai-run')?.addEventListener('click', async () => {
    $('o365-ai-out').textContent = 'Working…';
    try {
      const r = await api('/api/office365/ai', {
        method: 'POST',
        body: {
          action: $('o365-ai-action').value,
          prompt: $('o365-ai-prompt').value,
          html: $('o365-ai-prompt').value,
          language: $('o365-ai-lang').value,
        },
      });
      const notes = Array.isArray(r.notes) ? r.notes.filter(Boolean) : [r.notes];
      $('o365-ai-out').innerHTML = notes.map((n) => `<div style="margin:6px 0">${esc(n)}</div>`).join('') +
        (r.subject ? `<p><b>Subject</b> ${esc(r.subject)}</p>` : '') +
        (r.html && r.html !== $('o365-ai-prompt').value ? `<pre>${esc(r.html).slice(0, 2000)}</pre>` : '');
    } catch (err) { $('o365-ai-out').textContent = ''; toast(err.message, 'err'); }
  });
};

views.senders = async () => {
  const presets = await api('/api/senders/presets');
  view(`<div class="page-head"><h1>Senders</h1></div>
    <p class="sub">SMTP for mailboxes and domains you own. OVH, webmail, and Japan hosts are presets that fill the official server — not a proxy.</p>
    <div class="notice">Microsoft 365 tenant (Graph app + SMTP AUTH) lives under <a data-go="office365">Office 365</a>. Use this page for other SMTP hosts, or a single Outlook mailbox.</div>
    <div class="kind-tabs" id="kind-tabs">
      ${presets.kinds.map((k) => `<button type="button" data-kind="${k.id}">${esc(k.label)}</button>`).join('')}
    </div>
    <p class="muted small" id="kind-blurb"></p>
    <form id="sender-form" class="form-grid">
      <div class="field"><label>Preset</label><select name="preset" id="preset-sel"></select></div>
      <div class="field"><label>Label</label><input name="label" required placeholder="Billing mailbox"></div>
      <div class="field"><label>From email</label><input name="from_email" type="email" required placeholder="hello@yourdomain.com"></div>
      <div class="field"><label>From name</label><input name="from_name" placeholder="Your Company"></div>
      <div class="field"><label>SMTP host</label><input name="host" id="s-host" required placeholder="smtp.yourprovider.com"></div>
      <div class="field"><label>Port</label><input name="port" id="s-port" type="number" value="587"></div>
      <div class="field"><label>Secure (TLS on connect)</label>
        <select name="secure" id="s-secure"><option value="false">No (STARTTLS 587)</option><option value="true">Yes (465)</option></select>
      </div>
      <div class="field"><label>Username</label><input name="username" required placeholder="usually the full email"></div>
      <div class="field"><label>Password / app password</label><input name="password" type="password" required></div>
      <div class="field full hidden" id="sms-gw-wrap">
        <label>SMS gateway domain or pattern</label>
        <select id="sms-gw-sel">${presets.sms_gateways.map((g) => `<option value="${esc(g.domain)}">${esc(g.label)}${g.domain ? ' · ' + g.domain : ''}</option>`).join('')}</select>
        <input name="sms_gateway" id="sms-gw" placeholder="txt.att.net or {number}@sms.yourhost.com" style="margin-top:8px">
        <p class="muted small">Each lead needs a phone number. The message is sent as email to <code>number@gateway</code>.</p>
      </div>
      <input type="hidden" name="kind" id="s-kind" value="smtp">
      <div class="actions full"><button type="submit">Add sender</button></div>
    </form>
    <p class="muted small" id="preset-hint"></p>
    <table id="sender-table"></table>`);

  let kind = 'smtp';
  function applyKind() {
    $('s-kind').value = kind;
    $('kind-tabs').querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.kind === kind));
    const meta = presets.kinds.find((k) => k.id === kind);
    $('kind-blurb').textContent = meta ? meta.blurb : '';
    const opts = presets.presets.filter((p) => p.kind === kind);
    $('preset-sel').innerHTML = opts.map((p) => `<option value="${p.id}">${esc(p.label)}</option>`).join('');
    $('sms-gw-wrap').classList.toggle('hidden', kind !== 'smtp_sms');
    applyPreset();
  }
  function applyPreset() {
    const p = presets.presets.find((x) => x.id === $('preset-sel').value);
    if (!p) return;
    if (p.host) $('s-host').value = p.host;
    $('s-port').value = p.port;
    $('s-secure').value = p.secure ? 'true' : 'false';
    $('preset-hint').textContent = p.hint || '';
  }
  $('kind-tabs').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { kind = b.dataset.kind; applyKind(); }));
  $('preset-sel').addEventListener('change', applyPreset);
  $('sms-gw-sel').addEventListener('change', () => { if ($('sms-gw-sel').value) $('sms-gw').value = $('sms-gw-sel').value; });
  applyKind();

  document.querySelector('[data-go="office365"]')?.addEventListener('click', () => go('office365'));

  $('sender-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target; const b = Object.fromEntries(new FormData(f));
    b.secure = b.secure === 'true'; b.port = parseInt(b.port, 10);
    try { await api('/api/senders', { method: 'POST', body: b }); f.reset(); toast('Sender added'); views.senders(); }
    catch (err) { toast(err.message, 'err'); }
  });
  const rows = await api('/api/senders');
  $('sender-table').innerHTML = `<tr><th>Label</th><th>Type</th><th>From</th><th>Host</th><th>Status</th><th></th></tr>` +
    (rows.map((s) => `<tr>
      <td>${esc(s.label)}</td><td>${badge(s.kind)}</td>
      <td>${esc(s.from_name)} &lt;${esc(s.from_email)}&gt;</td>
      <td class="mono small">${esc(s.host)}:${s.port}${s.sms_gateway ? `<div class="muted">${esc(s.sms_gateway)}</div>` : ''}</td>
      <td>${s.verified ? badge('verified') : badge('pending')}</td>
      <td><button class="tiny secondary" data-v="${s.id}">Verify</button>
          <button class="tiny danger" data-d="${s.id}">Delete</button></td></tr>`).join('')
      || `<tr><td colspan="6" class="muted">No senders yet.</td></tr>`);
  $('sender-table').querySelectorAll('[data-v]').forEach((b) => b.addEventListener('click', async () => {
    try { await api(`/api/senders/${b.dataset.v}/verify`, { method: 'POST' }); toast('Verified ✓'); views.senders(); }
    catch (err) { toast(err.message, 'err'); }
  }));
  $('sender-table').querySelectorAll('[data-d]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Delete this sender?')) return;
    await api(`/api/senders/${b.dataset.d}`, { method: 'DELETE' }); views.senders();
  }));
};

views.lists = async () => {
  view(`<div class="page-head"><h1>Lists</h1></div>
    <p class="sub">Paste recipients into a list. Double opt-in still applies unless you already hold recorded consent.</p>
    <form id="list-form" class="row">
      <div class="field"><label>List name</label><input name="name" required placeholder="Customers"></div>
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
  box.innerHTML = `<h2>${esc(list.name)} — paste leads</h2>
    <textarea id="paste-box" rows="7" placeholder="email, name, phone, company
alex@example.com, Alex Rivera, +15550100, Northwind"></textarea>
    <label class="check" style="margin:10px 0"><input type="checkbox" id="paste-consent"><span>I confirm these people opted in to this list.</span></label>
    <label class="check" style="margin:0 0 10px"><input type="checkbox" id="paste-confirmed"><span>I already have recorded consent (mark confirmed, skip the extra confirm email).</span></label>
    <button type="button" id="paste-go">Add pasted leads</button>
    <h2>Or add one</h2>
    <form id="sub-form" class="row">
      <div class="field"><label>Email</label><input name="email" type="email" required></div>
      <div class="field"><label>Name</label><input name="name"></div>
      <div class="field"><label>Phone</label><input name="phone"></div>
      <div class="field"><label>Company</label><input name="company"></div>
      <label class="field small"><span>&nbsp;</span><label><input type="checkbox" name="preConfirmed" style="width:auto"> Recorded consent</label></label>
      <button type="submit">Add subscriber</button>
    </form>
    <table id="sub-table"></table>`;
  $('paste-go').addEventListener('click', async () => {
    try {
      const r = await api(`/api/lists/${id}/paste`, {
        method: 'POST',
        body: {
          text: $('paste-box').value,
          consent: $('paste-consent').checked,
          preConfirmed: $('paste-confirmed').checked,
        },
      });
      toast(`Added ${r.added}`); openList(id, lists);
    } catch (err) { toast(err.message, 'err'); }
  });
  $('sub-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const b = Object.fromEntries(fd);
    b.preConfirmed = fd.get('preConfirmed') === 'on';
    try {
      const r = await api(`/api/lists/${id}/subscribe`, { method: 'POST', body: b });
      e.target.reset();
      if (r.confirm_url) prompt('Send this confirmation link to the subscriber:', r.confirm_url);
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
  view(`<div class="page-head"><h1>Contacts</h1></div><p class="sub">Everyone in your account. Add people by pasting into a list or Compose.</p><table id="c-table"></table>`);
  const rows = await api('/api/contacts');
  $('c-table').innerHTML = `<tr><th>Email</th><th>Name</th><th>Phone</th><th>Company</th><th></th></tr>` +
    (rows.map((c) => `<tr><td>${esc(c.email)}</td><td>${esc(c.name || '')}</td><td>${esc(c.phone || '')}</td><td>${esc(c.company || '')}</td>
      <td><button class="tiny danger" data-d="${c.id}">Delete</button></td></tr>`).join('')
      || `<tr><td colspan="5" class="muted">No contacts yet.</td></tr>`);
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
    <p class="sub">Reusable content. Merge fields: <code>{{name}}</code> <code>{{first_name}}</code> <code>{{email}}</code> <code>{{company}}</code> <code>{{phone}}</code>. Fallback: <code>{{first_name|there}}</code>.</p>
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
      || `<tr><td colspan="3" class="muted">No templates yet. Generate one from Compose.</td></tr>`);
  $('tpl-table').querySelectorAll('[data-d]').forEach((b) => b.addEventListener('click', async () => {
    await api(`/api/templates/${b.dataset.d}`, { method: 'DELETE' }); views.templates();
  }));
};

views.campaigns = async () => {
  const [senders, lists, tpls] = await Promise.all([api('/api/senders'), api('/api/lists'), api('/api/templates')]);
  view(`<div class="page-head"><h1>Campaigns</h1>
    <button class="secondary" id="to-compose">Open compose</button></div>
    <p class="sub">Drafts against a saved list. Prefer <b>Compose</b> to paste leads and generate a letter in one step.</p>
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
      <div class="field full"><label>Start from template</label>
        <select id="tpl-pick"><option value="">— none —</option>
          ${tpls.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}
        </select>
      </div>
      <div class="field full"><label>HTML body</label><textarea name="html" id="camp-html" rows="6" placeholder="<p>Hi {{first_name|there}}…</p>"></textarea></div>
      <div class="field full"><label>Plain text</label><textarea name="text" id="camp-text" rows="3"></textarea></div>
      <div class="actions full"><button type="submit">Save draft</button></div>
    </form>
    <table id="camp-table"></table>`);
  $('to-compose').addEventListener('click', () => go('compose'));
  $('tpl-pick').addEventListener('change', () => {
    const t = tpls.find((x) => String(x.id) === $('tpl-pick').value);
    if (!t) return;
    document.querySelector('#camp-form [name=subject]').value = t.subject || '';
    $('camp-html').value = t.html || '';
    $('camp-text').value = t.text || '';
  });
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
    try {
      await api('/api/auth/change-password', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
      e.target.reset(); toast('Password updated');
    } catch (err) { toast(err.message, 'err'); }
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

(async () => {
  if (state.token) { try { await boot(); return; } catch { /* fall through */ } }
  $('login').classList.remove('hidden');
})();
