import { parseFeatures } from './features.js';

export const LICENSE_PLANS = [
  { id: '3day', label: '3-day', days: 3, dailyQuota: 500, blurb: 'Short access window.' },
  { id: 'monthly', label: 'Monthly', days: 30, dailyQuota: 5000, blurb: '30 days from issue or renewal.' },
  { id: 'lifetime', label: 'Lifetime', days: null, dailyQuota: 100000, blurb: 'No expiry.' },
];

export function planById(id) {
  return LICENSE_PLANS.find((p) => p.id === id) || null;
}

export function isoNowPlusDays(days, from = new Date()) {
  const d = new Date(from.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

export function computeExpiry(planId, from = new Date()) {
  const plan = planById(planId);
  if (!plan) return { error: 'Unknown license plan. Use 3day, monthly, or lifetime.' };
  if (!plan.days) return { plan: plan.id, expires_at: null };
  return { plan: plan.id, expires_at: isoNowPlusDays(plan.days, from) };
}

export function extendExpiry(planId, currentExpiry, from = new Date()) {
  const plan = planById(planId);
  if (!plan) return { error: 'Unknown license plan. Use 3day, monthly, or lifetime.' };
  if (!plan.days) return { plan: 'lifetime', expires_at: null };
  const cur = currentExpiry ? new Date(currentExpiry) : null;
  const base = cur && !Number.isNaN(cur.getTime()) && cur > from ? cur : from;
  return { plan: plan.id, expires_at: isoNowPlusDays(plan.days, base) };
}

export function licenseStatus(user, now = new Date()) {
  if (!user) return { ok: false, plan: '', expires_at: null, reason: 'no_user', label: 'No account' };
  const plan = user.license_plan || (user.role === 'admin' ? 'lifetime' : '');
  if (user.role === 'admin') {
    return { ok: true, plan: plan || 'lifetime', expires_at: null, days_left: null, reason: '', label: 'Admin · lifetime' };
  }
  if (user.active === 0) {
    return { ok: false, plan, expires_at: user.license_expires_at || null, reason: 'disabled', label: 'Disabled' };
  }
  if (plan === 'lifetime') {
    return { ok: true, plan: 'lifetime', expires_at: null, days_left: null, reason: '', label: 'Lifetime' };
  }
  if (!plan) {
    return { ok: false, plan: '', expires_at: null, reason: 'no_license', label: 'No license' };
  }
  const expires = user.license_expires_at || null;
  if (!expires) {
    return { ok: false, plan, expires_at: null, reason: 'no_license', label: 'No license' };
  }
  const exp = new Date(expires);
  if (Number.isNaN(exp.getTime()) || exp <= now) {
    return { ok: false, plan, expires_at: expires, days_left: 0, reason: 'expired', label: 'Expired' };
  }
  const daysLeft = Math.max(1, Math.ceil((exp.getTime() - now.getTime()) / 86400000));
  const meta = planById(plan);
  return {
    ok: true,
    plan,
    expires_at: expires,
    days_left: daysLeft,
    reason: '',
    label: `${meta ? meta.label : plan} · ${daysLeft}d left`,
  };
}

export function publicUser(user, now = new Date()) {
  const license = licenseStatus(user, now);
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    daily_quota: user.daily_quota,
    active: !!user.active,
    license_plan: user.license_plan || '',
    license_expires_at: user.license_expires_at || null,
    license,
    features: parseFeatures(user.features),
    notes: user.notes || '',
    last_login: user.last_login || null,
    created_at: user.created_at,
  };
}

export function isLicenseActive(user, now = new Date()) {
  return licenseStatus(user, now).ok;
}
