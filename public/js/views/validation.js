import { api, $, esc, view, badge, toast, busy, progress, download, fmtDate, kv } from '../core.js';

let pollTimer = null;

const STATUS_MEANING = {
  valid: 'The receiving server confirmed this mailbox exists.',
  invalid: 'Do not send. The address cannot receive mail.',
  risky: 'Deliverable, but likely to generate complaints or bounces.',
  catch_all: 'The domain accepts mail for every address, so the mailbox may or may not exist.',
  unknown: 'The server would not give a usable answer. Not a verdict either way.',
  unchecked: 'Not validated yet.',
};

export async function validationView() {
  clearInterval(pollTimer);

  view(`<div class="page-head"><h1>Lead validation</h1></div>
    <p class="sub">Check addresses before they go into a campaign. Bounces are what destroy a sending
      reputation, and they are the one problem that is entirely preventable.</p>

    <div id="capability"></div>

    <div class="tab-scope">
      <div class="tabs" id="v-tabs">
        <button data-tab="single" class="active">Single address</button>
        <button data-tab="bulk">Bulk check</button>
        <button data-tab="jobs">Jobs &amp; results</button>
      </div>

      <div data-panel="single">
        <form id="single-form" class="row">
          <div class="field" style="min-width:320px"><label>Email address</label>
            <input name="email" required placeholder="buyer@company.com"></div>
          <button type="submit">Check</button>
        </form>
        <div id="single-result"></div>
      </div>

      <div data-panel="bulk" class="hidden">
        <p class="muted small">Paste addresses one per line, or a CSV with an email column. Up to 50,000 at a time.</p>
        <div class="row" style="margin-bottom:8px">
          <input type="file" id="bulk-file" accept=".csv,.txt" style="width:auto">
          <div class="field" style="flex:1"><label>Job name</label><input id="bulk-name" placeholder="Supplier list — August"></div>
        </div>
        <textarea id="bulk-text" rows="10" class="mono" placeholder="buyer@company.com&#10;sales@supplier.com"></textarea>
        <div class="actions"><button id="bulk-start">Start check</button></div>
      </div>

      <div data-panel="jobs" class="hidden">
        <table id="jobs-table"></table>
        <div id="job-detail"></div>
      </div>
    </div>`);

  $('v-tabs').querySelectorAll('[data-tab]').forEach((btn) =>
    btn.addEventListener('click', () => {
      $('v-tabs').querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('active', b === btn));
      document.querySelectorAll('[data-panel]').forEach((p) => p.classList.toggle('hidden', p.dataset.panel !== btn.dataset.tab));
      if (btn.dataset.tab === 'jobs') loadJobs();
    }));

  renderCapability();

  $('single-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = new FormData(e.target).get('email');
    const btn = e.target.querySelector('button');
    busy(btn, true, 'Checking…');
    $('single-result').innerHTML = '<p class="muted">Querying DNS and the receiving mail server…</p>';
    try {
      const r = await api('/api/validation/single', { method: 'POST', body: { email } });
      renderSingle(r);
    } catch (err) {
      $('single-result').innerHTML = `<div class="notice err-text">${esc(err.message)}</div>`;
    } finally {
      busy(btn, false);
    }
  });

  $('bulk-file').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) file.text().then((t) => { $('bulk-text').value = t; });
  });

  $('bulk-start').addEventListener('click', async (e) => {
    const csv = $('bulk-text').value.trim();
    if (!csv) return toast('Add some addresses first', 'err');
    busy(e.target, true, 'Starting…');
    try {
      const job = await api('/api/validation/bulk', { method: 'POST', body: { csv, name: $('bulk-name').value } });
      toast(`Job #${job.id} started for ${job.total} addresses`);
      $('bulk-text').value = '';
      document.querySelector('[data-tab=jobs]').click();
    } catch (err) {
      toast(err.message, 'err');
    } finally {
      busy(e.target, false);
    }
  });
}

async function renderCapability() {
  const c = await api('/api/validation/capabilities');
  const tone = c.smtp_probe_enabled && c.port_25_reachable ? '' : 'warn-notice';
  $('capability').innerHTML = `<div class="notice ${tone}">
    <b>What this can and cannot determine.</b> ${esc(c.note)}
    <div style="margin-top:6px">${esc(c.accuracy_note)}</div>
  </div>`;
}

