import { api, $, esc, view, toast, busy, scoreCard, findingsList, kv } from '../core.js';

export function linksView() {
  view(`<div class="page-head"><h1>Link check</h1></div>
    <p class="sub">Where a link really goes, and whether it is safe to put in cold email.</p>

    <div class="notice">
      Links are one of the few parts of a cold email a filter can check against outside data: whether the
      destination domain is blocklisted, how recently it was registered, and whether the visible URL matches
      where it actually leads. One bad link can bury an otherwise clean campaign.
    </div>

    <form id="link-form" class="form-grid">
      <div class="field full"><label>Links to check (one per line, or paste an email body below)</label>
        <textarea name="urls_text" rows="4" class="mono" placeholder="https://yourcompany.com/capabilities"></textarea></div>
      <div class="field full"><label>Or paste the message body and check every link in it</label>
        <textarea name="html" rows="4" class="mono" placeholder="<p>…<a href=&quot;https://…&quot;>…</a></p>"></textarea></div>
      <div class="field"><label>Your sending domain (optional)</label>
        <input name="sending_domain" placeholder="yourcompany.com">
        <div class="hint">Used to check whether your links align with the domain you send from.</div></div>
      <div class="actions full"><button type="submit">Check links</button></div>
    </form>
    <div id="link-result"></div>`);

  $('link-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const b = Object.fromEntries(new FormData(e.target));
    if (!b.urls_text.trim() && !b.html.trim()) return toast('Add at least one link', 'err');

    const btn = e.target.querySelector('button');
    busy(btn, true, 'Following redirects…');
    $('link-result').innerHTML = '<p class="muted">Tracing redirects, querying blocklists and registration data…</p>';
    try {
      const r = await api('/api/links/check-many', { method: 'POST', body: b });
      $('link-result').innerHTML = `
        <div class="notice ${r.safe_to_send ? '' : 'warn-notice'}">
          Checked ${r.checked} link${r.checked === 1 ? '' : 's'}. Lowest score ${r.worst_score}/10 —
          ${r.safe_to_send ? 'nothing here should hurt placement.' : 'fix the problems below before sending.'}
        </div>
        ${r.results.map(renderLink).join('')}`;
      $('link-result').scrollIntoView({ behavior: 'smooth' });
    } catch (err) {
      $('link-result').innerHTML = `<div class="notice err-text">${esc(err.message)}</div>`;
    } finally {
      busy(btn, false);
    }
  });
}

function renderLink(r) {
  const listed = (r.blocklists || []).filter((b) => b.listed);
  const checked = (r.blocklists || []).filter((b) => !b.unavailable);

  return `<div class="link-card">
    <div class="result-head">
      ${scoreCard(r.score, 10, r.verdict, r.url.length > 60 ? `${r.url.slice(0, 60)}…` : r.url)}
    </div>
    <div class="kv-grid">
      ${kv('Final destination', `<span class="mono small">${esc(r.final_url || r.url)}</span>`)}
      ${kv('HTTP status', r.status || 'no response')}
      ${kv('Redirects', (r.redirects || []).length - 1 > 0 ? `${(r.redirects || []).length - 1}` : 'none')}
      ${kv('Domain', `<span class="mono">${esc(r.domain || '—')}</span>`)}
      ${kv('Domain age', r.domain_age?.known ? `registered ${esc(r.domain_age.registered)} (${r.domain_age.days} days)` : 'unknown')}
      ${kv('Blocklists', listed.length
        ? `<span class="err-text">listed on ${listed.map((b) => esc(b.name)).join(', ')}</span>`
        : checked.length ? `clean on ${checked.length} checked` : '<span class="muted">lookups unavailable</span>')}
      ${r.safe_browsing?.enabled ? kv('Safe Browsing', r.safe_browsing.matches.length ? `<span class="err-text">flagged</span>` : 'clean') : ''}
    </div>
    ${(r.redirects || []).length > 1 ? `<details class="panel"><summary>Redirect chain</summary>
      <ol class="chain">${r.redirects.map((h) => `<li><span class="badge ${h.status >= 400 || h.status === 0 ? 'err' : h.status >= 300 ? 'warn' : 'ok'}">${h.status || 'error'}</span>
        <span class="mono small">${esc(h.url)}</span>${h.error ? `<div class="err-text small">${esc(h.error)}</div>` : ''}</li>`).join('')}</ol>
      </details>` : ''}
    ${findingsList(r.findings)}
  </div>`;
}
