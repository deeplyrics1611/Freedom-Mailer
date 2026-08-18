import { api, $, esc, view, badge, toast, busy, download, fmtDate } from '../core.js';

const SAMPLE_CSV = `email,first_name,company,product,quantity,needed_by
dana@acme-tools.example,Dana,Acme Tools,M8 stainless bolts,5000,30 September
sales@beta-fasteners.example,,Beta Fasteners,M8 stainless bolts,5000,30 September`;

let openListId = null;

export async function leadsView() {
  view(`<div class="page-head"><h1>Leads</h1></div>
    <p class="sub">Audiences for cold outreach. Every column in your CSV becomes a merge field you can use in
      the copy.</p>

    <div class="notice">
      These contacts have not opted in, so outreach campaigns to them carry the stricter rules: a real postal
      address in the footer and a working one-click opt-out on every message. Both are added automatically and
      cannot be turned off. Opting out suppresses the address across your whole account, not just this list.
    </div>

    <form id="ll-form" class="row">
      <div class="field"><label>New list name</label><input name="name" required placeholder="Fastener suppliers — UK"></div>
      <div class="field" style="flex:1"><label>Description</label><input name="description"></div>
      <button type="submit">Create list</button>
    </form>

    <table id="ll-table" style="margin-top:16px"></table>
    <div id="ll-detail"></div>`);

  $('ll-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    await api('/api/lead-lists', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
    e.target.reset();
    toast('List created');
    leadsView();
  });

  const lists = await api('/api/lead-lists');
  $('ll-table').innerHTML =
    `<tr><th>List</th><th>Leads</th><th>Validation</th><th></th></tr>` +
    (lists.map((l) => `<tr>
        <td><b>${esc(l.name)}</b><div class="muted small">${esc(l.description || '')}</div></td>
        <td>${l.total}${l.opted_out ? `<div class="muted small">${l.opted_out} opted out</div>` : ''}</td>
        <td class="small">${statusChips(l)}</td>
        <td class="nowrap">
          <button class="tiny secondary" data-open="${l.id}">Open</button>
          <button class="tiny danger" data-del="${l.id}">Delete</button></td>
      </tr>`).join('')
      || '<tr><td colspan="4" class="muted">No lead lists yet.</td></tr>');

  $('ll-table').querySelectorAll('[data-del]').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirm('Delete this list and all its leads?')) return;
      await api(`/api/lead-lists/${b.dataset.del}`, { method: 'DELETE' });
      openListId = null;
      leadsView();
    }));
  $('ll-table').querySelectorAll('[data-open]').forEach((b) =>
    b.addEventListener('click', () => openList(parseInt(b.dataset.open, 10), lists)));

  if (openListId && lists.some((l) => l.id === openListId)) openList(openListId, lists);
}

function statusChips(l) {
  const parts = [
    ['valid', l.valid], ['catch_all', l.catch_all], ['unknown', l.unknown],
    ['risky', l.risky], ['invalid', l.invalid], ['unchecked', l.unchecked],
  ].filter(([, n]) => n > 0);
  if (!parts.length) return '<span class="muted">—</span>';
  return parts.map(([s, n]) => `${badge(s)}&nbsp;${n}`).join(' ');
}

async function openList(id, lists) {
  openListId = id;
  const list = lists.find((l) => l.id === id);
  const box = $('ll-detail');

  box.innerHTML = `<h2>${esc(list.name)}</h2>
    <div class="toolbar">
      <div class="row">
        <select id="lead-filter">
          <option value="all">All statuses</option>
          <option value="valid">Valid</option>
          <option value="catch_all">Catch-all</option>
          <option value="unknown">Unknown</option>
          <option value="risky">Risky</option>
          <option value="invalid">Invalid</option>
          <option value="unchecked">Not yet checked</option>
        </select>
        <input id="lead-search" placeholder="Search address or field…" style="width:220px">
      </div>
      <div class="row">
        <button class="tiny" id="validate-list">Validate this list</button>
        <button class="tiny secondary" id="export-list">Export CSV</button>
        <button class="tiny danger" id="purge-list">Remove invalid</button>
      </div>
    </div>

    <details class="panel" id="import-panel">
      <summary>Import leads from CSV</summary>
      <p class="muted small">The email column is detected automatically. Common header names are normalised, so
        "First Name", "firstname" and "FIRST_NAME" all become <span class="mono">{{first_name}}</span>.
        Duplicates, malformed rows and anyone who previously opted out are skipped.</p>
      <div class="row" style="margin-bottom:8px">
        <input type="file" id="csv-file" accept=".csv,.txt,text/csv" style="width:auto">
        <button class="tiny secondary" id="csv-sample">Insert an example</button>
      </div>
      <textarea id="csv-text" rows="8" class="mono" placeholder="email,first_name,company,product&#10;…"></textarea>
      <div class="actions"><button id="csv-import">Import</button></div>
      <div id="import-result"></div>
    </details>

    <div id="fields-panel"></div>
    <div id="leads-table"></div>`;
  box.scrollIntoView({ behavior: 'smooth' });

  $('csv-sample').addEventListener('click', () => {
    $('csv-text').value = SAMPLE_CSV;
  });
  $('csv-file').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    file.text().then((t) => {
      $('csv-text').value = t;
      toast(`Loaded ${file.name}`);
    });
  });

  $('csv-import').addEventListener('click', async (e) => {
    const csv = $('csv-text').value.trim();
    if (!csv) return toast('Paste or choose a CSV first', 'err');
    busy(e.target, true, 'Importing…');
    try {
      const r = await api(`/api/lead-lists/${id}/import`, { method: 'POST', body: { csv } });
      $('import-result').innerHTML = `<div class="notice">
        Imported <b>${r.imported}</b> of ${r.total_rows} rows from the "${esc(r.email_column)}" column.
        ${r.duplicates ? `${r.duplicates} duplicate(s) skipped. ` : ''}
        ${r.malformed ? `${r.malformed} malformed address(es) skipped. ` : ''}
        ${r.suppressed ? `${r.suppressed} previously opted out and were skipped. ` : ''}
      </div>`;
      $('csv-text').value = '';
      toast(`Imported ${r.imported} leads`);
      const refreshed = await api('/api/lead-lists');
      leadsView();
    } catch (err) {
      $('import-result').innerHTML = `<div class="notice err-text">${esc(err.message)}</div>`;
    } finally {
      busy(e.target, false);
    }
  });

  $('validate-list').addEventListener('click', async (e) => {
    busy(e.target, true, 'Queueing…');
    try {
      const job = await api(`/api/validation/lead-list/${id}`, { method: 'POST', body: {} });
      toast(`Validation job #${job.id} queued for ${job.total} addresses — watch it in Validation`);
    } catch (err) {
      toast(err.message, 'err');
    } finally {
      busy(e.target, false);
    }
  });

  $('export-list').addEventListener('click', () => {
    const status = $('lead-filter').value;
    download(`/api/lead-lists/${id}/export?status=${status}`, `${list.name}-${status}.csv`);
  });

  $('purge-list').addEventListener('click', async () => {
    if (!confirm('Delete every lead marked invalid? Sending to known-bad addresses damages your sending reputation.')) return;
    const r = await api(`/api/lead-lists/${id}/purge`, { method: 'POST', body: { statuses: ['invalid'] } });
    toast(`Removed ${r.removed} invalid leads`);
    leadsView();
  });

  const reload = () => loadLeads(id);
  $('lead-filter').addEventListener('change', reload);
  let searchTimer;
  $('lead-search').addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(reload, 250);
  });

  await loadFields(id);
  await loadLeads(id);
}