function renderSingle(r) {
  const c = r.checks;
  const tone = { valid: 'ok', invalid: 'err', risky: 'warn', catch_all: 'warn', unknown: 'warn' }[r.status] || 'muted';

  $('single-result').innerHTML = `
    <div class="result-head">
      <div class="score-card ${tone}">
        <div class="score-value">${r.score}<span class="score-max">/100</span></div>
        <div class="score-meta">
          <div class="score-verdict">${badge(r.status)}</div>
          <div class="muted small">${esc(STATUS_MEANING[r.status] || '')}</div>
        </div>
      </div>
    </div>
    ${r.notes?.length ? `<ul class="findings">${r.notes.map((n) => `<li class="finding info">
      <span class="finding-icon">i</span><div class="finding-body"><div class="finding-detail">${esc(n)}</div></div></li>`).join('')}</ul>` : ''}
    <div class="kv-grid">
      ${kv('Address', `<span class="mono">${esc(r.email)}</span>`)}
      ${kv('Reason code', `<span class="mono">${esc(r.reason)}</span>`)}
      ${kv('Syntax', c.syntax ? '✓ valid' : '✕ invalid')}
      ${kv('Domain', `<span class="mono">${esc(c.domain || '—')}</span>`)}
      ${kv('MX records', c.mx?.length ? `<span class="mono small">${c.mx.map((m) => esc(m.host)).join('<br>')}</span>` : '✕ none')}
      ${kv('Catch-all domain', c.catch_all === null || c.catch_all === undefined ? 'not determined' : c.catch_all ? 'yes' : 'no')}
      ${kv('Disposable', c.disposable ? '✕ yes' : '✓ no')}
      ${kv('Consumer provider', c.free ? 'yes' : 'no')}
      ${kv('Shared/role mailbox', c.role ? (c.procurement_role ? 'yes — a purchasing address' : 'yes') : 'no')}
      ${c.suggestion ? kv('Did you mean', `<span class="mono">${esc(c.suggestion)}</span>`) : ''}
      ${c.accept_all_provider ? kv('Filtered by', esc(c.accept_all_provider)) : ''}
      ${kv('Took', `${r.ms} ms`)}
    </div>
    ${c.smtp ? `<details class="panel"><summary>SMTP conversation</summary>
      <div class="kv-grid">
        ${kv('Server', `<span class="mono">${esc(c.smtp.host || '')}</span>`)}
        ${kv('Reply code', c.smtp.code || '—')}
        ${kv('Reply', `<span class="mono small">${esc(c.smtp.message || c.smtp.error || '')}</span>`)}
        ${kv('Verdict', esc(c.smtp.verdict || '—'))}
      </div></details>` : ''}`;
}

async function loadJobs() {
  clearInterval(pollTimer);
  const jobs = await api('/api/validation/jobs');

  $('jobs-table').innerHTML =
    `<tr><th>Job</th><th>Status</th><th>Progress</th><th>Breakdown</th><th></th></tr>` +
    (jobs.map((j) => `<tr>
      <td><b>${esc(j.name)}</b><div class="muted small">#${j.id} · ${fmtDate(j.created_at)}</div></td>
      <td>${badge(j.status)}</td>
      <td style="min-width:150px">${progress(j.processed, j.total)}</td>
      <td class="small">${Object.entries(j.summary).map(([s, n]) => `${badge(s)}&nbsp;${n}`).join(' ') || '<span class="muted">—</span>'}</td>
      <td class="nowrap">
        <button class="tiny secondary" data-job="${j.id}">Results</button>
        <button class="tiny secondary" data-exp="${j.id}">CSV</button>
        ${j.status === 'running' || j.status === 'queued' ? `<button class="tiny danger" data-cancel="${j.id}">Stop</button>` : `<button class="tiny danger" data-del="${j.id}">Delete</button>`}
      </td></tr>`).join('')
      || '<tr><td colspan="5" class="muted">No validation jobs yet.</td></tr>');

  const table = $('jobs-table');
  table.querySelectorAll('[data-job]').forEach((b) =>
    b.addEventListener('click', () => showResults(parseInt(b.dataset.job, 10))));
  table.querySelectorAll('[data-exp]').forEach((b) =>
    b.addEventListener('click', () => download(`/api/validation/jobs/${b.dataset.exp}/export`, `validation-${b.dataset.exp}.csv`)));
  table.querySelectorAll('[data-cancel]').forEach((b) =>
    b.addEventListener('click', async () => {
      await api(`/api/validation/jobs/${b.dataset.cancel}/cancel`, { method: 'POST' });
      loadJobs();
    }));
  table.querySelectorAll('[data-del]').forEach((b) =>
    b.addEventListener('click', async () => {
      await api(`/api/validation/jobs/${b.dataset.del}`, { method: 'DELETE' });
      loadJobs();
    }));

  // Refresh while anything is still in flight.
  if (jobs.some((j) => j.status === 'queued' || j.status === 'running')) {
    pollTimer = setTimeout(() => {
      if (document.querySelector('[data-panel=jobs]:not(.hidden)')) loadJobs();
    }, 2500);
  }
}

async function showResults(jobId, status = 'all') {
  const { results } = await api(`/api/validation/jobs/${jobId}/results?status=${status}&limit=300`);
  const box = $('job-detail');

  box.innerHTML = `<h2>Job #${jobId} results</h2>
    <div class="toolbar">
      <select id="res-filter">
        ${['all', 'valid', 'catch_all', 'unknown', 'risky', 'invalid'].map((s) =>
          `<option value="${s}" ${s === status ? 'selected' : ''}>${s === 'all' ? 'All' : s.replace(/_/g, ' ')}</option>`).join('')}
      </select>
      <button class="tiny secondary" id="res-export">Export this view</button>
    </div>
    <table><tr><th>Address</th><th>Status</th><th>Score</th><th>Why</th></tr>
      ${results.map((r) => `<tr>
        <td class="small">${esc(r.email)}</td>
        <td>${badge(r.status)}</td>
        <td class="small">${r.score}</td>
        <td class="small muted">${esc((r.detail.notes || []).join(' ') || r.reason.replace(/_/g, ' '))}</td>
      </tr>`).join('') || '<tr><td colspan="4" class="muted">Nothing yet.</td></tr>'}
    </table>`;
  box.scrollIntoView({ behavior: 'smooth' });

  $('res-filter').addEventListener('change', (e) => showResults(jobId, e.target.value));
  $('res-export').addEventListener('click', () =>
    download(`/api/validation/jobs/${jobId}/export?status=${$('res-filter').value}`, `validation-${jobId}.csv`));
}
