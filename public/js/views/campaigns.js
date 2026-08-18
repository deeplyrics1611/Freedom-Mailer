import { api, $, esc, view, badge, toast, busy, findingsList, scoreCard } from '../core.js';

let editingId = null;

export async function campaignsView() {
  const [senders, lists, leadLists, pool, starters] = await Promise.all([
    api('/api/senders'), api('/api/lists'), api('/api/lead-lists'),
    api('/api/mailboxes'), api('/api/templates/starters'),
  ]);

  view(`<div class="page-head"><h1>Campaigns</h1></div>
    <p class="sub">Quote requests to a lead list, or newsletters to a confirmed opt-in list.</p>

    <form id="camp-form" class="form-grid">
      <div class="field"><label>Campaign name</label><input name="name" required placeholder="M8 bolts — UK suppliers"></div>
      <div class="field"><label>Audience type</label>
        <select name="mode" id="camp-mode">
          <option value="outreach">Cold outreach to a lead list</option>
          <option value="optin">Opt-in list (double opt-in confirmed)</option>
        </select></div>

      <div class="field outreach-only"><label>Lead list</label>
        <select name="lead_list_id">
          <option value="">— choose —</option>
          ${leadLists.map((l) => `<option value="${l.id}">${esc(l.name)} (${l.total} leads, ${l.valid} valid)</option>`).join('')}
        </select></div>
      <div class="field optin-only hidden"><label>Opt-in list</label>
        <select name="list_id">
          <option value="">— choose —</option>
          ${lists.map((l) => `<option value="${l.id}">${esc(l.name)} (${l.confirmed} confirmed)</option>`).join('')}
        </select></div>

      <div class="field"><label>Send using</label>
        <select name="sending" id="camp-sending">
          <option value="pool">The mailbox pool (${pool.mailboxes.filter((m) => m.verified && m.active).length} ready, ${pool.capacity_today} sends left today)</option>
          ${senders.map((s) => `<option value="sender:${s.id}" ${s.verified ? '' : 'disabled'}>${esc(s.label)}${s.verified ? '' : ' (unverified)'}</option>`).join('')}
          <option value="system">System SMTP</option>
        </select></div>
      <div class="field"><label>Reply-to (optional)</label><input name="reply_to" type="email"></div>

      <div class="field full"><label>Subject</label>
        <input name="subject" required placeholder="Quote request: {{product|your product range}}"></div>

      <div class="field full"><label>Plain text body</label>
        <textarea name="text" rows="10" class="mono" placeholder="Hi {{first_name|there}},&#10;&#10;…"></textarea>
        <div class="hint">Plain text alone performs best for cold outreach. Merge fields:
          <span class="mono">{{first_name|there}}</span> uses the fallback when the field is empty;
          <span class="mono">{{name:first}}</span> takes the first word.</div></div>
      <div class="field full"><label>HTML body (optional)</label>
        <textarea name="html" rows="6" class="mono"></textarea></div>

      <div class="field full outreach-only"><label>Postal address (required)</label>
        <input name="postal_address" placeholder="12 Mill Street, Leeds LS1 4AB, United Kingdom">
        <div class="hint">Added to the footer along with a one-click opt-out. CAN-SPAM requires both in every
          commercial email.</div></div>

      <div class="field outreach-only"><label>Gap between sends</label>
        <div class="row">
          <input name="min_delay_sec" type="number" value="45" style="width:90px"> to
          <input name="max_delay_sec" type="number" value="120" style="width:90px"> seconds
        </div></div>
      <div class="field outreach-only"><label>Daily cap for this campaign</label>
        <input name="daily_cap" type="number" value="0">
        <div class="hint">0 means the mailbox limits are the only cap.</div></div>
      <div class="field outreach-only"><label>Validation gate</label>
        <select name="only_valid">
          <option value="1">Skip invalid and never-checked leads</option>
          <option value="0">Send to every lead in the list</option>
        </select></div>

      <div class="actions full">
        <button type="submit" id="camp-save">Save draft</button>
        <button type="button" class="secondary" id="camp-cancel" style="display:none">Cancel edit</button>
        <select id="starter-pick" style="width:auto">
          <option value="">Start from a template…</option>
          ${starters.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}
        </select>
      </div>
    </form>

    <table id="camp-table"></table>
    <div id="camp-detail"></div>`);

  const form = $('camp-form');
  const applyMode = () => {
    const outreach = $('camp-mode').value === 'outreach';
    document.querySelectorAll('.outreach-only').forEach((el) => el.classList.toggle('hidden', !outreach));
    document.querySelectorAll('.optin-only').forEach((el) => el.classList.toggle('hidden', outreach));
  };
  $('camp-mode').addEventListener('change', applyMode);
  applyMode();

  $('starter-pick').addEventListener('change', (e) => {
    const starter = starters.find((s) => s.id === e.target.value);
    if (!starter) return;
    form.subject.value = starter.subject;
    form.text.value = starter.text;
    form.html.value = starter.html;
    toast(`Loaded "${starter.name}"`);
    e.target.value = '';
  });

  $('camp-cancel').addEventListener('click', () => {
    editingId = null;
    campaignsView();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const b = Object.fromEntries(new FormData(e.target));
    const sending = b.sending;
    delete b.sending;
    b.use_pool = sending === 'pool';
    b.sender_id = sending.startsWith('sender:') ? parseInt(sending.split(':')[1], 10) : null;
    b.lead_list_id = b.lead_list_id ? parseInt(b.lead_list_id, 10) : null;
    b.list_id = b.list_id ? parseInt(b.list_id, 10) : null;
    b.only_valid = b.only_valid === '1';
    ['min_delay_sec', 'max_delay_sec', 'daily_cap'].forEach((k) => (b[k] = parseInt(b[k] || 0, 10)));

    const btn = $('camp-save');
    busy(btn, true, 'Saving…');
    try {
      if (editingId) await api(`/api/campaigns/${editingId}`, { method: 'PUT', body: b });
      else await api('/api/campaigns', { method: 'POST', body: b });
      editingId = null;
      toast('Draft saved');
      campaignsView();
    } catch (err) {
      toast(err.message, 'err');
    } finally {
      busy(btn, false);
    }
  });

  await renderCampaigns();

  if (editingId) {
    const c = await api(`/api/campaigns/${editingId}`);
    loadIntoForm(c);
  }
}

