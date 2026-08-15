// Freedom Mailer panel
const state = { token: localStorage.getItem('fm_token') || null, user: null, route: 'compose' };
let o365Selected = null;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const THEMES = [
  { id: 'phoenix', label: 'Phoenix', tag: 'PHOENIX // GLOBAL RELAY', a: '#c41e2a', b: '#050307' },
  { id: 'midnight', label: 'Midnight', tag: 'MIDNIGHT // DEEP RELAY', a: '#2f7fff', b: '#05080f' },
  { id: 'carbon', label: 'Carbon', tag: 'CARBON // TERMINAL', a: '#1f9d55', b: '#070908' },
  { id: 'ember', label: 'Ember', tag: 'EMBER // FORGE', a: '#e85d04', b: '#100704' },
  { id: 'snow', label: 'Snow', tag: 'SNOW // DAYLIGHT', a: '#c41e2a', b: '#f3eee9' },
];

function currentTheme() {
  const id = localStorage.getItem('fm_theme') || 'phoenix';
  return THEMES.find((t) => t.id === id) || THEMES[0];
}

function applyTheme(id, persist = true) {
  const t = THEMES.find((x) => x.id === id) || THEMES[0];
  document.documentElement.setAttribute('data-theme', t.id);
  if (persist) localStorage.setItem('fm_theme', t.id);
  const loginTag = $('login-tag');
  const sideTag = $('sidebar-tag');
  if (loginTag) loginTag.textContent = t.tag;
  if (sideTag) sideTag.textContent = t.tag;
  renderThemeSwitch();
  document.querySelectorAll('.theme-card').forEach((c) => c.classList.toggle('active', c.dataset.themeId === t.id));
}

function renderThemeSwitch() {
  const el = $('theme-switch');
  if (!el) return;
  const cur = currentTheme().id;
  el.innerHTML = THEMES.map((t) =>
    `<button type="button" class="theme-dot${t.id === cur ? ' active' : ''}" data-theme-id="${t.id}" title="${esc(t.label)}" style="--dot-a:${t.a};--dot-b:${t.b}" aria-label="${esc(t.label)}"></button>`
  ).join('');
  el.querySelectorAll('[data-theme-id]').forEach((b) => {
    b.addEventListener('click', () => applyTheme(b.dataset.themeId));
  });
}

applyTheme(localStorage.getItem('fm_theme') || 'phoenix', false);

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
  ['links', '🔗 Links'],
  ['deliverability', '📬 Deliverability'],
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
const ADMIN_NAV = [
  ['admin', '🎛️ Admin'],
  ['users', '👥 Clients'],
];
const ROUTE_FEATURE = {
  compose: 'compose',
  office365: 'office365',
  links: 'links',
  deliverability: 'deliverability',
  senders: 'senders',
  lists: 'campaigns',
  contacts: 'campaigns',
  templates: 'campaigns',
  campaigns: 'campaigns',
  apikeys: 'apikeys',
};

function clientCan(feature) {
  if (!state.user) return false;
  if (state.user.role === 'admin') return true;
  return state.user.features?.[feature] !== false;
}

function renderNav() {
  const allowed = NAV.filter(([r]) => {
    const feat = ROUTE_FEATURE[r];
    return !feat || clientCan(feat);
  });
  const items = state.user.role === 'admin' ? [...ADMIN_NAV, ...allowed] : allowed;
  $('nav').innerHTML = items
    .map(([r, label]) => `<a data-route="${r}" class="${r === state.route ? 'active' : ''}">${label}</a>`)
    .join('');
  $('nav').querySelectorAll('a').forEach((a) => a.addEventListener('click', () => go(a.dataset.route)));
  $('who').textContent = `${state.user.email} · ${state.user.role}${state.user.license?.label ? ' · ' + state.user.license.label : ''}`;
  const banner = $('ops-banner');
  if (banner) {
    const msg = state.user.banner || (state.user.maintenance ? 'Maintenance mode — sending is paused.' : '') || (state.user.pause_sends ? 'The operator paused sending.' : '');
    banner.classList.toggle('hidden', !msg);
    banner.textContent = msg;
  }
}

function go(route) { state.route = route; renderNav(); views[route](); }

async function boot() {
  state.user = await api('/api/auth/me');
  $('login').classList.add('hidden'); $('app').classList.remove('hidden');
  renderThemeSwitch();
  renderNav();
  if (state.user.role !== 'admin' && state.user.license && !state.user.license.ok) {
    go('account');
    return;
  }
  go(state.user.role === 'admin' ? 'admin' : 'compose');
}

const views = {};
const view = (html) => { $('view').innerHTML = html; };
const badge = (status) => {
  const map = {
    sent: 'ok', confirmed: 'ok', verified: 'ok', queued: 'warn', pending: 'warn',
    sending: 'warn', draft: 'muted', failed: 'err', skipped: 'muted', unsubscribed: 'muted',
    smtp: 'muted', ovh: 'ok', webmail: 'warn', japan: 'ok', smtp_sms: 'warn',
    office365: 'ok', graph: 'ok', smtp_auth: 'warn',
    mailgun: 'ok', sendgrid: 'ok', postfix: 'warn', aws: 'ok', gcp: 'ok', api: 'ok',
    '3day': 'warn', monthly: 'ok', lifetime: 'ok', expired: 'err',
    undeliverable: 'err', unknown: 'warn', drop: 'err', invalid: 'err',
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
    card(s.short_links || 0, 'Tracking links'),
    card(s.sms_enabled ? 'On' : 'Off', 'Twilio SMS'),
    card(s.ai_enabled ? 'On' : 'Local', 'AI help'),
  ].join('');
};

