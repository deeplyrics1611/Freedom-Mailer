import { api, $, esc, view, badge, toast, busy, scoreCard, findingsList, countsRow, kv, fmtDate, pct } from '../core.js';

export async function deliverabilityView() {
  view(`<div class="page-head"><h1>Inbox placement</h1></div>
    <p class="sub">The four things that decide whether a cold email is seen: the content, the sending domain's
      authentication, what the receiver actually did with it, and where it landed.</p>

    <div class="tab-scope">
      <div class="tabs" id="d-tabs">
        <button data-tab="content" class="active">Spam &amp; HTML check</button>
        <button data-tab="auth">Domain authentication</button>
        <button data-tab="headers">Delivered headers</button>
        <button data-tab="seed">Seed tests</button>
      </div>

      <div data-panel="content">${contentForm()}</div>
      <div data-panel="auth" class="hidden">${authForm()}</div>
      <div data-panel="headers" class="hidden">${headersForm()}</div>
      <div data-panel="seed" class="hidden"><div id="seed-root"></div></div>
    </div>`);

  $('d-tabs').querySelectorAll('[data-tab]').forEach((btn) =>
    btn.addEventListener('click', () => {
      $('d-tabs').querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('active', b === btn));
      document.querySelectorAll('[data-panel]').forEach((p) => p.classList.toggle('hidden', p.dataset.panel !== btn.dataset.tab));
      if (btn.dataset.tab === 'seed') loadSeeds();
    }));

  wireContent();
  wireAuth();
  wireHeaders();
}

// ---- Content ----------------------------------------------------------------

function contentForm() {
  return `<p class="muted small">Static analysis of the message: the content heuristics filters react to, plus
    the HTML problems that break rendering in Outlook and Gmail. It predicts problems — it cannot predict any
    single provider's decision, because reputation and engagement matter more than any rule here.</p>
  <form id="content-form" class="form-grid">
    <div class="field"><label>Subject</label><input name="subject" placeholder="Quote request: 5000x M8 bolts"></div>
    <div class="field"><label>From address</label><input name="from_email" type="email" placeholder="you@yourcompany.com"></div>
    <div class="field"><label>From name</label><input name="from_name" placeholder="Dana Okoye"></div>
    <div class="field"><label>Audience</label>
      <select name="mode"><option value="outreach">Cold outreach (stricter rules)</option>
        <option value="optin">Opt-in list</option></select></div>
    <div class="field full"><label>Postal address (required for cold outreach)</label>
      <input name="postal_address" placeholder="12 Mill Street, Leeds LS1 4AB, United Kingdom"></div>
    <div class="field full"><label>HTML body</label><textarea name="html" rows="8" class="mono"></textarea></div>
    <div class="field full"><label>Plain text body</label><textarea name="text" rows="5" class="mono"></textarea>
      <div class="hint"><button type="button" class="link" id="gen-text">Generate from the HTML</button></div></div>
    <div class="actions full"><button type="submit">Analyse</button></div>
  </form>
  <div id="content-result"></div>`;
}

function wireContent() {
  $('gen-text').addEventListener('click', async () => {
    const form = $('content-form');
    if (!form.html.value.trim()) return toast('Add an HTML body first', 'err');
    const { text } = await api('/api/deliverability/to-text', { method: 'POST', body: { html: form.html.value } });
    form.text.value = text;
    toast('Plain-text version generated');
  });

  $('content-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type=submit]');
    busy(btn, true, 'Analysing…');
    try {
      const r = await api('/api/deliverability/content', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
      $('content-result').innerHTML = `
        <div class="result-head">
          ${scoreCard(r.score, 10, r.verdict, 'Content score')}
          ${countsRow(r.counts)}
        </div>
        <div class="kv-grid">
          ${kv('Words', r.stats.words)}
          ${kv('Reading time', `${r.stats.reading_seconds}s`)}
          ${kv('Links', r.stats.links)}
          ${kv('Images', r.stats.images)}
          ${kv('HTML size', `${(r.stats.html_bytes / 1024).toFixed(1)} KB`)}
          ${kv('Plain-text part', r.stats.has_text ? '✓ present' : '✕ missing')}
        </div>
        <h2>Findings</h2>
        ${findingsList(r.issues)}`;
      $('content-result').scrollIntoView({ behavior: 'smooth' });
    } catch (err) {
      $('content-result').innerHTML = `<div class="notice err-text">${esc(err.message)}</div>`;
    } finally {
      busy(btn, false);
    }
  });
}

