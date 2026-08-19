import dns from 'node:dns/promises';
import { SMTP_CATALOG, smtpById } from './smtpCatalog.js';

const EMAIL_RE =
  /[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+/;

const DOMAIN_HINTS = [
  { test: /(^|\.)gmail\.com$|(^|\.)googlemail\.com$/, catalog_id: 'gmail-smtp' },
  { test: /(^|\.)outlook\.com$|(^|\.)hotmail\.com$|(^|\.)live\.com$|(^|\.)office365\.com$|(^|\.)msn\.com$/, catalog_id: 'office365' },
  { test: /(^|\.)sendgrid\.net$/, catalog_id: 'sendgrid' },
  { test: /(^|\.)mandrillapp\.com$|(^|\.)mailchimp\.com$/, catalog_id: 'mailchimp' },
  { test: /(^|\.)mailgun\.org$/, catalog_id: 'mailgun' },
  { test: /(^|\.)postmarkapp\.com$/, catalog_id: 'postmark' },
  { test: /(^|\.)sparkpostmail\.com$/, catalog_id: 'sparkpost' },
  { test: /(^|\.)brevo\.com$|(^|\.)sendinblue\.com$/, catalog_id: 'brevo' },
  { test: /(^|\.)mailjet\.com$/, catalog_id: 'mailjet' },
  { test: /(^|\.)sakura\.ne\.jp$/, catalog_id: 'sakura' },
  { test: /(^|\.)lolipop\.jp$/, catalog_id: 'lolipop' },
  { test: /(^|\.)xserver\.jp$|(^|\.)xvps\.jp$/, catalog_id: 'xserver' },
  { test: /(^|\.)valuedomain\.com$|(^|\.)value-domain\.com$/, catalog_id: 'value-domain' },
  { test: /(^|\.)muumuu-mail\.com$|(^|\.)muumuu-domain\.com$/, catalog_id: 'muumuu' },
  { test: /(^|\.)heteml\.jp$/, catalog_id: 'heteml' },
  { test: /(^|\.)conoha\.jp$|(^|\.)conoha\.ne\.jp$/, catalog_id: 'conoha' },
];

const MX_HINTS = [
  { test: /google\.com$|googlemail\.com$/, catalog_id: 'gmail-smtp' },
  { test: /protection\.outlook\.com$|outlook\.com$/, catalog_id: 'office365' },
  { test: /inbound-smtp\.ap-northeast-1\.amazonaws\.com$/, catalog_id: 'ses-ap-northeast-1' },
  { test: /inbound-smtp\.ap-northeast-3\.amazonaws\.com$/, catalog_id: 'ses-ap-northeast-3' },
  { test: /inbound-smtp\.(us-east-1)\.amazonaws\.com$/, catalog_id: 'ses-us-east-1' },
  { test: /amazonses\.com$/, catalog_id: 'ses-us-east-1' },
  { test: /sakura\.ne\.jp$/, catalog_id: 'sakura' },
  { test: /lolipop\.jp$/, catalog_id: 'lolipop' },
  { test: /xserver\.jp$/, catalog_id: 'xserver' },
  { test: /muumuu-mail\.com$/, catalog_id: 'muumuu' },
  { test: /heteml\.jp$/, catalog_id: 'heteml' },
  { test: /conoha\.(jp|ne\.jp)$/, catalog_id: 'conoha' },
  { test: /sendgrid\.net$/, catalog_id: 'sendgrid' },
];

function pick(obj, keys) {
  for (const k of keys) {
    if (obj[k] != null && String(obj[k]).trim() !== '') return String(obj[k]).trim();
  }
  return '';
}

function parsePort(raw, secure) {
  const n = parseInt(raw, 10);
  if (n >= 1 && n <= 65535) return n;
  return secure ? 465 : 587;
}

/** Pull host/user/pass/port from a pasted control-panel dump or URI. */
export function parseSmtpPaste(text) {
  const raw = String(text || '').replace(/\r/g, '');
  const out = {
    host: '', port: '', secure: null, username: '', password: '',
    from_email: '', socks5_host: '', socks5_port: '', socks5_user: '', socks5_pass: '',
  };

  const uri = raw.match(/smtps?:\/\/(?:([^:@\s\/]+)(?::([^@\s\/]*))?@)?([^:\/\s]+)(?::(\d+))?/i);
  if (uri) {
    out.username = decodeURIComponent(uri[1] || '');
    out.password = decodeURIComponent(uri[2] || '');
    out.host = uri[3];
    out.port = uri[4] || '';
    if (/^smtps:/i.test(uri[0])) out.secure = true;
  }

  const socks = raw.match(/socks5:\/\/(?:([^:@\s\/]+)(?::([^@\s\/]*))?@)?([^:\/\s]+)(?::(\d+))?/i);
  if (socks) {
    out.socks5_user = decodeURIComponent(socks[1] || '');
    out.socks5_pass = decodeURIComponent(socks[2] || '');
    out.socks5_host = socks[3];
    out.socks5_port = socks[4] || '1080';
  }

  const lines = {};
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*([^:\n=]{2,40})\s*[:=]\s*(.+?)\s*$/);
    if (!m) continue;
    const key = m[1].trim().toLowerCase().replace(/[\s_]+/g, '');
    lines[key] = m[2].trim().replace(/^["']|["']$/g, '');
  }

  out.host = out.host || pick(lines, [
    'smtphost', 'smtpserver', 'smtpservername', 'host', 'server', 'hostname',
    'outgoing', 'outgoingserver', 'mailserver', '送信サーバー', 'smtpサーバー', 'サーバー',
  ]);
  const portRaw = pick(lines, ['smtpport', 'port', 'ポート', 'smtpポート']);
  if (portRaw) out.port = String(parseInt(portRaw, 10) || out.port);
  out.username = out.username || pick(lines, [
    'smtpusername', 'username', 'user', 'login', 'account', 'userid',
    'ユーザー名', 'アカウント', 'smtpユーザー',
  ]);
  out.password = out.password || pick(lines, [
    'smtppassword', 'password', 'pass', 'apppassword', 'apikey', 'secret',
    'パスワード', 'smtpパスワード',
  ]);
  out.from_email = pick(lines, ['from', 'fromemail', 'email', 'address', 'mail', 'メールアドレス']);
  out.socks5_host = out.socks5_host || pick(lines, ['socks5host', 'socks5', 'proxyhost', 'sockshost']);
  const sp = pick(lines, ['socks5port', 'proxyport', 'socksport']);
  if (sp) out.socks5_port = String(parseInt(sp, 10) || 1080);
  if (out.socks5_host && /:\d+$/.test(out.socks5_host)) {
    const cut = out.socks5_host.lastIndexOf(':');
    if (!out.socks5_port) out.socks5_port = out.socks5_host.slice(cut + 1);
    out.socks5_host = out.socks5_host.slice(0, cut);
  }
  out.socks5_user = out.socks5_user || pick(lines, ['socks5user', 'proxyuser']);
  out.socks5_pass = out.socks5_pass || pick(lines, ['socks5pass', 'socks5password', 'proxypass']);

  if (/465/.test(String(out.port)) || /ssl|tls on connect|implicit/i.test(raw)) out.secure = true;
  if (/587/.test(String(out.port)) && out.secure == null) out.secure = false;

  const emails = raw.match(new RegExp(EMAIL_RE.source, 'g')) || [];
  if (!out.from_email && emails[0]) out.from_email = emails[0].toLowerCase();
  if (!out.username && out.from_email) out.username = out.from_email;

  return out;
}

export function catalogFromHost(host) {
  const h = String(host || '').toLowerCase().replace(/\.$/, '');
  if (!h) return null;
  const exact = SMTP_CATALOG.find((p) => p.host && p.host.toLowerCase() === h);
  if (exact) return exact;
  if (/email-smtp\.ap-northeast-1\.amazonaws\.com/.test(h)) return smtpById('ses-ap-northeast-1');
  if (/email-smtp\.ap-northeast-3\.amazonaws\.com/.test(h)) return smtpById('ses-ap-northeast-3');
  if (/email-smtp\.[a-z0-9-]+\.amazonaws\.com/.test(h)) return smtpById('ses-us-east-1');
  if (/^sv\d+\.xserver\.jp$/.test(h)) return smtpById('xserver');
  if (/conoha/.test(h)) return smtpById('conoha');
  return SMTP_CATALOG.find((p) => p.host && (h === p.host || h.endsWith('.' + p.host))) || null;
}

export function inferFromDomain(domain) {
  const d = String(domain || '').toLowerCase().replace(/\.$/, '').replace(/^https?:\/\//, '').split('/')[0];
  if (!d) return null;
  if (/^sv\d+\.xserver\.jp$/.test(d)) {
    return { catalog_id: 'xserver', host: d, port: 587, secure: false, note: 'Xserver host taken from svXXX.xserver.jp' };
  }
  for (const h of DOMAIN_HINTS) {
    if (h.test.test(d)) {
      const c = smtpById(h.catalog_id);
      if (!c) continue;
      const host = c.host || (/xserver|conoha/.test(h.catalog_id) ? '' : `smtp.${d}`);
      return {
        catalog_id: c.id,
        host: host || '',
        port: c.port,
        secure: !!c.secure,
        note: c.label,
      };
    }
  }
  return {
    catalog_id: 'custom',
    host: `smtp.${d}`,
    port: 587,
    secure: false,
    note: `Guessed smtp.${d} — confirm in your host’s mail panel`,
  };
}

export function inferFromMx(mxHost) {
  const h = String(mxHost || '').toLowerCase().replace(/\.$/, '');
  for (const rule of MX_HINTS) {
    if (rule.test.test(h)) {
      const c = smtpById(rule.catalog_id);
      if (!c) continue;
      let host = c.host;
      if (c.id === 'xserver' && /^sv\d+\.xserver\.jp$/.test(h)) host = h;
      if (c.id === 'conoha') host = h.startsWith('smtp.') || h.startsWith('mail.') ? h : '';
      return { catalog_id: c.id, host, port: c.port, secure: !!c.secure, note: `MX ${h} → ${c.label}` };
    }
  }
  if (/^sv\d+\./.test(h)) {
    return { catalog_id: 'custom', host: h, port: 587, secure: false, note: `MX host ${h} looks like a shared-server SMTP` };
  }
  return null;
}

async function lookupMx(domain, timeoutMs = 4000) {
  const d = String(domain || '').toLowerCase();
  if (!d || !/^[a-z0-9.-]+$/.test(d)) return [];
  const work = dns.resolveMx(d).then((rows) =>
    (rows || []).sort((a, b) => a.priority - b.priority).map((r) => String(r.exchange || '').replace(/\.$/, ''))
  );
  const to = new Promise((_, rej) => setTimeout(() => rej(new Error('MX lookup timed out')), timeoutMs));
  try {
    return await Promise.race([work, to]);
  } catch {
    return [];
  }
}

/**
 * Extract SMTP settings from a mailbox address, domain, or pasted panel dump.
 * MX lookup is optional and only used to guess the outbound host for a domain you own.
 */
export async function extractSmtp(text, { lookupMx: doMx = true } = {}) {
  const raw = String(text || '').trim();
  if (!raw) throw new Error('Paste an email, domain, or SMTP dump');

  const pasted = parseSmtpPaste(raw);
  const emailMatch = raw.match(EMAIL_RE);
  const from_email = (pasted.from_email || emailMatch?.[0] || '').toLowerCase();
  const domain = from_email.includes('@')
    ? from_email.split('@')[1]
    : raw.split(/\s/)[0].replace(/^https?:\/\//, '').split('/')[0].toLowerCase();

  const notes = [];
  let catalog_id = '';
  let host = pasted.host;
  let port = pasted.port ? parseInt(pasted.port, 10) : 0;
  let secure = pasted.secure;
  let username = pasted.username;
  let mx = [];

  if (host) {
    const c = catalogFromHost(host);
    if (c) {
      catalog_id = c.id;
      notes.push(`Matched preset ${c.label}`);
    } else {
      catalog_id = 'custom';
      notes.push('Host taken from paste');
    }
  }

  if (!host && domain && domain.includes('.')) {
    const inferred = inferFromDomain(domain);
    if (inferred) {
      catalog_id = inferred.catalog_id;
      host = inferred.host;
      port = port || inferred.port;
      if (secure == null) secure = inferred.secure;
      notes.push(inferred.note);
    }
  }

  if (doMx && domain && domain.includes('.') && (!host || catalog_id === 'custom' || catalog_id === 'xserver' || catalog_id === 'conoha')) {
    mx = await lookupMx(domain);
    if (mx[0]) {
      const fromMx = inferFromMx(mx[0]);
      if (fromMx) {
        catalog_id = fromMx.catalog_id;
        if (fromMx.host) host = fromMx.host;
        port = port || fromMx.port;
        if (secure == null) secure = fromMx.secure;
        notes.push(fromMx.note);
      } else {
        notes.push(`MX ${mx[0]} — using guessed SMTP host`);
      }
    }
  }

  const cat = smtpById(catalog_id) || smtpById('custom');
  if (!username && cat?.defaultUsername) username = cat.defaultUsername;
  if (!username && from_email) username = from_email;
  if (!port) port = parsePort('', !!secure);
  if (secure == null) secure = port === 465;

  const japan = cat?.group === 'japan' || /ap-northeast/.test(cat?.region || '');
  if (japan) notes.push('Japan SMTP — set SOCKS5 if you send through a VPS you operate');
  if (catalog_id === 'gmail-smtp') notes.push('Gmail: prefer Gmail pool (app password) instead of Email SMTP');

  const local = from_email.includes('@') ? from_email.split('@')[0] : '';
  return {
    catalog_id: cat?.id || 'custom',
    label: cat && cat.id !== 'custom' ? `${cat.label}${local ? ` · ${local}` : ''}` : (from_email || host || 'SMTP'),
    host: host || '',
    port,
    secure: !!secure,
    username: username || '',
    password: pasted.password || '',
    from_email: from_email || '',
    from_name: local || '',
    socks5_host: pasted.socks5_host || '',
    socks5_port: pasted.socks5_port ? parseInt(pasted.socks5_port, 10) : 1080,
    socks5_user: pasted.socks5_user || '',
    socks5_pass: pasted.socks5_pass || '',
    mx,
    japan,
    notes,
  };
}