views.links = async () => {
  view(`<div class="page-head"><h1>Tracking links</h1></div>
    <p class="sub">Branded short URLs on <b>your</b> app host for landing pages in email. Every visitor — including Safe Links and crawlers — is sent to the <b>same</b> destination. Bots are logged, not shown a fake page.</p>
    <div class="notice">Serving a clean page to scanners and a different offer to humans is how spam filters catch you. This shortener does not do that.</div>

    <div class="kind-tabs" id="link-tabs">
      <button type="button" class="active" data-tab="shorten">Shorten</button>
      <button type="button" data-tab="validate">Validate for email</button>
    </div>

    <section data-lpane="shorten">
      <form id="link-form" class="form-grid">
        <div class="field full"><label>Destination URL</label><input name="destination" required placeholder="https://yourcompany.com/offer"></div>
        <div class="field"><label>Label</label><input name="label" placeholder="August CTA"></div>
        <div class="field"><label>When clicked</label>
          <select name="mode">
            <option value="redirect">Redirect immediately (302)</option>
            <option value="landing">Show a landing page, then continue</option>
          </select>
        </div>
        <div class="field full"><label>Landing title (landing mode)</label><input name="title" placeholder="Continue to our site"></div>
        <div class="actions full"><button type="submit">Create short link</button></div>
      </form>
      <div id="link-created" class="notice hidden"></div>
      <table id="link-table"></table>
      <div id="link-clicks"></div>
    </section>

    <section data-lpane="validate" class="hidden">
      <p class="muted small">Checks HTTPS, impersonation lookalikes, public shorteners, private/IP hosts, and whether the destination actually loads. Paste a URL or a letter’s HTML.</p>
      <form id="val-form">
        <div class="field"><label>URL</label><input id="val-url" placeholder="https://yourcompany.com/pricing"></div>
        <div class="field" style="margin-top:10px"><label>Or HTML to scan</label><textarea id="val-html" rows="6" placeholder="<a href=&quot;https://…&quot;>"></textarea></div>
        <div class="actions" style="margin-top:10px"><button type="submit">Check</button></div>
      </form>
      <div id="val-out" style="margin-top:14px"></div>
    </section>`);

  const panes = [...document.querySelectorAll('[data-lpane]')];
  $('link-tabs').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
    $('link-tabs').querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
    panes.forEach((p) => p.classList.toggle('hidden', p.dataset.lpane !== b.dataset.tab));
  }));

  function verdictBadge(v) {
    if (v === 'ok') return badge('verified');
    if (v === 'risky') return badge('pending');
    return badge('failed');
  }

  async function loadLinks() {
    const rows = await api('/api/links');
    $('link-table').innerHTML = `<tr><th>Short</th><th>Destination</th><th>Mode</th><th>Score</th><th>Clicks</th><th></th></tr>` +
      (rows.map((r) => `<tr>
        <td class="mono small"><a href="${esc(r.short_url)}" target="_blank" rel="noopener">${esc(r.short_url)}</a>
          <div class="muted">${esc(r.label)}</div></td>
        <td class="small">${esc(r.destination)}</td>
        <td>${esc(r.mode)}</td>
        <td>${r.last_verdict ? verdictBadge(r.last_verdict) : '—'} ${r.last_score || ''}</td>
        <td>${r.clicks} <span class="muted small">(${r.human_hits} people / ${r.bot_hits} bots)</span></td>
        <td><button class="tiny secondary" data-c="${r.id}">Clicks</button>
            <button class="tiny danger" data-d="${r.id}">Delete</button></td></tr>`).join('')
        || `<tr><td colspan="6" class="muted">No links yet.</td></tr>`);
    $('link-table').querySelectorAll('[data-d]').forEach((b) => b.addEventListener('click', async () => {
      await api(`/api/links/${b.dataset.d}`, { method: 'DELETE' }); loadLinks();
    }));
    $('link-table').querySelectorAll('[data-c]').forEach((b) => b.addEventListener('click', async () => {
      const data = await api(`/api/links/${b.dataset.c}/clicks`);
      $('link-clicks').innerHTML = `<h2>Recent hits</h2><table><tr><th>When</th><th>Kind</th><th>Marker</th></tr>` +
        (data.clicks.map((c) => `<tr><td class="muted small">${esc(c.created_at)}</td><td>${badge(c.kind === 'bot' ? 'pending' : 'confirmed')} ${esc(c.kind)}</td><td class="mono small">${esc(c.marker || '—')}</td></tr>`).join('')
          || `<tr><td colspan="3" class="muted">No clicks yet.</td></tr>`) + `</table>`;
    }));
  }

  $('link-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const b = Object.fromEntries(new FormData(e.target));
    try {
      const r = await api('/api/links', { method: 'POST', body: b });
      const box = $('link-created');
      box.classList.remove('hidden');
      box.innerHTML = `Use this in your letter: <code>${esc(r.short_url)}</code>
        ${r.report?.verdict === 'risky' ? `<div class="muted">Created with warnings: ${(r.report.warnings || []).join(' ')}</div>` : ''}`;
      e.target.reset();
      loadLinks();
    } catch (err) { toast(err.message, 'err'); }
  });

  $('val-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('val-out').textContent = 'Checking…';
    try {
      const body = { url: $('val-url').value, html: $('val-html').value };
      const r = await api('/api/links/validate', { method: 'POST', body });
      const reports = r.reports || [r];
      $('val-out').innerHTML = reports.map((rep) => `
        <div class="card" style="margin-bottom:10px">
          <div><b>${esc(rep.host || rep.url || '')}</b> ${verdictBadge(rep.verdict)} score ${rep.score}</div>
          <div class="muted small">${esc(rep.url || '')}</div>
          ${(rep.issues || []).map((i) => `<div class="error">${esc(i)}</div>`).join('')}
          ${(rep.warnings || []).map((w) => `<div class="muted small">⚠ ${esc(w)}</div>`).join('')}
          ${(rep.hops || []).length ? `<div class="muted small">Hops: ${rep.hops.map((h) => esc(String(h.status))).join(' → ')}</div>` : ''}
        </div>`).join('') || '<div class="muted">No URLs found.</div>';
    } catch (err) { $('val-out').textContent = ''; toast(err.message, 'err'); }
  });

  loadLinks().catch((e) => toast(e.message, 'err'));
};

