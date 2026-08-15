import { createHash, createHmac } from 'crypto';

export const API_SENDER_KINDS = new Set(['mailgun', 'sendgrid', 'aws']);

export function usesHttpApi(sender) {
  return API_SENDER_KINDS.has(sender?.kind) && (sender.auth_mode || 'smtp') === 'api';
}

export function mailgunDomain(sender) {
  const u = String(sender?.username || '').trim();
  if (u.includes('@')) return u.split('@').pop();
  return u;
}

export function mailgunApiBase(sender) {
  const region = sender?.region === 'eu' ? 'eu' : 'us';
  if (sender?.host && /mailgun\.net$/i.test(sender.host) && sender.host.startsWith('api')) {
    return `https://${sender.host}`;
  }
  return region === 'eu' ? 'https://api.eu.mailgun.net' : 'https://api.mailgun.net';
}

export function buildMailgunForm({ from, to, subject, html, text, headers }) {
  const params = new URLSearchParams();
  params.set('from', from);
  params.set('to', to);
  params.set('subject', subject || '');
  if (html) params.set('html', html);
  if (text) params.set('text', text);
  for (const [k, v] of Object.entries(headers || {})) {
    if (v == null || v === '') continue;
    params.set(`h:${k}`, String(v));
  }
  return params;
}

export function buildSendGridPayload({ fromName, fromEmail, to, subject, html, text, headers }) {
  const content = [];
  if (text) content.push({ type: 'text/plain', value: text });
  if (html) content.push({ type: 'text/html', value: html });
  if (!content.length) content.push({ type: 'text/plain', value: ' ' });
  const payload = {
    personalizations: [{ to: [{ email: to }] }],
    from: { email: fromEmail, name: fromName || undefined },
    subject: subject || '',
    content,
  };
  if (headers && Object.keys(headers).length) payload.headers = headers;
  return payload;
}

export function buildSesPayload({ from, to, subject, html, text, headers }) {
  const body = {};
  if (html) body.Html = { Data: html, Charset: 'UTF-8' };
  if (text) body.Text = { Data: text, Charset: 'UTF-8' };
  if (!body.Html && !body.Text) body.Text = { Data: ' ', Charset: 'UTF-8' };
  const payload = {
    FromEmailAddress: from,
    Destination: { ToAddresses: [to] },
    Content: {
      Simple: {
        Subject: { Data: subject || '', Charset: 'UTF-8' },
        Body: body,
      },
    },
  };
  const reply = headers?.['Reply-To'] || headers?.['reply-to'];
  if (reply) payload.ReplyToAddresses = [String(reply)];
  const extra = { ...(headers || {}) };
  delete extra['Reply-To'];
  delete extra['reply-to'];
  const headerList = Object.entries(extra)
    .filter(([, v]) => v != null && v !== '')
    .map(([Name, Value]) => ({ Name, Value: String(Value) }));
  if (headerList.length) payload.Content.Simple.Headers = headerList;
  return payload;
}

function sha256Hex(data) {
  return createHash('sha256').update(data || '', 'utf8').digest('hex');
}