function loadIntoForm(c) {
  const form = $('camp-form');
  form.name.value = c.name;
  $('camp-mode').value = c.mode;
  $('camp-mode').dispatchEvent(new Event('change'));
  if (c.lead_list_id) form.lead_list_id.value = c.lead_list_id;
  if (c.list_id) form.list_id.value = c.list_id;
  $('camp-sending').value = c.use_pool ? 'pool' : c.sender_id ? `sender:${c.sender_id}` : 'system';
  form.subject.value = c.subject;
  form.text.value = c.text;
  form.html.value = c.html;
  form.reply_to.value = c.reply_to || '';
  form.postal_address.value = c.postal_address || '';
  form.min_delay_sec.value = c.min_delay_sec;
  form.max_delay_sec.value = c.max_delay_sec;
  form.daily_cap.value = c.daily_cap;
  form.only_valid.value = c.only_valid ? '1' : '0';
  $('camp-save').textContent = 'Update draft';
  $('camp-cancel').style.display = '';
  form.scrollIntoView({ behavior: 'smooth' });
}

async function renderCampaigns() {
  const rows = await api('/api/campaigns');
  $('camp-table').innerHTML =
    `<tr><th>Campaign</th><th>Audience</th><th>Status</th><th>Progress</th><th></th></tr>` +
    (rows.map((c) => `<tr>
      <td><b>${esc(c.name)}</b><div class="muted small">${esc(c.subject || '')}</div></td>
      <td class="small">${c.mode === 'outreach' ? `${esc(c.lead_list_name || '—')} <span class="badge muted">cold</span>` : `${esc(c.list_name || '—')} <span class="badge ok">opt-in</span>`}</td>
      <td>${badge(c.status)}</td>
      <td class="small">${c.sent}/${c.total} sent${c.queued ? ` · ${c.queued} queued` : ''}${c.failed ? ` · <span class="err-text">${c.failed} failed</span>` : ''}${c.skipped ? ` · ${c.skipped} skipped` : ''}</td>
      <td class="nowrap">
        ${c.status === 'draft'
          ? `<button class="tiny secondary" data-prev="${c.id}">Preview</button>
             <button class="tiny secondary" data-edit="${c.id}">Edit</button>
             <button class="tiny" data-send="${c.id}">Send</button>
             <button class="tiny danger" data-del="${c.id}">Delete</button>`
          : c.status === 'sending'
            ? `<button class="tiny danger" data-pause="${c.id}">Stop</button>`
            : '<span class="muted small">—</span>'}
      </td></tr>`).join('')
      || '<tr><td colspan="5" class="muted">No campaigns yet.</td></tr>');

  const table = $('camp-table');
  table.querySelectorAll('[data-edit]').forEach((b) =>
    b.addEventListener('click', async () => {
      editingId = parseInt(b.dataset.edit, 10);
      loadIntoForm(await api(`/api/campaigns/${editingId}`));
    }));
  table.querySelectorAll('[data-del]').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirm('Delete this draft?')) return;
      await api(`/api/campaigns/${b.dataset.del}`, { method: 'DELETE' });
      campaignsView();
    }));
  table.querySelectorAll('[data-pause]').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirm('Stop this campaign? Anything still queued will be cancelled.')) return;
      const r = await api(`/api/campaigns/${b.dataset.pause}/pause`, { method: 'POST' });
      toast(`Cancelled ${r.cancelled} queued messages`);
      campaignsView();
    }));
  table.querySelectorAll('[data-prev]').forEach((b) =>
    b.addEventListener('click', () => showPreview(parseInt(b.dataset.prev, 10))));
  table.querySelectorAll('[data-send]').forEach((b) =>
    b.addEventListener('click', () => confirmSend(parseInt(b.dataset.send, 10), b)));
}