views.deliverability = async () => {
  view(`<div class="page-head"><h1>Deliverability</h1></div>
    <p class="sub">Paste addresses. The debouncer MX-checks <b>each email’s domain</b>: DNS MX, public IP of the mail host, then an SMTP 220 banner (no RCPT). That is whether the domain can receive mail — not whether the mailbox exists.</p>
    <div class="notice">No mailbox probing (RCPT TO). A live MX can still bounce a missing user. Disposable, junk syntax, null MX, and dead MX hosts are dropped so they never hit your sender reputation.</div>
    <textarea id="deb-text" rows="8" placeholder="alex@gmail.com
jordan@contoso.com
info@northwind.example
not-an-email"></textarea>
    <div class="usage-bar deb-progress"><span id="deb-bar" style="width:0%"></span></div>
    <p class="muted small" id="deb-hint">Paste a list, then Run. Checking starts after you pause typing, and walks every domain.</p>
    <div class="actions" style="margin:10px 0">
      <button type="button" id="deb-run">Run MX check</button>
      <button type="button" class="secondary" id="deb-copy-keep">Copy keepers</button>
      <button type="button" class="secondary" id="deb-copy-live">Copy deliverable</button>
      <button type="button" class="secondary" id="deb-copy-drop">Copy drops</button>
    </div>
    <div id="deb-sum" class="cards"></div>
    <h2>By provider / ISP</h2>
    <div id="deb-groups"></div>
    <h2>Each address</h2>
    <table id="deb-table"></table>`);

  let last = null;
  let timer = null;
  let runId = 0;

  function copyText(s) {
    navigator.clipboard.writeText(s).then(() => toast('Copied')).catch(() => prompt('Copy:', s));
  }

  function extractEmails(text) {
    const found = String(text || '').match(/[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}/gi) || [];
    const seen = new Set();
    const emails = [];
    for (const raw of found) {
      const e = raw.toLowerCase();
      if (seen.has(e)) continue;
      seen.add(e);
      emails.push(e);
    }
    return emails.slice(0, 500);
  }

  function pack(results) {
    const groups = {};
    for (const r of results) {
      const key = r.provider || 'other';
      if (!groups[key]) {
        groups[key] = { id: key, label: r.label || key, kind: r.kind || 'none', emails: [], keep: 0, drop: 0, deliverable: 0 };
      }
      groups[key].emails.push(r.email);
      if (r.keep) groups[key].keep++;
      else groups[key].drop++;
      if (r.deliverable) groups[key].deliverable++;
    }
    const summary = {
      total: results.length,
      keep: results.filter((r) => r.keep).length,
      drop: results.filter((r) => !r.keep).length,
      risky: results.filter((r) => r.verdict === 'risky').length,
      deliverable: results.filter((r) => r.deliverable).length,
      undeliverable: results.filter((r) => r.verdict === 'undeliverable' || r.verdict === 'drop' || r.verdict === 'invalid').length,
      mx_live: results.filter((r) => r.mx_live).length,
      unknown: results.filter((r) => r.verdict === 'unknown').length,
      providers: Object.keys(groups).length,
    };
    return { results, groups: Object.values(groups).sort((a, b) => b.emails.length - a.emails.length), summary };
  }

  function paint(data) {
    last = data;
    const s = data.summary;
    const card = (n, label) => `<div class="card"><div class="stat">${n}</div><div class="stat-label">${label}</div></div>`;
    $('deb-sum').innerHTML = [
      card(s.total, 'Checked'),
      card(s.deliverable ?? s.keep, 'Deliverable MX'),
      card(s.mx_live || 0, 'SMTP live'),
      card(s.risky, 'Risky'),
      card(s.undeliverable ?? s.drop, 'Undeliverable'),
    ].join('');

    $('deb-groups').innerHTML = data.groups.map((g) => `
      <div class="card" style="margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;gap:10px;align-items:center">
          <div><b>${esc(g.label)}</b> ${badge(g.kind === 'none' ? 'failed' : g.kind === 'isp' ? 'warn' : 'ok')}
            <div class="muted small">${g.kind} · ${g.emails.length} · keep ${g.keep} · drop ${g.drop}${g.deliverable ? ' · MX ' + g.deliverable : ''}</div></div>
          <button type="button" class="tiny secondary" data-copy="${esc(g.id)}">Copy</button>
        </div>
      </div>`).join('') || '<div class="muted">No groups.</div>';

    $('deb-groups').querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', () => {
      const g = data.groups.find((x) => x.id === b.dataset.copy);
      if (g) copyText(g.emails.join('\n'));
    }));

    $('deb-table').innerHTML = `<tr><th>Email</th><th>Verdict</th><th>Deliverable</th><th>Provider</th><th>MX</th><th>SMTP</th><th>Note</th></tr>` +
      data.results.map((r) => {
        const smtp = r.mx_live
          ? (r.smtp?.banner || '220 live')
          : r.smtp?.error === 'timeout'
            ? 'probe timeout'
            : r.smtp?.error || (r.deliverable ? 'DNS MX only' : '—');
        const mx = (r.mx || []).slice(0, 2).join(', ') || r.mx_error || '—';
        return `<tr>
        <td>${esc(r.email)}${r.suggestion ? `<div class="muted small">Did you mean ${esc(r.suggestion)}?</div>` : ''}</td>
        <td>${badge(r.verdict)} ${esc(r.verdict)}</td>
        <td>${r.deliverable ? badge('confirmed') + ' yes' : badge('failed') + ' no'}${r.mx_live ? ' · live' : ''}</td>
        <td>${esc(r.label || r.provider)}</td>
        <td class="mono small">${esc(mx)}</td>
        <td class="muted small">${esc(smtp)}</td>
        <td class="muted small">${esc(r.reason || (r.flags || []).join(', '))}</td>
      </tr>`;
      }).join('');
  }

  async function run(fresh = false) {
    const text = $('deb-text').value;
    const emails = extractEmails(text);
    if (!emails.length) return toast('Paste at least one address', 'err');
    const my = ++runId;
    const byDomain = new Map();
    for (const e of emails) {
      const d = e.split('@')[1];
      if (!byDomain.has(d)) byDomain.set(d, []);
      byDomain.get(d).push(e);
    }
    const domains = [...byDomain.keys()];
    const all = [];
    let done = 0;
    $('deb-bar').style.width = '0%';
    $('deb-hint').textContent = `Checking MX for ${emails.length} address(es) across ${domains.length} domain(s)…`;

    async function checkDomain(domain) {
      if (my !== runId) return;
      const list = byDomain.get(domain);
      $('deb-hint').textContent = `MX ${done + 1}/${domains.length} · ${domain} · ${list.length} address(es)`;
      const chunk = await api('/api/deliverability/check', {
        method: 'POST',
        body: { emails: list, probe: true, fresh },
      });
      if (my !== runId) return;
      all.push(...(chunk.results || []));
      done += 1;
      $('deb-bar').style.width = `${Math.round((done / domains.length) * 100)}%`;
      paint(pack(all));
    }

    const queue = [...domains];
    const workers = Array.from({ length: Math.min(2, queue.length) }, async () => {
      while (queue.length) {
        if (my !== runId) return;
        const domain = queue.shift();
        try { await checkDomain(domain); }
        catch (err) {
          if (my !== runId) return;
          const list = byDomain.get(domain) || [];
          all.push(...list.map((email) => ({
            email, verdict: 'unknown', keep: false, deliverable: false, mx_live: false,
            provider: 'timeout', label: 'Check failed', kind: 'none', mx: [], reason: err.message,
          })));
          done += 1;
          $('deb-bar').style.width = `${Math.round((done / Math.max(domains.length, 1)) * 100)}%`;
          paint(pack(all));
        }
      }
    });
    try {
      await Promise.all(workers);
      if (my !== runId) return;
      $('deb-hint').textContent = `Done · ${last?.summary.deliverable || 0} deliverable MX · ${last?.summary.mx_live || 0} SMTP live · ${last?.summary.drop || 0} drop.`;
    } catch (err) {
      if (my !== runId) return;
      $('deb-hint').textContent = '';
      toast(err.message, 'err');
    }
  }

  $('deb-text').addEventListener('input', () => {
    const n = extractEmails($('deb-text').value).length;
    $('deb-hint').textContent = n
      ? `${n} address(es) — pausing to finish paste, then MX-checking each domain…`
      : 'Paste a list, then Run.';
    clearTimeout(timer);
    timer = setTimeout(() => run(false), 1800);
  });
  $('deb-run').addEventListener('click', () => { clearTimeout(timer); run(true); });
  $('deb-copy-keep').addEventListener('click', () => {
    if (!last) return toast('Run a check first', 'err');
    copyText(last.results.filter((r) => r.keep).map((r) => r.email).join('\n'));
  });
  $('deb-copy-live').addEventListener('click', () => {
    if (!last) return toast('Run a check first', 'err');
    copyText(last.results.filter((r) => r.deliverable).map((r) => r.email).join('\n'));
  });
  $('deb-copy-drop').addEventListener('click', () => {
    if (!last) return toast('Run a check first', 'err');
    copyText(last.results.filter((r) => !r.keep).map((r) => r.email).join('\n'));
  });
};

