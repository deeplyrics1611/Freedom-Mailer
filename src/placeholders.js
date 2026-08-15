// Merge-field helpers used by letters, campaigns, and the compose preview.

export const PLACEHOLDERS = [
  { key: 'name', label: 'Full name', sample: 'Alex Rivera' },
  { key: 'first_name', label: 'First name', sample: 'Alex' },
  { key: 'last_name', label: 'Last name', sample: 'Rivera' },
  { key: 'email', label: 'Email', sample: 'alex@example.com' },
  { key: 'phone', label: 'Phone', sample: '+1 555 0100' },
  { key: 'company', label: 'Company', sample: 'Northwind Labs' },
  { key: 'title', label: 'Job title', sample: 'Operations lead' },
  { key: 'custom1', label: 'Custom 1', sample: '' },
  { key: 'custom2', label: 'Custom 2', sample: '' },
];

const TOKEN = /\{\{\s*([a-zA-Z0-9_]+)(?:\s*\|\s*([^}]+?))?\s*\}\}/g;

export function expandVars(vars = {}) {
  const name = String(vars.name || '').trim();
  const parts = name ? name.split(/\s+/) : [];
  const email = String(vars.email || '').trim();
  const local = email.includes('@') ? email.split('@')[0] : '';
  return {
    first_name: vars.first_name || parts[0] || local || '',
    last_name: vars.last_name || parts.slice(1).join(' ') || '',
    name: name || vars.first_name || local || '',
    email,
    phone: vars.phone || '',
    company: vars.company || '',
    title: vars.title || '',
    custom1: vars.custom1 || '',
    custom2: vars.custom2 || '',
    ...vars,
  };
}

// {{name}} {{name|there}} — unknown keys become empty (or the fallback).
export function renderTemplate(str, vars) {
  if (!str) return str;
  const v = expandVars(vars);
  return String(str).replace(TOKEN, (_, key, fallback) => {
    const val = v[key];
    if (val === undefined || val === null || val === '') {
      return fallback !== undefined ? String(fallback).trim() : '';
    }
    return String(val);
  });
}

export function listPlaceholders(str) {
  if (!str) return [];
  const keys = new Set();
  String(str).replace(TOKEN, (_, key) => {
    keys.add(key);
    return '';
  });
  return [...keys];
}

export function sampleVars(overrides = {}) {
  const base = {};
  for (const p of PLACEHOLDERS) base[p.key] = p.sample;
  return expandVars({ ...base, ...overrides });
}

export function htmlToText(html) {
  if (!html) return '';
  return String(html)
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, '$2 ($1)')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