function hmacBuf(key, data) {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

function encodeRfc3986(s) {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

export function signAwsV4({
  method,
  url,
  body = '',
  region,
  service,
  accessKeyId,
  secretAccessKey,
  amzDate,
}) {
  const u = new URL(url);
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(body);
  const headers = {
    host: u.host,
    'x-amz-date': amzDate,
  };
  if (body) headers['content-type'] = 'application/json';
  const signedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderNames.map((k) => `${k}:${headers[k]}\n`).join('');
  const signedHeaders = signedHeaderNames.join(';');
  const canonicalQuery = [...u.searchParams.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${encodeRfc3986(k)}=${encodeRfc3986(v)}`)
    .join('&');
  const canonicalRequest = [
    method.toUpperCase(),
    u.pathname || '/',
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, sha256Hex(canonicalRequest)].join('\n');
  const kDate = hmacBuf(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = hmacBuf(kDate, region);
  const kService = hmacBuf(kRegion, service);
  const kSigning = hmacBuf(kService, 'aws4_request');
  const signature = createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return { headers, canonicalRequest, stringToSign, signature, credentialScope };
}

async function readApiError(res, fallback) {
  const raw = await res.text();
  let msg = fallback;
  try {
    const j = JSON.parse(raw);
    msg = j.message || j.Message || j.error || j.errors?.[0]?.message || raw || fallback;
  } catch {
    msg = raw || fallback;
  }
  throw new Error(msg);
}

export async function sendViaMailgun(sender, { from, to, subject, html, text, headers }) {
  const domain = mailgunDomain(sender);
  if (!domain) throw new Error('Mailgun sending domain is required (username)');
  if (!sender.password) throw new Error('Mailgun API key is required');
  const form = buildMailgunForm({ from, to, subject, html, text, headers });
  const res = await fetch(`${mailgunApiBase(sender)}/v3/${encodeURIComponent(domain)}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`api:${sender.password}`).toString('base64')}`,
    },
    body: form,
  });
  if (!res.ok) await readApiError(res, `Mailgun HTTP ${res.status}`);
  const data = await res.json().catch(() => ({}));
  return data.id || 'mailgun';
}

export async function verifyMailgun(sender) {
  const domain = mailgunDomain(sender);
  if (!domain) throw new Error('Mailgun sending domain is required (username)');
  const res = await fetch(`${mailgunApiBase(sender)}/v3/domains/${encodeURIComponent(domain)}`, {
    headers: {
      Authorization: `Basic ${Buffer.from(`api:${sender.password}`).toString('base64')}`,
    },
  });
  if (!res.ok) await readApiError(res, `Mailgun verify HTTP ${res.status}`);
  return true;
}

export async function sendViaSendGrid(sender, { fromName, fromEmail, to, subject, html, text, headers }) {
  if (!sender.password) throw new Error('SendGrid API key is required');
  const payload = buildSendGridPayload({ fromName, fromEmail, to, subject, html, text, headers });
  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${sender.password}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) await readApiError(res, `SendGrid HTTP ${res.status}`);
  return res.headers.get('x-message-id') || 'sendgrid';
}

export async function verifySendGrid(sender) {
  if (!sender.password) throw new Error('SendGrid API key is required');
  const res = await fetch('https://api.sendgrid.com/v3/scopes', {
    headers: { Authorization: `Bearer ${sender.password}` },
  });
  if (!res.ok) await readApiError(res, `SendGrid verify HTTP ${res.status}`);
  return true;
}

function sesApiUrl(sender, path) {
  const region = sender.region || 'us-east-1';
  const host =
    sender.host && sender.host.startsWith('email.')
      ? sender.host
      : `email.${region}.amazonaws.com`;
  return `https://${host}${path}`;
}

async function sesRequest(sender, { method, path, body }) {
  if (!sender.username || !sender.password) {
    throw new Error('AWS access key ID and secret access key are required');
  }
  const region = sender.region || 'us-east-1';
  const url = sesApiUrl(sender, path);
  const amzDate = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const signed = signAwsV4({
    method,
    url,
    body: body || '',
    region,
    service: 'ses',
    accessKeyId: sender.username,
    secretAccessKey: sender.password,
    amzDate,
  });
  const headers = { ...signed.headers };
  const res = await fetch(url, { method, headers, body: body || undefined });
  if (!res.ok) await readApiError(res, `AWS SES HTTP ${res.status}`);
  if (res.status === 204) return {};
  const text = await res.text();
  return text ? JSON.parse(text) : {};
}

export async function sendViaSes(sender, { from, to, subject, html, text, headers }) {
  const payload = buildSesPayload({ from, to, subject, html, text, headers });
  const data = await sesRequest(sender, {
    method: 'POST',
    path: '/v2/email/send-email',
    body: JSON.stringify(payload),
  });
  return data.MessageId || 'ses';
}

export async function verifySes(sender) {
  if (!sender.region) throw new Error('AWS region is required');
  await sesRequest(sender, { method: 'GET', path: '/v2/email/account' });
  return true;
}