function senderOption(s) {
  const region = s.region ? ` · ${esc(s.region)}` : '';
  const status = s.verified ? '' : ' (unverified)';
  return `<option value="${s.id}" data-kind="${esc(s.kind)}">${esc(s.label)}${region} · ${esc(s.kind)}${status}</option>`;
}

async function fillSenderSelect(id, preferred) {
  const el = $(id);
  if (!el) return [];
  const current = preferred || el.value;
  const senders = await api('/api/senders');
  if (!senders.length) {
    el.innerHTML = '<option value="">No senders yet — add one under Senders</option>';
    return senders;
  }
  el.innerHTML = senders.map(senderOption).join('');
  const ids = new Set(senders.map((s) => String(s.id)));
  const verified = senders.filter((s) => s.verified);
  const pick = ids.has(String(current)) ? current : String(verified[0]?.id || senders[0].id);
  el.value = pick;
  return senders;
}

views.compose = async () => {
  const [senders, letters, ai, lists] = await Promise.all([
    api('/api/senders'),
    api('/api/letters'),
    api('/api/ai/status'),
    api('/api/lists'),
  ]);
  view(`<div class="page-head"><h1>Compose &amp; send</h1></div>
    <p class="sub">Paste recipients, pick a letter, merge placeholders, then queue the send from a sender you own. New senders show up here immediately — click Refresh if you just added one.</p>
    <div class="compose">
      <div>
        <form id="compose-form">
          <div class="form-grid">
            <div class="field"><label>Campaign name</label><input id="c-name" placeholder="August invoice batch"></div>
            <div class="field"><label>Sender</label>
              <div class="sender-pick">
                <select id="c-sender"></select>
                <button type="button" class="secondary tiny" id="c-sender-refresh">Refresh</button>
              </div>
              <p class="muted small" id="c-sender-hint"></p>
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
            <button type="button" class="secondary" id="c-wrap-links">Shorten URLs in HTML</button>
          </div>
        </form>
      </div>
      <div class="preview-wrap">
        <header><span>Live preview</span><span class="small" id="pv-count"></span></header>
        <div class="preview-meta" id="pv-subject">Subject —</div>
        <iframe id="pv-frame" class="preview-frame" sandbox="allow-same-origin" title="Email preview"></iframe>
      </div>
    </div>`);

  await fillSenderSelect('c-sender');
  $('c-sender-hint').textContent = senders.length
    ? `${senders.length} sender(s). Pick one — unverified identities are checked when you queue.`
    : 'Add a sender under Senders, then click Refresh.';
  $('c-sender-refresh').addEventListener('click', async () => {
    try {
      const rows = await fillSenderSelect('c-sender');
      $('c-sender-hint').textContent = rows.length ? `${rows.length} sender(s) loaded.` : 'No senders yet.';
      toast(rows.length ? `Loaded ${rows.length} sender(s)` : 'No senders yet');
    } catch (err) { toast(err.message, 'err'); }
  });
  $('c-sender').addEventListener('focus', () => { fillSenderSelect('c-sender').catch(() => {}); });

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
  $('c-wrap-links').addEventListener('click', async () => {
    try {
      const r = await api('/api/links/wrap-html', { method: 'POST', body: { html: $('c-html').value, mode: 'redirect' } });
      $('c-html').value = r.html;
      toast(`Wrapped ${r.created.length} link(s)`);
      refreshPreview();
    } catch (err) { toast(err.message, 'err'); }
  });
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
          sender_id: $('c-sender').value ? parseInt($('c-sender').value, 10) : null,
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
  const apiKinds = new Set(['mailgun', 'sendgrid', 'aws']);
  const regionKinds = new Set(['mailgun', 'aws', 'gcp']);
  view(`<div class="page-head"><h1>Senders</h1></div>
    <p class="sub">Mailboxes and ESP accounts you own: SMTP, Google Cloud (us-east4), Mailgun, SendGrid, Postfix, AWS SES, OVH, webmail, Japan hosts. Credentials stay on this server.</p>
    <div class="notice">Microsoft 365 tenant (Graph app + SMTP AUTH) lives under <a data-go="office365">Office 365</a>. Google Cloud uses <b>smtp-relay.gmail.com</b> in us-east4 (or Gmail SMTP). Mailgun / SendGrid / AWS send through <b>your</b> verified domain — not a shared relay.</div>
    <div class="kind-tabs" id="kind-tabs">
      ${presets.kinds.map((k) => `<button type="button" data-kind="${k.id}">${esc(k.label)}</button>`).join('')}
    </div>
    <p class="muted small" id="kind-blurb"></p>
    <form id="sender-form" class="form-grid">
      <div class="field"><label>Preset</label><select name="preset" id="preset-sel"></select></div>
      <div class="field hidden" id="s-mode-wrap">
        <label>Connection</label>
        <select name="auth_mode" id="s-auth">
          <option value="smtp">SMTP</option>
          <option value="api">HTTP API</option>
        </select>
      </div>
      <div class="field hidden" id="s-region-wrap">
        <label>Region</label>
        <select name="region" id="s-region"></select>
      </div>
      <div class="field"><label>Label</label><input name="label" required placeholder="Billing mailbox"></div>
      <div class="field"><label>From email</label><input name="from_email" type="email" required placeholder="hello@yourdomain.com"></div>
      <div class="field"><label>From name</label><input name="from_name" placeholder="Your Company"></div>
      <div class="field" id="s-host-wrap"><label id="s-host-label">SMTP host</label><input name="host" id="s-host" required placeholder="smtp.yourprovider.com"></div>
      <div class="field" id="s-port-wrap"><label>Port</label><input name="port" id="s-port" type="number" value="587"></div>
      <div class="field" id="s-secure-wrap"><label>Secure (TLS on connect)</label>
        <select name="secure" id="s-secure"><option value="false">No (STARTTLS 587)</option><option value="true">Yes (465)</option></select>
      </div>
      <div class="field"><label id="s-user-label">Username</label><input name="username" id="s-user" required placeholder="usually the full email"></div>
      <div class="field"><label id="s-pass-label">Password / app password</label><input name="password" id="s-pass" type="password" required></div>
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
  let applyingPreset = false;

  function fillRegions() {
    const sel = $('s-region');
    if (kind === 'mailgun') {
      sel.innerHTML = (presets.mailgun_regions || []).map((r) => `<option value="${esc(r.id)}">${esc(r.label)}</option>`).join('');
    } else if (kind === 'aws') {
      sel.innerHTML = (presets.aws_regions || []).map((r) => `<option value="${esc(r)}">${esc(r)}</option>`).join('');
    } else if (kind === 'gcp') {
      sel.innerHTML = (presets.gcp_regions || []).map((r) => `<option value="${esc(r.id)}">${esc(r.label)}</option>`).join('');
      sel.value = 'us-east4';
    } else {
      sel.innerHTML = '';
    }
  }

  function applyRegionHost() {
    if (applyingPreset) return;
    const mode = $('s-auth').value;
    const region = $('s-region').value;
    if (kind === 'mailgun') {
      const r = (presets.mailgun_regions || []).find((x) => x.id === region) || presets.mailgun_regions?.[0];
      if (!r) return;
      $('s-host').value = mode === 'api' ? r.apiHost : r.smtpHost;
      if (mode === 'api') { $('s-port').value = 443; $('s-secure').value = 'true'; }
      else if (!$('s-port').value) $('s-port').value = 587;
    }
    if (kind === 'aws' && region) {
      $('s-host').value = mode === 'api' ? `email.${region}.amazonaws.com` : `email-smtp.${region}.amazonaws.com`;
      if (mode === 'api') { $('s-port').value = 443; $('s-secure').value = 'true'; }
      else { $('s-port').value = $('s-port').value || 587; $('s-secure').value = 'false'; }
    }
    if (kind === 'sendgrid') {
      $('s-host').value = mode === 'api' ? 'api.sendgrid.com' : 'smtp.sendgrid.net';
      if (mode === 'api') { $('s-port').value = 443; $('s-secure').value = 'true'; }
      else { $('s-port').value = 587; $('s-secure').value = 'false'; }
      if (!$('s-user').value) $('s-user').value = 'apikey';
    }
  }

  function syncModeFields() {
    const mode = $('s-auth').value;
    const isApi = apiKinds.has(kind) && mode === 'api';
    const isPostfix = kind === 'postfix';
    const authOptional = isPostfix || kind === 'gcp';
    $('s-host').required = !isApi && kind !== 'office365';
    $('s-user').required = !authOptional && !(kind === 'sendgrid' && isApi);
    $('s-pass').required = !authOptional;
    $('s-host-wrap').classList.toggle('hidden', isApi);
    $('s-port-wrap').classList.toggle('hidden', isApi);
    $('s-secure-wrap').classList.toggle('hidden', isApi);
    if (isPostfix) {
      $('s-user-label').textContent = 'Username (optional)';
      $('s-pass-label').textContent = 'Password (optional)';
      $('s-user').placeholder = 'leave blank if IP-allowlisted';
      $('s-host-label').textContent = 'Postfix host';
      $('s-host').placeholder = 'mail.yourdomain.com';
    } else if (kind === 'gcp') {
      $('s-user-label').textContent = 'Username (optional if IP allowlisted)';
      $('s-pass-label').textContent = 'App password (optional if IP allowlisted)';
      $('s-user').placeholder = 'you@yourdomain.com';
      $('s-host-label').textContent = 'SMTP host';
      $('s-host').placeholder = 'smtp-relay.gmail.com';
    } else if (kind === 'mailgun' && isApi) {
      $('s-user-label').textContent = 'Sending domain';
      $('s-pass-label').textContent = 'Mailgun API key';
      $('s-user').placeholder = 'mg.yourdomain.com';
    } else if (kind === 'mailgun') {
      $('s-user-label').textContent = 'SMTP username';
      $('s-pass-label').textContent = 'SMTP password';
      $('s-user').placeholder = 'postmaster@yourdomain.com';
      $('s-host-label').textContent = 'SMTP host';
    } else if (kind === 'sendgrid' && isApi) {
      $('s-user-label').textContent = 'Username (optional)';
      $('s-pass-label').textContent = 'SendGrid API key';
      $('s-user').placeholder = 'apikey';
    } else if (kind === 'sendgrid') {
      $('s-user-label').textContent = 'SMTP username';
      $('s-pass-label').textContent = 'API key (password)';
      $('s-user').placeholder = 'apikey';
      $('s-host-label').textContent = 'SMTP host';
    } else if (kind === 'aws' && isApi) {
      $('s-user-label').textContent = 'Access key ID';
      $('s-pass-label').textContent = 'Secret access key';
      $('s-user').placeholder = 'AKIA…';
    } else if (kind === 'aws') {
      $('s-user-label').textContent = 'SES SMTP username';
      $('s-pass-label').textContent = 'SES SMTP password';
      $('s-user').placeholder = 'from SES console SMTP credentials';
      $('s-host-label').textContent = 'SMTP host';
    } else {
      $('s-user-label').textContent = 'Username';
      $('s-pass-label').textContent = 'Password / app password';
      $('s-user').placeholder = 'usually the full email';
      $('s-host-label').textContent = 'SMTP host';
      $('s-host').placeholder = 'smtp.yourprovider.com';
    }
    applyRegionHost();
  }

  function applyKind() {
    $('s-kind').value = kind;
    $('kind-tabs').querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.kind === kind));
    const meta = presets.kinds.find((k) => k.id === kind);
    $('kind-blurb').textContent = meta ? meta.blurb : '';
    const opts = presets.presets.filter((p) => p.kind === kind);
    $('preset-sel').innerHTML = opts.map((p) => `<option value="${p.id}">${esc(p.label)}</option>`).join('');
    $('sms-gw-wrap').classList.toggle('hidden', kind !== 'smtp_sms');
    $('s-mode-wrap').classList.toggle('hidden', !apiKinds.has(kind));
    $('s-region-wrap').classList.toggle('hidden', !regionKinds.has(kind));
    fillRegions();
    applyPreset();
    const label = document.querySelector('#sender-form [name=label]');
    if (kind === 'gcp' && label && !label.value) {
      label.placeholder = 'Google Cloud (us-east4)';
      label.value = 'Google Cloud (us-east4)';
    }
  }

  function applyPreset() {
    const p = presets.presets.find((x) => x.id === $('preset-sel').value);
    if (!p) return;
    applyingPreset = true;
    if (p.auth_mode) $('s-auth').value = p.auth_mode;
    else if (apiKinds.has(kind)) $('s-auth').value = 'smtp';
    if (p.host) $('s-host').value = p.host;
    else if (kind === 'postfix') $('s-host').value = '';
    $('s-port').value = p.port;
    $('s-secure').value = p.secure ? 'true' : 'false';
    if (p.username) $('s-user').value = p.username;
    $('preset-hint').textContent = p.hint || '';
    applyingPreset = false;
    syncModeFields();
  }

  $('kind-tabs').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { kind = b.dataset.kind; applyKind(); }));
  $('preset-sel').addEventListener('change', applyPreset);
  $('s-auth').addEventListener('change', () => {
    const mode = $('s-auth').value;
    const match = presets.presets.find((p) => p.kind === kind && p.auth_mode === mode);
    if (match) $('preset-sel').value = match.id;
    syncModeFields();
  });
  $('s-region').addEventListener('change', applyRegionHost);
  $('sms-gw-sel').addEventListener('change', () => { if ($('sms-gw-sel').value) $('sms-gw').value = $('sms-gw-sel').value; });
  applyKind();

  document.querySelector('[data-go="office365"]')?.addEventListener('click', () => go('office365'));

  $('sender-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target; const b = Object.fromEntries(new FormData(f));
    b.secure = b.secure === 'true'; b.port = parseInt(b.port, 10) || (b.auth_mode === 'api' ? 443 : 587);
    try {
      const created = await api('/api/senders', { method: 'POST', body: b });
      f.reset();
      if (created.verified) toast('Sender added and verified — pick it in Compose');
      else toast(created.verify_error ? `Saved. Verify failed: ${created.verify_error}` : 'Sender added — click Verify, then Compose');
      views.senders();
    }
    catch (err) { toast(err.message, 'err'); }
  });
  const rows = await api('/api/senders');
  $('sender-table').innerHTML = `<tr><th>Label</th><th>Type</th><th>From</th><th>Host</th><th>Status</th><th></th></tr>` +
    (rows.map((s) => `<tr>
      <td>${esc(s.label)}</td><td>${badge(s.kind)}${s.auth_mode ? ` ${badge(s.auth_mode)}` : ''}</td>
      <td>${esc(s.from_name)} &lt;${esc(s.from_email)}&gt;</td>
      <td class="mono small">${esc(s.host)}${s.port ? ':' + s.port : ''}${s.region ? `<div class="muted">${esc(s.region)}</div>` : ''}${s.sms_gateway ? `<div class="muted">${esc(s.sms_gateway)}</div>` : ''}</td>
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
      <div class="field"><label>Sender identity</label><select name="sender_id" id="camp-sender"></select></div>
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
  await fillSenderSelect('camp-sender');
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
  const cur = currentTheme();
  const lic = state.user.license || {};
  view(`<div class="page-head"><h1>Account</h1></div>
    <p class="sub">${esc(state.user.email)} · role ${esc(state.user.role)}</p>
    <div class="notice">
      <b>License</b> ${badge(lic.ok ? (lic.plan || 'lifetime') : 'expired')} ${esc(lic.label || '')}
      ${lic.expires_at ? `<div class="muted small">Expires ${esc(String(lic.expires_at).replace('T', ' ').slice(0, 16))} UTC</div>` : '<div class="muted small">No expiry</div>'}
      ${lic.ok ? '' : '<div>This account cannot send until an admin renews the license (3-day, monthly, or lifetime).</div>'}
    </div>
    <h2>Theme</h2>
    <p class="muted small">Saved in this browser. Phoenix is the default dark-red look.</p>
    <div class="theme-grid" id="theme-grid">
      ${THEMES.map((t) => `<button type="button" class="theme-card${t.id === cur.id ? ' active' : ''}" data-theme-id="${t.id}">
        <div class="theme-swatch" style="background:linear-gradient(135deg, ${t.a}, ${t.b})"></div>
        <b>${esc(t.label)}</b>
        <div class="muted small">${esc(t.tag)}</div>
      </button>`).join('')}
    </div>
    <h2>Change password</h2>
    <form id="pw-form" class="form-grid" style="max-width:520px">
      <div class="field full"><label>Current password</label><input name="current" type="password" required></div>
      <div class="field full"><label>New password (min 8)</label><input name="next" type="password" required></div>
      <div class="actions full"><button type="submit">Update password</button></div>
    </form>`);
  $('theme-grid').querySelectorAll('[data-theme-id]').forEach((b) => {
    b.addEventListener('click', () => applyTheme(b.dataset.themeId));
  });
  $('pw-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/api/auth/change-password', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
      e.target.reset(); toast('Password updated');
    } catch (err) { toast(err.message, 'err'); }
  });
};