async function showPreview(id) {
  const box = $('camp-detail');
  box.innerHTML = '<p class="muted">Rendering…</p>';
  box.scrollIntoView({ behavior: 'smooth' });

  try {
    const [preview, preflight] = await Promise.all([
      api(`/api/campaigns/${id}/preview`, { method: 'POST', body: { count: 3 } }),
      api(`/api/campaigns/${id}/preflight`),
    ]);

    box.innerHTML = `<h2>Preview</h2>
      ${renderPreflight(preflight)}
      ${preview.placeholders?.length ? `<h3>Merge fields</h3>
        <table><tr><th>Field</th><th>Fallback</th><th>Would render empty</th></tr>
        ${preview.placeholders.map((p) => `<tr>
          <td class="mono small">{{${esc(p.field)}}}</td>
          <td class="small">${p.fallback === null ? '<span class="err-text">none</span>' : `"${esc(p.fallback)}"`}</td>
          <td class="small">${p.missing ? `<span class="${p.safe ? 'muted' : 'err-text'}">${p.missing} of ${p.total}</span>` : '<span class="muted">none</span>'}</td>
        </tr>`).join('')}</table>` : ''}
      <h3>As recipients will see it</h3>
      ${(preview.previews || []).map((p) => `<div class="preview-card">
        <div class="preview-head"><b>To:</b> ${esc(p.to)}
          ${p.unresolved ? '<span class="badge err">looks unresolved</span>' : ''}</div>
        <div class="preview-subject"><b>Subject:</b> ${esc(p.subject)}</div>
        <pre class="preview-body">${esc(p.text)}</pre>
      </div>`).join('') || '<p class="muted">No eligible recipients to preview.</p>'}`;
  } catch (err) {
    box.innerHTML = `<div class="notice err-text">${esc(err.message)}</div>`;
  }
}

function renderPreflight(p) {
  return `<div class="notice ${p.ready ? '' : 'warn-notice'}">
      <b>${p.ready ? 'Ready to send.' : 'Not ready to send.'}</b>
      ${p.recipients ? ` ${p.recipients.eligible} eligible of ${p.recipients.total} leads.` : ''}
      ${p.content_score !== undefined ? ` Content score ${p.content_score}/10.` : ''}
      ${p.pool_capacity_today !== null && p.pool_capacity_today !== undefined ? ` Pool can send ${p.pool_capacity_today} more in the next 24h.` : ''}
    </div>
    ${p.blockers?.length ? `<ul class="findings">${p.blockers.map((b) => `<li class="finding critical">
      <span class="finding-icon">✕</span><div class="finding-body"><div class="finding-detail">${esc(b)}</div></div></li>`).join('')}</ul>` : ''}
    ${p.warnings?.length ? `<ul class="findings">${p.warnings.map((w) => `<li class="finding warning">
      <span class="finding-icon">!</span><div class="finding-body"><div class="finding-detail">${esc(w)}</div></div></li>`).join('')}</ul>` : ''}`;
}

async function confirmSend(id, button) {
  const preflight = await api(`/api/campaigns/${id}/preflight`);
  if (!preflight.ready) {
    showPreview(id);
    return toast('Campaign is not ready — see the blockers below', 'err');
  }
  const count = preflight.recipients?.eligible ?? 'all confirmed';
  if (!confirm(`Queue this campaign to ${count} recipients?`)) return;

  busy(button, true, 'Queueing…');
  try {
    const r = await api(`/api/campaigns/${id}/send`, { method: 'POST' });
    toast(r.note || `Queued ${r.queued}`, 'ok');
    campaignsView();
  } catch (err) {
    if (err.data?.placeholders) {
      const fields = err.data.placeholders.map((p) => `{{${p.field}}} (${p.missing} of ${p.total} empty)`).join(', ');
      if (confirm(`${err.message}\n\n${fields}\n\nSend anyway? Those recipients will see a gap where the field should be.`)) {
        const r = await api(`/api/campaigns/${id}/send`, { method: 'POST', body: { allow_missing_fields: true } });
        toast(r.note || `Queued ${r.queued}`);
        campaignsView();
        return;
      }
    } else {
      toast(err.message, 'err');
    }
  } finally {
    busy(button, false);
  }
}
