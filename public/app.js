// Freedom Mailer panel — entry point and routing.
import { state, $, api, toast, logout } from './js/core.js';
import { dashboardView } from './js/views/dashboard.js';
import { poolView } from './js/views/pool.js';
import { leadsView } from './js/views/leads.js';
import { validationView } from './js/views/validation.js';
import { deliverabilityView } from './js/views/deliverability.js';
import { linksView } from './js/views/links.js';
import { campaignsView } from './js/views/campaigns.js';
import { basicViews } from './js/views/basic.js';

const NAV = [
  ['dashboard', 'Dashboard', 'Overview'],
  ['pool', 'Sending pool', 'Sending'],
  ['campaigns', 'Campaigns', 'Sending'],
  ['leads', 'Leads', 'Audience'],
  ['validation', 'Lead validation', 'Audience'],
  ['lists', 'Opt-in lists', 'Audience'],
  ['suppressions', 'Suppressions', 'Audience'],
  ['deliverability', 'Inbox placement', 'Deliverability'],
  ['links', 'Link check', 'Deliverability'],
  ['messages', 'Message log', 'Deliverability'],
  ['templates', 'Templates', 'Settings'],
  ['senders', 'Sender identities', 'Settings'],
  ['contacts', 'Contacts', 'Settings'],
  ['apikeys', 'API keys', 'Settings'],
  ['account', 'Account', 'Settings'],
];
const ADMIN_NAV = [['users', 'Users', 'Settings']];

const views = {
  dashboard: () => dashboardView(go),
  pool: poolView,
  leads: leadsView,
  validation: validationView,
  deliverability: deliverabilityView,
  links: linksView,
  campaigns: campaignsView,
  ...basicViews,
};

function renderNav() {
  const items = [...NAV, ...(state.user.role === 'admin' ? ADMIN_NAV : [])];
  const groups = [];
  for (const [route, label, group] of items) {
    let bucket = groups.find((g) => g.name === group);
    if (!bucket) groups.push((bucket = { name: group, items: [] }));
    bucket.items.push([route, label]);
  }

  $('nav').innerHTML = groups
    .map((g) => `<div class="nav-group"><div class="nav-group-label">${g.name}</div>
      ${g.items.map(([r, label]) =>
        `<a data-route="${r}" class="${r === state.route ? 'active' : ''}">${label}</a>`).join('')}</div>`)
    .join('');

  $('nav').querySelectorAll('a').forEach((a) => a.addEventListener('click', () => go(a.dataset.route)));
  $('who').textContent = `${state.user.email} · ${state.user.role}`;
}

async function go(route) {
  if (!views[route]) route = 'dashboard';
  state.route = route;
  location.hash = route;
  renderNav();
  try {
    await views[route]();
  } catch (err) {
    if (err.message !== 'Session expired') toast(err.message, 'err');
  }
}

async function boot() {
  state.user = await api('/api/auth/me');
  $('login').classList.add('hidden');
  $('app').classList.remove('hidden');
  const initial = location.hash.replace('#', '') || 'dashboard';
  go(initial);
}

$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('login-error').textContent = '';
  try {
    const data = await api('/api/auth/login', {
      method: 'POST',
      body: { email: $('login-email').value, password: $('login-password').value },
    });
    state.token = data.token;
    localStorage.setItem('fm_token', data.token);
    await boot();
  } catch (err) {
    $('login-error').textContent = err.message;
  }
});

$('logout').addEventListener('click', logout);

window.addEventListener('hashchange', () => {
  const route = location.hash.replace('#', '');
  if (route && route !== state.route && state.user) go(route);
});

(async () => {
  if (state.token) {
    try {
      await boot();
      return;
    } catch {
      /* fall through to the login screen */
    }
  }
  $('login').classList.remove('hidden');
})();