views.admin = async () => {
  const data = await api('/api/admin/overview');
  const s = data.summary;
  const settings = data.settings || {};
  const pct = (used, cap) => Math.min(100, Math.round((used / Math.max(cap || 1, 1)) * 100));
  view(`<div class="admin-hero">
      <div>
        <p class="brand-tag">OPERATOR // COMMAND</p>
        <h1>Admin dashboard</h1>
        <p class="sub">Control every client: licenses, tools they can see, sending kill-switch, and live traffic.</p>
      </div>
      <button class="secondary" id="admin-refresh">Refresh</button>
    </div>
    <div class="cards admin-kpis">
      <div class="card"><div class="stat">${s.clients}</div><div class="stat-label">Clients</div></div>
      <div class="card"><div class="stat">${s.license_ok}</div><div class="stat-label">Licenses live</div></div>
      <div class="card"><div class="stat">${s.expired}</div><div class="stat-label">Expired / locked</div></div>
      <div class="card"><div class="stat">${s.today}</div><div class="stat-label">Sends last 24h</div></div>
      <div class="card"><div class="stat">${s.queued}</div><div class="stat-label">Queued</div></div>
      <div class="card"><div class="stat">${s.failed}</div><div class="stat-label">Failed</div></div>
    </div>

    <div class="admin-grid">
      <section class="card admin-panel">
        <h2>Issue a client license</h2>
        <form id="admin-create" class="form-grid">
          <div class="field"><label>Email</label><input name="email" type="email" required placeholder="client@brand.com"></div>
          <div class="field"><label>Password</label><input name="password" type="password" required minlength="8"></div>
          <div class="field"><label>License</label>
            <select name="license_plan">
              <option value="3day">3-day</option>
              <option value="monthly" selected>Monthly</option>
              <option value="lifetime">Lifetime</option>
            </select>
          </div>
          <div class="field"><label>Daily quota</label><input name="daily_quota" type="number" placeholder="plan default"></div>
          <div class="actions full"><button type="submit">Create client</button></div>
        </form>
      </section>
      <section class="card admin-panel">
        <h2>Operator controls</h2>
        <p class="muted small">These hit every client account at once.</p>
        <div class="field"><label>Banner shown in every client panel</label>
          <input id="ops-banner-input" value="${esc(settings.banner || '')}" placeholder="Scheduled maintenance tonight 02:00 UTC">
        </div>
        <div class="check"><input type="checkbox" id="ops-pause" ${settings.pause_sends === '1' ? 'checked' : ''}>
          <span>Pause all sending (queue skips until you uncheck)</span></div>
        <div class="check"><input type="checkbox" id="ops-maint" ${settings.maintenance === '1' ? 'checked' : ''}>
          <span>Maintenance mode</span></div>
        <div class="actions"><button type="button" id="ops-save">Save controls</button></div>
        <p class="muted small">Rate ${data.system.rate_per_minute}/min · AI ${data.system.ai ? 'on' : 'off'} · SMS ${data.system.sms ? 'on' : 'off'}</p>
      </section>
    </div>

    <div class="admin-toolbar">
      <h2>Clients — licenses, usage, tools</h2>
      <input id="admin-search" type="search" placeholder="Search email or notes">
    </div>
    <p class="muted small">Toggle the tools each client can see. Unchecked items disappear from their sidebar and API. Presets apply a whole kit at once.</p>
    <div id="admin-clients"></div>

    <h2>Live traffic</h2>
    <table id="admin-traffic"></table>

    <h2>Operator log</h2>
    <table id="admin-events"></table>`);

  $('admin-refresh').addEventListener('click', () => views.admin());
  $('admin-create').addEventListener('submit', async (e) => {
    e.preventDefault();
    const b = Object.fromEntries(new FormData(e.target));
    if (b.daily_quota) b.daily_quota = parseInt(b.daily_quota, 10); else delete b.daily_quota;
    b.role = 'user';
    try { await api('/api/users', { method: 'POST', body: b }); toast('Client created'); views.admin(); }
    catch (err) { toast(err.message, 'err'); }
  });
  $('ops-save').addEventListener('click', async () => {
    try {
      const settings = await api('/api/admin/settings', {
        method: 'PATCH',
        body: {
          banner: $('ops-banner-input').value,
          pause_sends: $('ops-pause').checked,
          maintenance: $('ops-maint').checked,
        },
      });
      state.user.banner = settings.banner;
      state.user.pause_sends = settings.pause_sends === '1';
      state.user.maintenance = settings.maintenance === '1';
      renderNav();
      toast('Operator controls saved');
    } catch (err) { toast(err.message, 'err'); }
  });

  const featList = data.features || [];
  const presets = data.presets || [];
  const presetOpts = presets.map((p) => `<option value="${esc(p.id)}">${esc(p.label)}</option>`).join('');

  function bindClients() {
    $('admin-clients').querySelectorAll('[data-feat]').forEach((box) => {
      box.addEventListener('change', async () => {
        const id = box.dataset.feat;
        const payload = {};
        $('admin-clients').querySelectorAll(`[data-feat="${id}"]`).forEach((el) => { payload[el.dataset.key] = el.checked; });
        try { await api(`/api/admin/clients/${id}/features`, { method: 'PATCH', body: payload }); toast('Client tools updated'); }
        catch (err) { toast(err.message, 'err'); box.checked = !box.checked; }
      });
    });
    $('admin-clients').querySelectorAll('[data-preset]').forEach((sel) => {
      sel.addEventListener('change', async () => {
        if (!sel.value) return;
        try {
          await api(`/api/admin/clients/${sel.dataset.preset}/features`, { method: 'PATCH', body: { preset: sel.value } });
          toast('Preset applied');
          views.admin();
        } catch (err) { toast(err.message, 'err'); sel.value = ''; }
      });
    });
    $('admin-clients').querySelectorAll('[data-quota]').forEach((inp) => {
      inp.addEventListener('change', async () => {
        const n = parseInt(inp.value, 10);
        if (!Number.isFinite(n) || n < 0) return;
        try { await api(`/api/users/${inp.dataset.quota}`, { method: 'PATCH', body: { daily_quota: n } }); toast('Quota saved'); }
        catch (err) { toast(err.message, 'err'); }
      });
    });
    $('admin-clients').querySelectorAll('[data-notes]').forEach((ta) => {
      ta.addEventListener('change', async () => {
        try { await api(`/api/users/${ta.dataset.notes}`, { method: 'PATCH', body: { notes: ta.value } }); toast('Notes saved'); }
        catch (err) { toast(err.message, 'err'); }
      });
    });
    $('admin-clients').querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', async () => {
      const text = `Freedom Mailer\nSign in: ${location.origin}\nEmail: ${b.dataset.copy}\nAsk the operator for the password.`;
      try { await navigator.clipboard.writeText(text); toast('Invite copied'); }
      catch { toast(text); }
    }));
    $('admin-clients').querySelectorAll('[data-lic]').forEach((b) => b.addEventListener('click', async () => {
      try {
        await api(`/api/users/${b.dataset.lic}`, {
          method: 'PATCH',
          body: { license_plan: b.dataset.plan, license_action: b.dataset.plan === 'lifetime' ? 'set' : 'extend' },
        });
        toast('License updated'); views.admin();
      } catch (err) { toast(err.message, 'err'); }
    }));
    $('admin-clients').querySelectorAll('[data-t]').forEach((b) => b.addEventListener('click', async () => {
      await api(`/api/users/${b.dataset.t}`, { method: 'PATCH', body: { active: b.dataset.a === '0' } }); views.admin();
    }));
    $('admin-clients').querySelectorAll('[data-pw]').forEach((b) => b.addEventListener('click', async () => {
      const next = prompt('New password (min 8 characters)');
      if (!next) return;
      try { await api(`/api/users/${b.dataset.pw}`, { method: 'PATCH', body: { password: next } }); toast('Password reset'); }
      catch (err) { toast(err.message, 'err'); }
    }));
    $('admin-clients').querySelectorAll('[data-d]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('Delete this client and all their data?')) return;
      await api(`/api/users/${b.dataset.d}`, { method: 'DELETE' }); views.admin();
    }));
  }

  function renderClients(filter = '') {
    const q = filter.trim().toLowerCase();
    const rows = (data.users || []).filter((u) => {
      if (!q) return true;
      return `${u.email} ${u.notes || ''} ${u.license_plan || ''}`.toLowerCase().includes(q);
    });
    $('admin-clients').innerHTML = rows.map((u) => {
      const lic = u.license || {};
      const bar = pct(u.usage_today || 0, u.daily_quota);
      const exp = u.license_expires_at ? String(u.license_expires_at).replace('T', ' ').slice(0, 16) : 'lifetime';
      const you = u.id === state.user.id;
      const last = u.last_login ? String(u.last_login).replace('T', ' ').slice(0, 16) : 'never signed in';
      const toggles = featList.map((f) => {
        const on = u.role === 'admin' || u.features?.[f.id] !== false;
        return `<label class="feat-toggle ${u.role === 'admin' ? 'locked' : ''}">
          <input type="checkbox" data-feat="${u.id}" data-key="${f.id}" ${on ? 'checked' : ''} ${u.role === 'admin' ? 'disabled' : ''}>
          ${esc(f.label)}</label>`;
      }).join('');
      return `<article class="client-card" data-client="${u.id}">
        <header>
          <div>
            <b>${esc(u.email)}</b>
            ${badge(u.role === 'admin' ? 'verified' : 'pending')} ${esc(u.role)}
            ${badge(lic.ok ? (u.license_plan || 'lifetime') : 'expired')} ${esc(lic.label || '')}
            ${u.active ? '' : badge('expired') + ' disabled'}
          </div>
          <div class="muted small">${esc(exp)}${exp === 'lifetime' ? '' : ' UTC'} · last login ${esc(last)}</div>
        </header>
        <div class="usage-bar"><span style="width:${bar}%"></span></div>
        <div class="muted small">${u.usage_today || 0} / ${u.daily_quota} today · ${u.sent || 0} sent · ${u.queued || 0} queued · ${u.failed || 0} failed · ${u.senders || 0} senders · ${u.lists || 0} lists</div>
        ${you ? '' : `<div class="feat-toolbar">
          <select data-preset="${u.id}"><option value="">Tool preset…</option>${presetOpts}</select>
          <label class="quota-edit">Quota/day <input type="number" min="0" data-quota="${u.id}" value="${u.daily_quota}"></label>
        </div>`}
        <div class="feat-row">${toggles}</div>
        <label class="notes-label">Operator notes
          <textarea rows="2" data-notes="${u.id}" placeholder="Internal notes (client never sees this)">${esc(u.notes || '')}</textarea>
        </label>
        <div class="row client-actions">
          ${you ? '<span class="muted small">you</span>' : `
          <button class="tiny secondary" data-copy="${esc(u.email)}">Copy invite</button>
          <button class="tiny secondary" data-lic="${u.id}" data-plan="3day">+3 days</button>
          <button class="tiny secondary" data-lic="${u.id}" data-plan="monthly">+1 month</button>
          <button class="tiny secondary" data-lic="${u.id}" data-plan="lifetime">Lifetime</button>
          <button class="tiny secondary" data-t="${u.id}" data-a="${u.active ? 1 : 0}">${u.active ? 'Disable' : 'Enable'}</button>
          <button class="tiny secondary" data-pw="${u.id}">Reset password</button>
          <button class="tiny danger" data-d="${u.id}">Delete</button>`}
        </div>
      </article>`;
    }).join('') || `<p class="muted">${q ? 'No matching clients.' : 'No clients yet.'}</p>`;
    bindClients();
  }

  renderClients();
  $('admin-search').addEventListener('input', (e) => renderClients(e.target.value));

  $('admin-traffic').innerHTML = `<tr><th>When</th><th>Client</th><th>To</th><th>Subject</th><th>Status</th></tr>` +
    ((data.recent || []).map((m) => `<tr>
      <td class="muted small">${esc(m.created_at)}</td>
      <td>${esc(m.user_email)}</td>
      <td class="mono small">${esc(m.to_address)}</td>
      <td>${esc(m.subject || '')}</td>
      <td>${badge(m.status)}</td></tr>`).join('') || `<tr><td colspan="5" class="muted">No traffic yet.</td></tr>`);

  $('admin-events').innerHTML = `<tr><th>When</th><th>Operator</th><th>Action</th><th>Client</th><th>Detail</th></tr>` +
    ((data.events || []).map((ev) => `<tr>
      <td class="muted small">${esc(ev.created_at)}</td>
      <td>${esc(ev.admin_email || '')}</td>
      <td>${esc(ev.action)}</td>
      <td>${esc(ev.target_email || '')}</td>
      <td class="muted small">${esc(ev.detail || '')}</td></tr>`).join('') || `<tr><td colspan="5" class="muted">No operator actions yet.</td></tr>`);
};