// ---- Domain authentication ---------------------------------------------------

function authForm() {
  return `<p class="muted small">Since 2024, Gmail and Yahoo require SPF, DKIM and DMARC from anyone sending
    bulk mail. These are pass/fail gates, not suggestions.</p>
  <form id="auth-form" class="row">
    <div class="field" style="min-width:260px"><label>Sending domain</label>
      <input name="domain" required placeholder="yourcompany.com"></div>
    <div class="field"><label>DKIM selectors (optional)</label>
      <input name="selectors" placeholder="google, s1"></div>
    <div class="field"><label>Sending IP (only if you run your own relay)</label>
      <input name="ip" placeholder="203.0.113.10"></div>
    <button type="submit">Check</button>
  </form>
  <div class="row" style="margin-top:8px">
    <button class="tiny secondary" id="check-pool-domains">Check every domain in my sending pool</button>
  </div>
  <div id="auth-result"></div>`;
}

function wireAuth() {
  $('auth-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type=submit]');
    busy(btn, true, 'Querying DNS…');
    try {
      const r = await api('/api/deliverability/auth', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
      $('auth-result').innerHTML = renderAuth(r);
    } catch (err) {
      $('auth-result').innerHTML = `<div class="notice err-text">${esc(err.message)}</div>`;
    } finally {
      busy(btn, false);
    }
  });

  $('check-pool-domains').addEventListener('click', async (e) => {
    busy(e.target, true, 'Checking…');
    try {
      const { domains } = await api('/api/deliverability/auth/pool');
      $('auth-result').innerHTML = domains.length
        ? domains.map(renderAuth).join('<hr class="rule">')
        : '<div class="notice">No mailboxes in the pool yet.</div>';
    } catch (err) {
      toast(err.message, 'err');
    } finally {
      busy(e.target, false);
    }
  });
}

function renderAuth(r) {
  if (!r.ok) return `<div class="notice err-text">${esc(r.error)}</div>`;
  return `<div class="result-head">
      ${scoreCard(r.score, 100, r.ready_for_bulk ? 'meets bulk-sender requirements' : 'not ready', esc(r.domain))}
    </div>
    <div class="notice ${r.ready_for_bulk ? '' : 'warn-notice'}">${esc(r.summary)}</div>
    <div class="kv-grid">
      ${kv('SPF', r.spf.found ? `<span class="mono small">${esc(r.spf.record)}</span>` : '✕ not published')}
      ${kv('DKIM', r.dkim.length ? `✓ ${r.dkim.map((d) => esc(d.selector)).join(', ')}` : '✕ none found')}
      ${kv('DMARC', r.dmarc.found ? `p=${esc(r.dmarc.policy || '?')}` : '✕ not published')}
      ${kv('MX', r.mx.length ? `<span class="mono small">${r.mx.map((m) => esc(m.host)).join('<br>')}</span>` : '✕ none')}
      ${kv('MTA-STS', r.mta_sts ? '✓' : '—')}
      ${kv('TLS-RPT', r.tls_rpt ? '✓' : '—')}
      ${kv('BIMI', r.bimi ? '✓' : '—')}
      ${r.ip ? kv('Reverse DNS', r.ip.ptr.length ? `${esc(r.ip.ptr[0])}${r.ip.forwardConfirmed ? ' ✓' : ' (not forward-confirmed)'}` : '✕ none') : ''}
    </div>
    <h2>Findings</h2>
    ${findingsList(r.findings)}`;
}

// ---- Delivered headers -------------------------------------------------------

function headersForm() {
  return `<p class="muted small">Static analysis predicts; this is the record of what actually happened. Send
    yourself a copy of the campaign, open it, and use <b>Show original</b> in Gmail (or <b>View source</b> /
    <b>Message options</b> in Outlook), then paste the whole thing here.</p>
  <form id="headers-form">
    <div class="field full"><label>Raw message source</label>
      <textarea name="raw" rows="12" class="mono" required
        placeholder="Delivered-To: …&#10;Received: from …&#10;Authentication-Results: …"></textarea></div>
    <div class="actions"><button type="submit">Analyse</button></div>
  </form>
  <div id="headers-result"></div>`;
}

