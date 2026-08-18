import { api, $, esc, view } from '../core.js';

// The onboarding order that actually works: get a mailbox authenticated, load
// and clean the list, prove the domain is authenticated, then send.
const STEPS = [
  {
    key: 'pool',
    title: 'Add a mailbox with an app password',
    detail: 'Turn on 2-Step Verification on the account, create an app password, and add it to the sending pool.',
    done: (s) => s.mailboxes_verified > 0,
    route: 'pool',
  },
  {
    key: 'auth',
    title: 'Authenticate your sending domain',
    detail: 'SPF, DKIM and DMARC are required by Gmail and Yahoo for bulk mail. Sending cold outreach from a free @gmail.com address means you have no domain reputation of your own.',
    done: () => null, // Cannot be inferred from stats; always worth checking.
    route: 'deliverability',
  },
  {
    key: 'leads',
    title: 'Import and validate your leads',
    detail: 'Bounces are what destroy a sending reputation, and they are the one problem that is entirely preventable.',
    done: (s) => s.leads > 0 && s.leads_unchecked === 0,
    route: 'leads',
  },
  {
    key: 'check',
    title: 'Check the copy before you send',
    detail: 'Run the spam and HTML check, and the link check, on the exact message you plan to send.',
    done: () => null,
    route: 'deliverability',
  },
  {
    key: 'send',
    title: 'Send a paced campaign',
    detail: 'Start small. Volume ramps as each mailbox warms up.',
    done: (s) => s.sent > 0,
    route: 'campaigns',
  },
];

export async function dashboardView(go) {
  view(`<div class="page-head"><h1>Dashboard</h1></div>
    <p class="sub">Sending capacity, list health and what to do next.</p>
    <div id="d-cards" class="cards"></div>
    <h2>Getting set up</h2>
    <div id="d-steps" class="steps"></div>`);

  const s = await api('/api/stats');
  const card = (n, label, hint) =>
    `<div class="card"><div class="stat">${n}</div><div class="stat-label">${esc(label)}</div>
      ${hint ? `<div class="muted small">${esc(hint)}</div>` : ''}</div>`;

  $('d-cards').innerHTML = [
    card(s.pool_capacity_today, 'Sends left in 24h', `${s.mailboxes_verified} of ${s.mailboxes} mailboxes ready`),
    card(s.sent_today, 'Sent today'),
    card(s.queued, 'Waiting in the queue'),
    card(s.leads, 'Leads', s.leads_unchecked ? `${s.leads_unchecked} not yet validated` : 'all validated'),
    card(s.leads_valid, 'Confirmed valid'),
    card(s.confirmed, 'Opt-in subscribers'),
    card(s.sent, 'Sent all time'),
    card(s.failed, 'Failed'),
    card(s.suppressed, 'Suppressed', 'Never contacted again'),
  ].join('');

  $('d-steps').innerHTML = STEPS.map((step, i) => {
    const done = step.done(s);
    const cls = done === true ? 'done' : done === false ? 'todo' : 'optional';
    const mark = done === true ? '✓' : String(i + 1);
    return `<div class="step ${cls}" data-go="${step.route}">
      <div class="step-mark">${mark}</div>
      <div><div class="step-title">${esc(step.title)}</div>
        <div class="step-detail">${esc(step.detail)}</div></div>
    </div>`;
  }).join('');

  $('d-steps').querySelectorAll('[data-go]').forEach((el) =>
    el.addEventListener('click', () => go(el.dataset.go)));
}
