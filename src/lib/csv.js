// RFC 4180 CSV parsing, with delimiter sniffing because exports from Excel in
// European locales use semicolons and CRM exports often use tabs.

function detectDelimiter(sample) {
  const candidates = [',', ';', '\t', '|'];
  let best = ',';
  let bestCount = 0;
  for (const d of candidates) {
    // Count only separators outside quoted sections.
    let count = 0;
    let inQuotes = false;
    for (let i = 0; i < sample.length; i++) {
      const ch = sample[i];
      if (ch === '"') inQuotes = !inQuotes;
      else if (ch === d && !inQuotes) count++;
      else if (ch === '\n' && !inQuotes) break;
    }
    if (count > bestCount) {
      bestCount = count;
      best = d;
    }
  }
  return best;
}

export function parseCsv(input, options = {}) {
  let text = String(input || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  if (!text.trim()) return { headers: [], rows: [] };

  const delimiter = options.delimiter || detectDelimiter(text.slice(0, 4000));
  const records = [];
  let field = '';
  let record = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      record.push(field);
      field = '';
    } else if (ch === '\n') {
      record.push(field);
      records.push(record);
      record = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (field !== '' || record.length) {
    record.push(field);
    records.push(record);
  }

  const nonEmpty = records.filter((r) => r.some((c) => c.trim() !== ''));
  if (!nonEmpty.length) return { headers: [], rows: [], delimiter };

  const headers = nonEmpty[0].map((h) => h.trim());
  const rows = nonEmpty.slice(1).map((r) => {
    const obj = {};
    headers.forEach((h, i) => {
      if (h) obj[h] = (r[i] ?? '').trim();
    });
    return obj;
  });

  return { headers, rows, delimiter };
}

const needsQuoting = (v) => /[",\n\r]/.test(v);

export function toCsv(rows, headers) {
  const cols = headers || [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const cell = (v) => {
    const s = v === undefined || v === null ? '' : String(v);
    return needsQuoting(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\r\n');
}

// Column names vary wildly between lead sources; map the common ones onto a
// canonical set so merge fields work without manual mapping.
const HEADER_ALIASES = {
  email: ['email', 'email address', 'e-mail', 'emailaddress', 'mail', 'work email', 'contact email', 'business email'],
  first_name: ['first name', 'firstname', 'first', 'given name', 'fname'],
  last_name: ['last name', 'lastname', 'last', 'surname', 'family name', 'lname'],
  name: ['name', 'full name', 'fullname', 'contact name', 'contact'],
  company: ['company', 'company name', 'organisation', 'organization', 'account', 'business', 'employer', 'supplier'],
  title: ['title', 'job title', 'position', 'role', 'jobtitle'],
  phone: ['phone', 'telephone', 'mobile', 'phone number', 'tel'],
  website: ['website', 'url', 'site', 'domain', 'web'],
  country: ['country', 'location', 'region'],
  city: ['city', 'town'],
  industry: ['industry', 'sector', 'vertical'],
  product: ['product', 'item', 'part', 'material', 'sku'],
  quantity: ['quantity', 'qty', 'volume', 'units'],
};

const normalize = (s) => String(s).toLowerCase().trim().replace(/[_\-.]+/g, ' ').replace(/\s+/g, ' ');

export function canonicalHeader(header) {
  const n = normalize(header);
  for (const [canonical, aliases] of Object.entries(HEADER_ALIASES)) {
    if (aliases.includes(n)) return canonical;
  }
  return n.replace(/\s+/g, '_');
}

/** Find the column holding email addresses, by name or by content. */
export function findEmailColumn(headers, rows) {
  const byName = headers.find((h) => canonicalHeader(h) === 'email');
  if (byName) return byName;
  const sample = rows.slice(0, 25);
  let best = null;
  let bestHits = 0;
  for (const h of headers) {
    const hits = sample.filter((r) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(r[h] || '').trim())).length;
    if (hits > bestHits) {
      bestHits = hits;
      best = h;
    }
  }
  return bestHits >= Math.max(1, Math.floor(sample.length / 2)) ? best : null;
}