function wireHeaders() {
  $('headers-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    busy(btn, true, 'Parsing…');
    try {
      const r = await api('/api/deliverability/headers', { method: 'POST', body: { raw: new FormData(e.target).get('raw') } });
      const authRow = (name, entry) =>
        kv(name, entry ? `${entry.result === 'pass' ? '✓' : '✕'} ${esc(entry.result)}` : '<span class="muted">not reported</span>');

      $('headers-result').innerHTML = `
        <div class="result-head">${scoreCard(r.score, 100, r.verdict, 'Delivery quality')}</div>
        <div class="kv-grid">
          ${authRow('SPF', r.auth.spf)}
          ${authRow('DKIM', r.auth.dkim)}
          ${authRow('DMARC', r.auth.dmarc)}
          ${kv('From', esc(r.from || '—'))}
          ${kv('Return-Path', esc(r.return_path || '—'))}
          ${kv('Subject', esc(r.subject || '—'))}
          ${kv('One-click unsubscribe', r.one_click ? '✓ yes' : '✕ no')}
          ${r.spam.spamassassin ? kv('SpamAssassin', `${r.spam.spamassassin.score}${r.spam.spamassassin.required ? ` (threshold ${r.spam.spamassassin.required})` : ''}`) : ''}
          ${r.spam.microsoft_scl !== undefined ? kv('Microsoft SCL', r.spam.microsoft_scl) : ''}
          ${kv('DKIM signed by', r.dkim_signatures.map((s) => `${esc(s.domain || '?')} (s=${esc(s.selector || '?')})`).join(', ') || '—')}
        </div>
        ${r.hops.length ? `<h2>Delivery path</h2>
          <table><tr><th>#</th><th>Handled by</th><th>From</th><th>TLS</th><th>Delay</th></tr>
          ${r.hops.map((h, i) => `<tr><td>${i + 1}</td><td class="small mono">${esc(h.by || '—')}</td>
            <td class="small mono">${esc(h.from || '—')}</td><td>${h.tls ? '✓' : '✕'}</td>
            <td class="small">${h.delay_seconds ? `${h.delay_seconds}s` : '—'}</td></tr>`).join('')}</table>` : ''}
        ${r.spam.spamassassin?.tests?.length ? `<h2>SpamAssassin rules hit</h2>
          <div class="chips">${r.spam.spamassassin.tests.map((t) => `<span class="chip info mono">${esc(t)}</span>`).join('')}</div>` : ''}
        <h2>Findings</h2>
        ${findingsList(r.findings)}`;
      $('headers-result').scrollIntoView({ behavior: 'smooth' });
    } catch (err) {
      $('headers-result').innerHTML = `<div class="notice err-text">${esc(err.message)}</div>`;
    } finally {
      busy(btn, false);
    }
  });
}

// ---- Seed tests --------------------------------------------------------------

