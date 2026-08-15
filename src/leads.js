const EMAIL_RE = /[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}/i;

export function isEmail(s) {
  return EMAIL_RE.test(String(s || '').trim());
}

function normalizeEmail(s) {
  return String(s || '').trim().toLowerCase();
}

function splitRow(line) {
  // CSV-ish: commas, tabs, or semicolons. Keep quoted commas intact.
  if (line.includes('"') && /[,;\t]/.test(line)) {
    const out = [];
    let cur = '';
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        q = !q;
      } else if (!q && (c === ',' || c === ';' || c === '\t')) {
        out.push(cur.trim());
        cur = '';
      } else {
        cur += c;
      }
    }
    out.push(cur.trim());
    return out.map((x) => x.replace(/^"|"$/g, ''));
  }
  return line.split(/[,;\t]/).map((s) => s.trim()).filter((s, i, arr) => s || arr.length > 1);
}

const HEADER_ALIASES = {
  email: 'email',
  mail: 'email',
  e_mail: 'email',
  'e-mail': 'email',
  name: 'name',
  fullname: 'name',
  full_name: 'name',
  first: 'first_name',
  firstname: 'first_name',
  first_name: 'first_name',
  last: 'last_name',
  lastname: 'last_name',
  last_name: 'last_name',
  phone: 'phone',
  mobile: 'phone',
  tel: 'phone',
  telephone: 'phone',
  company: 'company',
  org: 'company',
  organization: 'company',
  title: 'title',
  job: 'title',
  custom1: 'custom1',
  custom2: 'custom2',
};

function headerKey(raw) {
  const k = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
  return HEADER_ALIASES[k] || null;
}

function looksLikeHeader(parts) {
  if (!parts.length) return false;
  const mapped = parts.map(headerKey).filter(Boolean);
  return mapped.includes('email') || (mapped.length >= 2 && !parts.some(isEmail));
}

function leadFromParts(parts, header) {
  const lead = {
    email: '',
    name: '',
    first_name: '',
    last_name: '',
    phone: '',
    company: '',
    title: '',
    custom1: '',
    custom2: '',
  };

  if (header) {
    header.forEach((h, i) => {
      if (!h) return;
      lead[h] = parts[i] || '';
    });
  } else {
    const emailIdx = parts.findIndex(isEmail);
    if (emailIdx === -1) return null;
    lead.email = parts[emailIdx];
    const rest = parts.filter((_, i) => i !== emailIdx);
    // Rest is typically name, phone, company, title
    const phones = [];
    const texts = [];
    for (const p of rest) {
      if (/^\+?[\d\s().\-]{7,}$/.test(p)) phones.push(p);
      else texts.push(p);
    }
    lead.phone = phones[0] || '';
    lead.name = texts[0] || '';
    lead.company = texts[1] || '';
    lead.title = texts[2] || '';
    lead.custom1 = texts[3] || '';
  }

  lead.email = normalizeEmail(lead.email);
  if (!isEmail(lead.email)) return null;
  if (!lead.name) {
    lead.name = [lead.first_name, lead.last_name].filter(Boolean).join(' ');
  }
  return lead;
}

function fromAngle(line) {
  const m = line.match(/^(.*?)\s*<([^>]+@[^>]+)>\s*$/);
  if (!m) return null;
  const email = normalizeEmail(m[2]);
  if (!isEmail(email)) return null;
  return {
    email,
    name: m[1].replace(/^["']|["']$/g, '').trim(),
    first_name: '',
    last_name: '',
    phone: '',
    company: '',
    title: '',
    custom1: '',
    custom2: '',
  };
}

/**
 * Parse a pasted block of leads. No file upload — copy/paste only.
 * Accepts:
 *   one email per line
 *   Name <email@x.com>
 *   email, name, phone, company
 *   header row: email,name,phone,company
 */
export function parseLeads(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));

  const leads = [];
  const invalid = [];
  const seen = new Set();
  let header = null;

  for (const line of lines) {
    const angled = fromAngle(line);
    if (angled) {
      if (seen.has(angled.email)) continue;
      seen.add(angled.email);
      leads.push(angled);
      continue;
    }

    const parts = splitRow(line);
    if (!header && looksLikeHeader(parts) && !parts.some(isEmail)) {
      header = parts.map(headerKey);
      continue;
    }

    const lead = leadFromParts(parts, header);
    if (!lead) {
      invalid.push(line);
      continue;
    }
    if (seen.has(lead.email)) continue;
    seen.add(lead.email);
    leads.push(lead);
  }

  return { leads, invalid, total: leads.length };
}

export function toSmsAddress(phone, gateway) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) {
    throw new Error('Phone number required for SMTP-to-SMS');
  }
  const g = String(gateway || '').trim();
  if (!g) {
    throw new Error('SMS gateway is not set on this sender');
  }
  if (g.includes('{number}') || g.includes('{phone}')) {
    return g.replaceAll('{number}', digits).replaceAll('{phone}', digits);
  }
  if (g.startsWith('@')) return `${digits}${g}`;
  if (g.includes('@') && !g.includes('.')) {
    return g.replace('{number}', digits);
  }
  return `${digits}@${g.replace(/^@/, '')}`;
}