async function loadFields(id) {
  const { fields, lead_count } = await api(`/api/lead-lists/${id}/fields`);
  if (!lead_count) {
    $('fields-panel').innerHTML = '';
    return;
  }
  $('fields-panel').innerHTML = `<details class="panel"><summary>Merge fields available (${fields.length})</summary>
    <p class="muted small">Coverage is how many leads actually have a value. Anything under 100% needs a
      fallback in your copy, written as <span class="mono">{{field|fallback text}}</span>, or those messages
      will render with a gap.</p>
    <div class="field-grid">${fields.map((f) => `<div class="field-chip ${f.coverage === 100 ? 'full' : f.coverage >= 60 ? 'part' : 'low'}">
      <span class="mono">{{${esc(f.field)}}}</span>
      <span class="muted small">${f.builtin ? 'built-in' : `${f.coverage}%`}</span></div>`).join('')}</div>
    </details>`;
}

async function loadLeads(id, offset = 0) {
  const status = $('lead-filter')?.value || 'all';
  const search = $('lead-search')?.value || '';
  const { leads, total, limit } = await api(
    `/api/lead-lists/${id}/leads?status=${encodeURIComponent(status)}&search=${encodeURIComponent(search)}&offset=${offset}`
  );

  const fieldKeys = [...new Set(leads.flatMap((l) => Object.keys(l.fields)))].slice(0, 4);

  $('leads-table').innerHTML = `
    <table><tr><th>Address</th><th>Status</th><th>Score</th>
      ${fieldKeys.map((k) => `<th>${esc(k)}</th>`).join('')}<th>Checked</th><th></th></tr>
      ${leads.map((l) => `<tr>
        <td>${esc(l.email)}${l.opted_out ? ' <span class="badge muted">opted out</span>' : ''}</td>
        <td>${badge(l.status)}${l.reason ? `<div class="muted small">${esc(l.reason.replace(/_/g, ' '))}</div>` : ''}</td>
        <td class="small">${l.score ?? '—'}</td>
        ${fieldKeys.map((k) => `<td class="small">${esc(l.fields[k] || '')}</td>`).join('')}
        <td class="muted small">${fmtDate(l.checked_at) || '—'}</td>
        <td><button class="tiny danger" data-dl="${l.id}">Remove</button></td>
      </tr>`).join('') || `<tr><td colspan="${fieldKeys.length + 5}" class="muted">No leads match.</td></tr>`}
    </table>
    ${total > limit ? `<div class="toolbar">
      <span class="muted small">Showing ${offset + 1}–${Math.min(offset + limit, total)} of ${total}</span>
      <div class="row">
        <button class="tiny secondary" id="prev-page" ${offset === 0 ? 'disabled' : ''}>Previous</button>
        <button class="tiny secondary" id="next-page" ${offset + limit >= total ? 'disabled' : ''}>Next</button>
      </div></div>` : `<p class="muted small">${total} lead${total === 1 ? '' : 's'}.</p>`}`;

  $('leads-table').querySelectorAll('[data-dl]').forEach((b) =>
    b.addEventListener('click', async () => {
      await api(`/api/lead-lists/${id}/leads/${b.dataset.dl}`, { method: 'DELETE' });
      loadLeads(id, offset);
    }));
  $('prev-page')?.addEventListener('click', () => loadLeads(id, Math.max(0, offset - limit)));
  $('next-page')?.addEventListener('click', () => loadLeads(id, offset + limit));
}