async function loadSeeds() {
  const [tests, pool] = await Promise.all([api('/api/deliverability/seed-tests'), api('/api/mailboxes')]);
  const verified = pool.mailboxes.filter((m) => m.verified && m.active);

  $('seed-root').innerHTML = `
    <p class="muted small">Send a tagged copy of your campaign to seed mailboxes <b>you own</b> at the providers
      your leads use, then record where each one landed. Placement is recorded by hand: reading it
      automatically would mean giving this app the password to every seed mailbox.</p>

    <details class="panel" ${tests.length ? '' : 'open'}>
      <summary>New seed test</summary>
      ${verified.length ? '' : '<div class="notice warn-notice">Add and verify a mailbox in the sending pool first.</div>'}
      <form id="seed-form" class="form-grid">
        <div class="field"><label>Send from</label>
          <select name="mailbox_id">
            <option value="">Any available mailbox in the pool</option>
            ${verified.map((m) => `<option value="${m.id}">${esc(m.email)}</option>`).join('')}
          </select></div>
        <div class="field"><label>Subject</label><input name="subject" required placeholder="Quote request: M8 bolts"></div>
        <div class="field full"><label>Seed addresses (one per line)</label>
          <textarea name="seeds" rows="4" class="mono" required
            placeholder="you@gmail.com&#10;you@outlook.com&#10;you@yahoo.com"></textarea>
          <div class="hint">Use mailboxes you control at the providers your leads actually use.</div></div>
        <div class="field full"><label>HTML body</label><textarea name="html" rows="5" class="mono"></textarea></div>
        <div class="field full"><label>Plain text body</label><textarea name="text" rows="3" class="mono"></textarea></div>
        <div class="actions full"><button type="submit" ${verified.length ? '' : 'disabled'}>Send seed test</button></div>
      </form>
    </details>

    <table id="seed-table"></table>
    <div id="seed-detail"></div>`;

  $('seed-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type=submit]');
    busy(btn, true, 'Queueing…');
    try {
      const b = Object.fromEntries(new FormData(e.target));
      const r = await api('/api/deliverability/seed-tests', { method: 'POST', body: b });
      toast(`Queued ${r.seeds} seed messages — look for the tag ${r.code}`);
      loadSeeds();
    } catch (err) {
      toast(err.message, 'err');
    } finally {
      busy(btn, false);
    }
  });

  $('seed-table').innerHTML =
    `<tr><th>Test</th><th>Sent from</th><th>Placement</th><th>Inbox rate</th><th></th></tr>` +
    (tests.map((t) => `<tr>
      <td><b class="mono">${esc(t.code)}</b><div class="muted small">${esc(t.subject)}</div>
        <div class="muted small">${fmtDate(t.created_at)}</div></td>
      <td class="small">${esc(t.mailbox_email || 'pool')}</td>
      <td class="small">${t.inbox} inbox · ${t.spam} spam · ${t.pending} unrecorded</td>
      <td>${t.total - t.pending ? `${Math.round((t.inbox / (t.total - t.pending)) * 100)}%` : '<span class="muted">—</span>'}</td>
      <td class="nowrap"><button class="tiny secondary" data-seed="${t.id}">Record results</button>
        <button class="tiny danger" data-dseed="${t.id}">Delete</button></td>
    </tr>`).join('') || '<tr><td colspan="5" class="muted">No seed tests yet.</td></tr>');

  $('seed-table').querySelectorAll('[data-seed]').forEach((b) =>
    b.addEventListener('click', () => showSeed(parseInt(b.dataset.seed, 10))));
  $('seed-table').querySelectorAll('[data-dseed]').forEach((b) =>
    b.addEventListener('click', async () => {
      await api(`/api/deliverability/seed-tests/${b.dataset.dseed}`, { method: 'DELETE' });
      loadSeeds();
    }));
}

async function showSeed(id) {
  const t = await api(`/api/deliverability/seed-tests/${id}`);
  const box = $('seed-detail');
  const options = ['unknown', 'inbox', 'promotions', 'spam', 'missing'];

  box.innerHTML = `<h2>Seed test ${esc(t.code)}</h2>
    <p class="sub">Search each seed mailbox for <b class="mono">${esc(t.code)}</b> — remember to check the spam
      folder, and in Gmail the Promotions tab. Then record where it landed.</p>
    ${t.inbox_rate !== null ? `<div class="notice">Inbox rate so far: <b>${pct(t.inbox_rate)}</b> across ${t.recorded} recorded seed(s).</div>` : ''}
    <table><tr><th>Seed</th><th>Provider</th><th>Delivery</th><th>Where it landed</th></tr>
      ${t.results.map((r) => `<tr>
        <td class="small">${esc(r.email)}</td>
        <td class="small">${esc(r.provider)}</td>
        <td>${badge(r.message_status || r.send_status)}
          ${r.message_error ? `<div class="err-text small">${esc(r.message_error.slice(0, 120))}</div>` : ''}
          ${r.sent_from ? `<div class="muted small">via ${esc(r.sent_from)}</div>` : ''}</td>
        <td><select data-result="${r.id}">
          ${options.map((o) => `<option value="${o}" ${o === r.placement ? 'selected' : ''}>${o === 'unknown' ? 'not recorded' : o}</option>`).join('')}
        </select></td>
      </tr>`).join('')}
    </table>`;
  box.scrollIntoView({ behavior: 'smooth' });

  box.querySelectorAll('[data-result]').forEach((sel) =>
    sel.addEventListener('change', async () => {
      await api(`/api/deliverability/seed-tests/${id}/results/${sel.dataset.result}`, {
        method: 'PATCH',
        body: { placement: sel.value },
      });
      toast('Recorded');
      showSeed(id);
      loadSeeds();
    }));
}
