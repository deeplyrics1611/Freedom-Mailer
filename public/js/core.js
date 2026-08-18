// Shared state, API client and UI building blocks for the panel.

export const state = {
  token: localStorage.getItem('fm_token') || null,
  user: null,
  route: 'dashboard',
};

export const $ = (id) => document.getElementById(id);
export const esc = (s) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const res = await fetch(path, {
    ...opts,
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 401) {
    logout();
    throw new Error('Session expired');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Error ${res.status}`);
    err.data = data;
    throw err;
  }
  return data;
}

export function download(path, filename) {
  fetch(path, { headers: state.token ? { Authorization: `Bearer ${state.token}` } : {} })
    .then((r) => r.blob())
    .then((blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    });
}

let toastTimer;
export function toast(msg, kind = 'ok') {
  const t = $('toast');
  t.textContent = msg;
  t.className = `toast ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), kind === 'err' ? 6000 : 3200);
}

export function logout() {
  state.token = null;
  state.user = null;
  localStorage.removeItem('fm_token');
  $('app').classList.add('hidden');
  $('login').classList.remove('hidden');
}

export const view = (html) => {
  $('view').innerHTML = html;
};

export const badge = (status) => {
  const map = {
    sent: 'ok', confirmed: 'ok', verified: 'ok', valid: 'ok', done: 'ok', ok: 'ok', inbox: 'ok',
    queued: 'warn', pending: 'warn', sending: 'warn', running: 'warn', risky: 'warn',
    catch_all: 'warn', unknown: 'warn', promotions: 'warn', greylisted: 'warn',
    draft: 'muted', skipped: 'muted', unsubscribed: 'muted', unchecked: 'muted', cancelled: 'muted',
    failed: 'err', invalid: 'err', spam: 'err', missing: 'err',
  };
  return `<span class="badge ${map[status] || 'muted'}">${esc(String(status).replace(/_/g, ' '))}</span>`;
};

// ---- Shared components ------------------------------------------------------

/** Big score readout. `max` is 10 for content/link scores, 100 for domain scores. */
export function scoreCard(score, max, verdict, label) {
  const pct = Math.round((score / max) * 100);
  const tone = pct >= 85 ? 'ok' : pct >= 60 ? 'warn' : 'err';
  return `<div class="score-card ${tone}">
    <div class="score-value">${score}<span class="score-max">/${max}</span></div>
    <div class="score-meta">
      <div class="score-verdict">${esc(verdict || '')}</div>
      <div class="muted small">${esc(label || '')}</div>
      <div class="score-bar"><div class="score-fill" style="width:${pct}%"></div></div>
    </div>
  </div>`;
}

const SEVERITY_ICON = { critical: '✕', warning: '!', info: 'i', pass: '✓' };

/**
 * Render an ordered list of findings. Each entry may carry `points` or `weight`
 * (the score cost), a `detail` explaining why it matters, and a `fix`.
 */
export function findingsList(findings, { hidePasses = false } = {}) {
  const items = (findings || []).filter((f) => (hidePasses ? f.severity !== 'pass' : true));
  if (!items.length) return '<p class="muted">Nothing to report.</p>';
  return `<ul class="findings">${items
    .map((f) => {
      const cost = f.points ?? f.weight ?? 0;
      return `<li class="finding ${f.severity}">
      <span class="finding-icon">${SEVERITY_ICON[f.severity] || '·'}</span>
      <div class="finding-body">
        <div class="finding-title">${esc(f.title)}${cost > 0 ? `<span class="finding-cost">−${cost}</span>` : ''}</div>
        ${f.detail ? `<div class="finding-detail">${esc(f.detail)}</div>` : ''}
        ${f.fix ? `<div class="finding-fix"><b>Fix:</b> ${esc(f.fix)}</div>` : ''}
      </div>
    </li>`;
    })
    .join('')}</ul>`;
}

export function countsRow(counts) {
  const order = ['critical', 'warning', 'info', 'pass'];
  return `<div class="chips">${order
    .filter((k) => counts[k])
    .map((k) => `<span class="chip ${k}">${counts[k]} ${k}</span>`)
    .join('')}</div>`;
}

export function progress(value, total) {
  const pct = total ? Math.min(100, Math.round((value / total) * 100)) : 0;
  return `<div class="progress"><div class="progress-fill" style="width:${pct}%"></div>
    <span class="progress-label">${value} / ${total}</span></div>`;
}

export const kv = (label, value) =>
  `<div class="kv"><span class="kv-label">${esc(label)}</span><span class="kv-value">${value}</span></div>`;

/** Tabs whose panels are already in the DOM, identified by data-panel. */
export function wireTabs(container) {
  const root = typeof container === 'string' ? $(container) : container;
  if (!root) return;
  root.querySelectorAll('[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      root.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('active', b === btn));
      const scope = root.closest('.tab-scope') || document;
      scope.querySelectorAll('[data-panel]').forEach((p) => {
        p.classList.toggle('hidden', p.dataset.panel !== btn.dataset.tab);
      });
    });
  });
}

export function busy(button, isBusy, label) {
  if (!button) return;
  if (isBusy) {
    button.dataset.label = button.textContent;
    button.textContent = label || 'Working…';
    button.disabled = true;
  } else {
    button.textContent = button.dataset.label || button.textContent;
    button.disabled = false;
  }
}

export const fmtDate = (s) => esc(String(s || '').replace('T', ' ').slice(0, 16));

export const pct = (n) => (n === null || n === undefined ? '—' : `${n}%`);
