// Merge-field rendering for outreach copy.
//
//   {{company}}                  -> the field value
//   {{first_name|there}}         -> "there" when the field is empty
//   {{name:first}}               -> first word of the value
//   {{company:title|your team}}  -> filter and fallback together
//
// Field names are matched case-insensitively so a CSV header of "First Name",
// "first_name" or "FIRSTNAME" all resolve to the same placeholder.

const FILTERS = {
  upper: (v) => v.toUpperCase(),
  lower: (v) => v.toLowerCase(),
  title: (v) => v.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase()),
  first: (v) => v.trim().split(/\s+/)[0] || '',
  last: (v) => v.trim().split(/\s+/).slice(-1)[0] || '',
  trim: (v) => v.trim(),
  // Company name from an email address, e.g. buyer@acme-tools.com -> Acme Tools
  domain: (v) => (v.includes('@') ? v.split('@').pop() : v),
  company: (v) => {
    const host = (v.includes('@') ? v.split('@').pop() : v).replace(/^www\./, '');
    const base = host.split('.')[0] || host;
    return base.replace(/[-_]+/g, ' ').replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1));
  },
};

export const FILTER_NAMES = Object.keys(FILTERS);

const TOKEN = /\{\{\s*([A-Za-z0-9_.\- ]+?)\s*(?::\s*([a-z]+)\s*)?(?:\|\s*([^}]*?)\s*)?\}\}/g;

const normalizeKey = (k) => String(k).toLowerCase().replace(/[\s\-.]+/g, '_');

function buildLookup(vars) {
  const map = new Map();
  for (const [k, v] of Object.entries(vars || {})) map.set(normalizeKey(k), v);
  return map;
}

export function render(template, vars) {
  if (!template) return template ?? '';
  const lookup = buildLookup(vars);
  return String(template).replace(TOKEN, (_, rawName, filter, fallback) => {
    const raw = lookup.get(normalizeKey(rawName));
    let value = raw === undefined || raw === null ? '' : String(raw).trim();
    if (value && filter && FILTERS[filter]) value = FILTERS[filter](value);
    if (!value) return fallback === undefined ? '' : fallback;
    return value;
  });
}

/** Every placeholder used in a template, with its filter and fallback. */
export function extractPlaceholders(template) {
  const out = new Map();
  for (const m of String(template || '').matchAll(TOKEN)) {
    const key = normalizeKey(m[1]);
    if (!out.has(key)) {
      out.set(key, { field: key, raw: m[1].trim(), filter: m[2] || null, fallback: m[3] ?? null });
    }
  }
  return [...out.values()];
}

/**
 * Report placeholders that would render empty across a set of leads. An
 * unresolved merge field is the single most visible mistake in cold outreach
 * ("Hi ,"), so this is checked before a campaign can be sent.
 */
export function auditPlaceholders(templates, leads) {
  const used = new Map();
  for (const t of templates) {
    for (const p of extractPlaceholders(t)) if (!used.has(p.field)) used.set(p.field, p);
  }
  const report = [];
  for (const p of used.values()) {
    let missing = 0;
    for (const lead of leads) {
      const lookup = buildLookup(lead);
      const v = lookup.get(p.field);
      if (v === undefined || v === null || String(v).trim() === '') missing++;
    }
    report.push({
      field: p.raw,
      filter: p.filter,
      fallback: p.fallback,
      missing,
      total: leads.length,
      // A placeholder with a fallback is safe even when the data is absent.
      safe: p.fallback !== null || missing === 0,
    });
  }
  return report;
}

/** Merge fields available for a lead: its CSV columns plus derived defaults. */
export function leadVars(lead) {
  const fields = typeof lead.fields === 'string' ? JSON.parse(lead.fields || '{}') : lead.fields || {};
  const email = lead.email || '';
  const domain = email.includes('@') ? email.split('@').pop() : '';
  return {
    email,
    domain,
    company_from_domain: FILTERS.company(email),
    ...fields,
  };
}
