const ROLE_FALLBACK = '';

function parseCustom(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

function flattenCustom(custom) {
  const out = {};
  for (const [k, v] of Object.entries(custom)) {
    if (v == null) continue;
    out[`custom.${k}`] = v;
    out[k] = v;
  }
  return out;
}

export const PLACEHOLDERS = [
  { key: 'first_name', hint: 'Contact first name' },
  { key: 'last_name', hint: 'Contact last name' },
  { key: 'name', hint: 'Full name' },
  { key: 'email', hint: 'Recipient email' },
  { key: 'company', hint: 'Company / account' },
  { key: 'title', hint: 'Job title' },
  { key: 'phone', hint: 'Phone' },
  { key: 'sender_name', hint: 'Your name' },
  { key: 'sender_email', hint: 'From address used' },
  { key: 'sender_company', hint: 'Your company' },
  { key: 'sender_title', hint: 'Your title' },
  { key: 'rfq_item', hint: 'Item / service requested' },
  { key: 'rfq_qty', hint: 'Quantity' },
  { key: 'rfq_needed_by', hint: 'Needed-by date' },
  { key: 'physical_address', hint: 'CAN-SPAM mailing address' },
  { key: 'today', hint: 'ISO date YYYY-MM-DD' },
];

export function splitName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  return { first: parts[0] || '', last: parts.slice(1).join(' ') };
}

export function contactVars(contact = {}, extra = {}) {
  const custom = parseCustom(contact.custom_json);
  const fromName = splitName(contact.name);
  const first = contact.first_name || fromName.first;
  const last = contact.last_name || fromName.last;
  const name =
    contact.name ||
    [first, last].filter(Boolean).join(' ') ||
    ROLE_FALLBACK;
  return {
    email: contact.email || '',
    name,
    first_name: first,
    last_name: last,
    company: contact.company || '',
    title: contact.title || '',
    phone: contact.phone || '',
    today: new Date().toISOString().slice(0, 10),
    ...flattenCustom(custom),
    ...extra,
  };
}

export function nestedGet(obj, path) {
  return String(path)
    .split('.')
    .reduce((acc, k) => (acc == null ? undefined : acc[k]), obj);
}

/** Replace {{placeholder}} tokens. Unknown keys become empty strings. */
export function renderTemplate(str, vars = {}) {
  if (!str) return str;
  return str.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, k) => {
    const v = Object.prototype.hasOwnProperty.call(vars, k) ? vars[k] : nestedGet(vars, k);
    return v === undefined || v === null ? '' : String(v);
  });
}

export function extractPlaceholders(str) {
  if (!str) return [];
  const found = new Set();
  for (const m of String(str).matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)) found.add(m[1]);
  return [...found];
}

export function sampleVars() {
  return {
    first_name: 'Alex',
    last_name: 'Nguyen',
    name: 'Alex Nguyen',
    email: 'alex.nguyen@acme-examples.com',
    company: 'Acme Manufacturing',
    title: 'Procurement Manager',
    phone: '+1 555 0100',
    sender_name: 'Jordan Lee',
    sender_email: 'jordan@yourcompany.com',
    sender_company: 'Your Company LLC',
    sender_title: 'Sourcing Lead',
    rfq_item: 'CNC-machined aluminum housings',
    rfq_qty: '2,500 units',
    rfq_needed_by: '2026-09-30',
    physical_address: '123 Market St, Suite 400, Austin, TX 78701',
    today: new Date().toISOString().slice(0, 10),
  };
}
