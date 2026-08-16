// Small, allow-listed email attachments. Executables and archives are refused.

export const MAX_FILES = 4;
export const MAX_BYTES = 400 * 1024;
export const MAX_TOTAL_BYTES = 800 * 1024;

const TYPE_BY_EXT = {
  html: 'text/html',
  htm: 'text/html',
  txt: 'text/plain',
  csv: 'text/csv',
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
};

const ALLOWED_TYPES = new Set(Object.values(TYPE_BY_EXT));

const DENIED_EXT = new Set([
  'exe', 'com', 'scr', 'pif', 'msi', 'msp', 'dll', 'sys',
  'js', 'mjs', 'cjs', 'vbs', 'vbe', 'jse', 'wsf', 'wsh',
  'bat', 'cmd', 'ps1', 'psm1', 'reg',
  'jar', 'war', 'ear',
  'zip', 'rar', '7z', 'gz', 'tgz', 'tar', 'bz2',
  'docm', 'xlsm', 'pptm', 'dotm', 'xlam',
  'iso', 'img', 'dmg',
]);

export function extOf(name) {
  const m = String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : '';
}

export function sanitizeFilename(name) {
  const base = String(name || 'file').split(/[/\\]/).pop() || 'file';
  const cleaned = base.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
  return cleaned || 'file';
}

export function sanitizeHtmlAttachment(html) {
  return String(html || '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<iframe\b[\s\S]*?<\/iframe>/gi, '')
    .replace(/<object\b[\s\S]*?<\/object>/gi, '')
    .replace(/<embed\b[^>]*>/gi, '')
    .replace(/<link\b[^>]*>/gi, '')
    .replace(/<meta\b[^>]*>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/javascript\s*:/gi, '');
}

function decodeBase64(raw) {
  const s = String(raw || '').replace(/^data:[^;]+;base64,/, '').replace(/\s+/g, '');
  if (!s) return Buffer.alloc(0);
  if (!/^[A-Za-z0-9+/]+=*$/.test(s) || s.length % 4 !== 0) {
    throw new Error('Attachment content must be base64');
  }
  return Buffer.from(s, 'base64');
}

export function parseStored(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function htmlFromAttachments(list) {
  const out = [];
  for (const a of list || []) {
    if (!String(a.content_type || '').includes('html')) continue;
    try {
      out.push(Buffer.from(String(a.content || ''), 'base64').toString('utf8'));
    } catch {
      /* skip */
    }
  }
  return out;
}

export function makeHtmlAttachment(filename, html) {
  const clean = sanitizeHtmlAttachment(html);
  const name = sanitizeFilename(filename.endsWith('.html') || filename.endsWith('.htm') ? filename : `${filename}.html`);
  return {
    filename: name,
    content_type: 'text/html',
    content: Buffer.from(clean, 'utf8').toString('base64'),
    size: Buffer.byteLength(clean),
  };
}

export function normalizeAttachments(raw, { attachHtml, html, htmlName } = {}) {
  const incoming = Array.isArray(raw) ? raw.slice() : [];
  if (attachHtml && html) {
    incoming.push(makeHtmlAttachment(htmlName || 'letter.html', html));
  }
  if (!incoming.length) return { attachments: [], json: '[]' };
  if (incoming.length > MAX_FILES) {
    return { error: `At most ${MAX_FILES} attachments` };
  }

  const out = [];
  let total = 0;
  for (const item of incoming) {
    const filename = sanitizeFilename(item?.filename || item?.name || 'file');
    const ext = extOf(filename);
    if (!ext) return { error: `Attachment ${filename} needs a file extension` };
    if (DENIED_EXT.has(ext)) {
      return { error: `.${ext} files are not allowed` };
    }
    const type = TYPE_BY_EXT[ext];
    if (!type || !ALLOWED_TYPES.has(type)) {
      return { error: `File type .${ext} is not allowed. Use html, txt, pdf, png, jpg, gif, or csv.` };
    }
    let buf;
    try {
      buf = Buffer.isBuffer(item.buffer) ? item.buffer : decodeBase64(item.content || item.content_base64 || '');
    } catch (e) {
      return { error: e.message || 'Invalid attachment encoding' };
    }
    if (!buf.length) return { error: `${filename} is empty` };
    if (buf.length > MAX_BYTES) {
      return { error: `${filename} is over ${Math.round(MAX_BYTES / 1024)} KB` };
    }
    total += buf.length;
    if (total > MAX_TOTAL_BYTES) {
      return { error: `Attachments together must stay under ${Math.round(MAX_TOTAL_BYTES / 1024)} KB` };
    }
    let content = buf.toString('base64');
    if (type === 'text/html') {
      const clean = sanitizeHtmlAttachment(buf.toString('utf8'));
      content = Buffer.from(clean, 'utf8').toString('base64');
    }
    out.push({
      filename,
      content_type: type,
      content,
      size: Buffer.from(content, 'base64').length,
    });
  }
  return { attachments: out, json: JSON.stringify(out) };
}

export function toNodemailerAttachments(list) {
  return (list || []).map((a) => ({
    filename: a.filename,
    content: Buffer.from(a.content, 'base64'),
    contentType: a.content_type,
  }));
}

export function toSendGridAttachments(list) {
  return (list || []).map((a) => ({
    content: a.content,
    filename: a.filename,
    type: a.content_type,
    disposition: 'attachment',
  }));
}

export function toGraphAttachments(list) {
  return (list || []).map((a) => ({
    '@odata.type': '#microsoft.graph.fileAttachment',
    name: a.filename,
    contentType: a.content_type,
    contentBytes: a.content,
  }));
}