views.users = async () => {
  view(`<div class="page-head"><h1>Users &amp; licenses</h1></div>
    <p class="sub">You are the operator. Create accounts and issue a <b>3-day</b>, <b>monthly</b>, or <b>lifetime</b> license. Expired users cannot sign in or send.</p>
    <form id="u-form" class="form-grid">
      <div class="field"><label>Email</label><input name="email" type="email" required placeholder="user@example.com"></div>
      <div class="field"><label>Password</label><input name="password" type="password" required minlength="8" placeholder="min 8 characters"></div>
      <div class="field"><label>License</label>
        <select name="license_plan">
          <option value="3day">3-day</option>
          <option value="monthly">Monthly (30 days)</option>
          <option value="lifetime">Lifetime</option>
        </select>
      </div>
      <div class="field"><label>Role</label><select name="role"><option value="user">user</option><option value="admin">admin</option></select></div>
      <div class="field"><label>Daily quota (optional)</label><input name="daily_quota" type="number" placeholder="plan default"></div>
      <div class="actions full"><button type="submit">Create licensed user</button></div>
    </form>
    <table id="u-table"></table>`);
  $('u-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const b = Object.fromEntries(new FormData(e.target));
    if (b.daily_quota) b.daily_quota = parseInt(b.daily_quota, 10);
    else delete b.daily_quota;
    try { await api('/api/users', { method: 'POST', body: b }); e.target.reset(); toast('User created'); views.users(); }
    catch (err) { toast(err.message, 'err'); }
  });
  const rows = await api('/api/users');
  $('u-table').innerHTML = `<tr><th>Email</th><th>Role</th><th>License</th><th>Quota/day</th><th>Active</th><th></th></tr>` +
    (rows.map((u) => {
      const lic = u.license || {};
      const exp = u.license_expires_at ? String(u.license_expires_at).replace('T', ' ').slice(0, 16) : '—';
      return `<tr>
      <td>${esc(u.email)}</td>
      <td>${badge(u.role === 'admin' ? 'verified' : 'pending')} ${esc(u.role)}</td>
      <td>${badge(lic.ok ? (u.license_plan || 'lifetime') : 'expired')} ${esc(lic.label || '')}
        <div class="muted small">${esc(exp)}${exp !== '—' ? ' UTC' : ''}</div></td>
      <td>${u.daily_quota}</td>
      <td>${u.active ? '✓' : '—'}</td>
      <td>${u.id !== state.user.id ? `
        <button class="tiny secondary" data-lic="${u.id}" data-plan="3day">+3 days</button>
        <button class="tiny secondary" data-lic="${u.id}" data-plan="monthly">+1 month</button>
        <button class="tiny secondary" data-lic="${u.id}" data-plan="lifetime">Lifetime</button>
        <button class="tiny secondary" data-t="${u.id}" data-a="${u.active ? 1 : 0}">${u.active ? 'Disable' : 'Enable'}</button>
        <button class="tiny danger" data-d="${u.id}">Delete</button>` : '<span class="muted small">you</span>'}</td></tr>`;
    }).join(''));
  $('u-table').querySelectorAll('[data-lic]').forEach((b) => b.addEventListener('click', async () => {
    try {
      await api(`/api/users/${b.dataset.lic}`, {
        method: 'PATCH',
        body: { license_plan: b.dataset.plan, license_action: b.dataset.plan === 'lifetime' ? 'set' : 'extend' },
      });
      toast('License updated');
      views.users();
    } catch (err) { toast(err.message, 'err'); }
  }));
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
