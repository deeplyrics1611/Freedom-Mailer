import { config } from './config.js';
import { decryptSecret } from './secrets.js';

/** Catalog of SMS gateways the panel can send through. */
export const PROVIDER_META = {
  twilio: {
    label: 'Twilio',
    hint: 'Console → Account SID, Auth Token, and a From number or Messaging Service.',
    fields: [
      { name: 'api_key', label: 'TWILIO_ACCOUNT_SID', placeholder: 'ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' },
      { name: 'api_secret', label: 'TWILIO_AUTH_TOKEN', type: 'password', placeholder: 'Auth Token' },
      { name: 'from_number', label: 'From number', placeholder: '+15551234567' },
      { name: 'messaging_service_sid', label: 'Messaging Service SID (optional)', placeholder: 'MGxxxx' },
    ],
  },
  twilio_compat: {
    label: 'Twilio-compatible API',
    hint: 'Any gateway that speaks the Twilio Messages API (custom base URL).',
    fields: [
      { name: 'api_key', label: 'Account SID', placeholder: 'ACxxxx or username' },
      { name: 'api_secret', label: 'Auth Token', type: 'password' },
      { name: 'from_number', label: 'From number', placeholder: '+15551234567' },
      { name: 'base_url', label: 'API base URL', placeholder: 'https://api.example.com' },
    ],
  },
  vonage: {
    label: 'Vonage (Nexmo)',
    hint: 'API key + secret from the Vonage dashboard. From can be a brand name or number.',
    fields: [
      { name: 'api_key', label: 'API key' },
      { name: 'api_secret', label: 'API secret', type: 'password' },
      { name: 'from_number', label: 'From', placeholder: 'QuoteMail or +15551234567' },
    ],
  },
  messagebird: {
    label: 'MessageBird',
    hint: 'Live API access key and an originator (number or alphanumeric).',
    fields: [
      { name: 'api_key', label: 'Access key', type: 'password' },
      { name: 'from_number', label: 'Originator', placeholder: '+15551234567' },
    ],
  },
  plivo: {
    label: 'Plivo',
    hint: 'Auth ID + Auth Token from the Plivo console.',
    fields: [
      { name: 'api_key', label: 'Auth ID', placeholder: 'MAxxxx' },
      { name: 'api_secret', label: 'Auth Token', type: 'password' },
      { name: 'from_number', label: 'From number', placeholder: '+15551234567' },
    ],
  },
  telnyx: {
    label: 'Telnyx',
    hint: 'V2 API key (Bearer) and a Telnyx number in E.164.',
    fields: [
      { name: 'api_key', label: 'API key', type: 'password', placeholder: 'KEY...' },
      { name: 'from_number', label: 'From number', placeholder: '+15551234567' },
    ],
  },
  infobip: {
    label: 'Infobip',
    hint: 'API key and base URL from your Infobip account (portal).',
    fields: [
      { name: 'api_key', label: 'API key', type: 'password' },
      { name: 'from_number', label: 'From', placeholder: 'QuoteMail' },
      { name: 'base_url', label: 'Base URL', placeholder: 'https://xxxx.api.infobip.com' },
    ],
  },
  clicksend: {
    label: 'ClickSend',
    hint: 'Username plus API key from ClickSend → API Credentials.',
    fields: [
      { name: 'api_key', label: 'Username' },
      { name: 'api_secret', label: 'API key', type: 'password' },
      { name: 'from_number', label: 'From (optional)' },
    ],
  },
  sinch: {
    label: 'Sinch',
    hint: 'SMS REST: service plan ID and API token.',
    fields: [
      { name: 'api_key', label: 'Service plan ID' },
      { name: 'api_secret', label: 'API token', type: 'password' },
      { name: 'from_number', label: 'From number', placeholder: '+15551234567' },
    ],
  },
  custom_http: {
    label: 'Custom HTTPS webhook',
    hint: 'POST JSON to your own SMS gateway. Body may use {{to}}, {{body}}, {{from}}.',
    fields: [
      { name: 'api_key', label: 'Bearer token (optional)', type: 'password' },
      { name: 'from_number', label: 'From' },
      { name: 'base_url', label: 'HTTPS URL', placeholder: 'https://sms.yourcompany.com/send' },
      { name: 'body_template', label: 'JSON body template', placeholder: '{"to":"{{to}}","text":"{{body}}","from":"{{from}}"}' },
    ],
  },
};

export function providerList() {
  return Object.entries(PROVIDER_META).map(([id, m]) => ({ id, ...m }));
}

/** Normalize to E.164-ish. 10-digit US numbers get +1. */
export function normalizePhone(raw, defaultCountry = '1') {
  const s = String(raw || '').trim();
  if (!s) return '';
  const keepPlus = s.trim().startsWith('+');
  const digits = s.replace(/[^\d]/g, '');
  if (!digits) return '';
  if (keepPlus) return `+${digits}`;
  if (digits.length === 10) return `+${defaultCountry}${digits}`;
  if (digits.length === 11 && digits.startsWith(defaultCountry)) return `+${digits}`;
  return `+${digits}`;
}

export function smsSegments(text) {
  const str = String(text || '');
  const unicode = /[^\x00-\x7F]/.test(str);
  const single = unicode ? 70 : 160;
  const concat = unicode ? 67 : 153;
  const length = [...str].length;
  const segments = length === 0 ? 0 : length <= single ? 1 : Math.ceil(length / concat);
  return { length, unicode, segments, singleLimit: single };
}

export function withSmsOptOut(body) {
  const b = String(body || '').trim();
  if (/stop/i.test(b)) return b;
  return `${b}\n\nReply STOP to opt out.`.trim();
}

export function extraOf(row) {
  try {
    return JSON.parse(row?.extra_json || '{}') || {};
  } catch {
    return {};
  }
}

export function systemProvider() {
  const t = config.twilio || {};
  if (t.accountSid && t.authToken && (t.fromNumber || t.messagingServiceSid)) {
    return {
      id: null,
      provider: 'twilio',
      label: 'System Twilio (.env)',
      api_key: t.accountSid,
      api_secret: t.authToken,
      from_number: t.fromNumber || '',
      extra_json: JSON.stringify({ messaging_service_sid: t.messagingServiceSid || '' }),
      verified: 1,
      active: 1,
      system: true,
    };
  }
  const v = config.vonage || {};
  if (v.apiKey && v.apiSecret && v.from) {
    return {
      id: null,
      provider: 'vonage',
      label: 'System Vonage (.env)',
      api_key: v.apiKey,
      api_secret: v.apiSecret,
      from_number: v.from,
      extra_json: '{}',
      verified: 1,
      active: 1,
      system: true,
    };
  }
  return null;
}

export function smsEnabled() {
  return !!systemProvider();
}

function basic(user, pass) {
  return `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
}

function creds(p) {
  return {
    key: decryptSecret(p.api_key || ''),
    secret: decryptSecret(p.api_secret || ''),
    from: p.from_number || '',
    extra: extraOf(p),
  };
}

function assertPublicHttps(url) {
  let u;
  try { u = new URL(url); } catch { throw new Error('Invalid SMS webhook URL'); }
  if (u.protocol !== 'https:') throw new Error('Custom SMS URL must be https://');
  const host = u.hostname.toLowerCase();
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.local')) {
    throw new Error('Local hosts are not allowed for custom SMS URLs');
  }
  if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.|169\.254\.|0\.)/.test(host)) {
    throw new Error('Private network hosts are not allowed for custom SMS URLs');
  }
  return u.toString().replace(/\/$/, '');
}

/** Build the outbound HTTP call (exported for tests). */
export function buildSmsRequest(provider, to, body) {
  const kind = provider.provider;
  const { key, secret, from, extra } = creds(provider);
  const dest = normalizePhone(to);
  if (!dest) throw new Error('Invalid destination number');
  if (!body || !String(body).trim()) throw new Error('SMS body is required');

  if (kind === 'twilio' || kind === 'twilio_compat') {
    const base = assertPublicHttps(extra.base_url || 'https://api.twilio.com');
    const params = new URLSearchParams({ To: dest, Body: String(body) });
    if (extra.messaging_service_sid) params.set('MessagingServiceSid', extra.messaging_service_sid);
    else {
      if (!from) throw new Error('Twilio From number or Messaging Service SID is required');
      params.set('From', from);
    }
    return {
      url: `${base}/2010-04-01/Accounts/${encodeURIComponent(key)}/Messages.json`,
      headers: {
        Authorization: basic(key, secret),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
      parse: 'twilio',
    };
  }

  if (kind === 'vonage') {
    return {
      url: 'https://rest.nexmo.com/sms/json',
      headers: { 'Content-Type': 'application/json' },
      json: { api_key: key, api_secret: secret, to: dest.replace(/^\+/, ''), from, text: String(body) },
      parse: 'vonage',
    };
  }

  if (kind === 'messagebird') {
    return {
      url: 'https://rest.messagebird.com/messages',
      headers: { Authorization: `AccessKey ${key}`, 'Content-Type': 'application/json' },
      json: { originator: from, recipients: [dest], body: String(body) },
      parse: 'id',
    };
  }

  if (kind === 'plivo') {
    return {
      url: `https://api.plivo.com/v1/Account/${encodeURIComponent(key)}/Message/`,
      headers: { Authorization: basic(key, secret), 'Content-Type': 'application/json' },
      json: { src: from, dst: dest, text: String(body) },
      parse: 'plivo',
    };
  }

  if (kind === 'telnyx') {
    return {
      url: 'https://api.telnyx.com/v2/messages',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      json: { from, to: dest, text: String(body) },
      parse: 'telnyx',
    };
  }

  if (kind === 'infobip') {
    const base = assertPublicHttps(extra.base_url || 'https://api.infobip.com');
    return {
      url: `${base}/sms/2/text/advanced`,
      headers: { Authorization: `App ${key}`, 'Content-Type': 'application/json' },
      json: { messages: [{ from, destinations: [{ to: dest }], text: String(body) }] },
      parse: 'infobip',
    };
  }

  if (kind === 'clicksend') {
    return {
      url: 'https://rest.clicksend.com/v3/sms/send',
      headers: { Authorization: basic(key, secret), 'Content-Type': 'application/json' },
      json: { messages: [{ source: 'sdk', body: String(body), to: dest, from: from || undefined }] },
      parse: 'clicksend',
    };
  }

  if (kind === 'sinch') {
    return {
      url: `https://${encodeURIComponent(key)}.sms.api.sinch.com/xms/v1/${encodeURIComponent(key)}/batches`,
      headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
      json: { from, to: [dest], body: String(body) },
      parse: 'id',
    };
  }

  if (kind === 'custom_http') {
    const url = assertPublicHttps(extra.base_url || extra.url);
    const tpl = extra.body_template || '{"to":"{{to}}","text":"{{body}}","from":"{{from}}"}';
    const filled = tpl
      .replaceAll('{{to}}', dest)
      .replaceAll('{{body}}', String(body).replace(/"/g, '\\"'))
      .replaceAll('{{from}}', from);
    let json;
    try { json = JSON.parse(filled); } catch { throw new Error('Custom body template is not valid JSON after merge'); }
    const headers = { 'Content-Type': 'application/json' };
    if (key) headers.Authorization = `Bearer ${key}`;
    return { url, headers, json, parse: 'id' };
  }

  throw new Error(`Unknown SMS provider: ${kind}`);
}

function parseProviderError(kind, status, data) {
  if (kind === 'twilio' || kind === 'twilio_compat') return data.message || data.error_message;
  if (kind === 'vonage') {
    const msg = data.messages?.[0];
    if (msg && msg.status !== '0') return msg['error-text'] || `Vonage status ${msg.status}`;
  }
  if (kind === 'telnyx') return data.errors?.[0]?.detail;
  if (kind === 'clicksend') return data.response_msg || data.data?.messages?.[0]?.status;
  if (kind === 'infobip') return data.requestError?.serviceException?.text;
  return data.message || data.error || data.detail;
}

function parseSid(kind, data) {
  if (kind === 'twilio' || kind === 'twilio_compat') return data.sid;
  if (kind === 'vonage') return data.messages?.[0]?.['message-id'];
  if (kind === 'plivo') return data.message_uuid?.[0] || data.message;
  if (kind === 'telnyx') return data.data?.id;
  if (kind === 'clicksend') return data.data?.messages?.[0]?.message_id;
  if (kind === 'infobip') return data.messages?.[0]?.messageId;
  return data.id || data.sid || data.message_id || 'ok';
}

export async function sendSms({ to, body, provider }) {
  const p = provider || systemProvider();
  if (!p) throw new Error('SMS is not configured. Add a provider in the SMS section or set TWILIO_* env vars.');
  const req = buildSmsRequest(p, to, body);
  const res = await fetch(req.url, {
    method: 'POST',
    headers: req.headers,
    body: req.json ? JSON.stringify(req.json) : req.body,
  });
  const data = await res.json().catch(() => ({}));
  const kind = p.provider;
  if (kind === 'vonage') {
    const st = data.messages?.[0]?.status;
    if (st && st !== '0') throw new Error(parseProviderError(kind, res.status, data) || 'Vonage send failed');
    return parseSid(kind, data);
  }
  if (!res.ok) {
    throw new Error(parseProviderError(kind, res.status, data) || `SMS provider error (${res.status})`);
  }
  return parseSid(kind, data);
}

export async function verifySmsProvider(provider) {
  const kind = provider.provider;
  const { key, secret, extra } = creds(provider);
  if (!PROVIDER_META[kind]) throw new Error('Unknown provider');
  if (kind === 'custom_http') {
    assertPublicHttps(extra.base_url || extra.url);
    return true;
  }
  if (kind === 'twilio' || kind === 'twilio_compat') {
    const base = assertPublicHttps(extra.base_url || 'https://api.twilio.com');
    const res = await fetch(`${base}/2010-04-01/Accounts/${encodeURIComponent(key)}.json`, {
      headers: { Authorization: basic(key, secret) },
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.message || `Twilio verify failed (${res.status})`);
    }
    return true;
  }
  if (kind === 'vonage') {
    const url = `https://rest.nexmo.com/account/get-balance?api_key=${encodeURIComponent(key)}&api_secret=${encodeURIComponent(secret)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Vonage verify failed (${res.status})`);
    return true;
  }
  if (kind === 'messagebird') {
    const res = await fetch('https://rest.messagebird.com/balance', {
      headers: { Authorization: `AccessKey ${key}` },
    });
    if (!res.ok) throw new Error(`MessageBird verify failed (${res.status})`);
    return true;
  }
  if (kind === 'plivo') {
    const res = await fetch(`https://api.plivo.com/v1/Account/${encodeURIComponent(key)}/`, {
      headers: { Authorization: basic(key, secret) },
    });
    if (!res.ok) throw new Error(`Plivo verify failed (${res.status})`);
    return true;
  }
  if (kind === 'telnyx') {
    const res = await fetch('https://api.telnyx.com/v2/balance', {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!res.ok) throw new Error(`Telnyx verify failed (${res.status})`);
    return true;
  }
  if (kind === 'clicksend') {
    const res = await fetch('https://rest.clicksend.com/v3/account', {
      headers: { Authorization: basic(key, secret) },
    });
    if (!res.ok) throw new Error(`ClickSend verify failed (${res.status})`);
    return true;
  }
  if (kind === 'infobip') {
    const base = assertPublicHttps(extra.base_url || 'https://api.infobip.com');
    const res = await fetch(`${base}/account/1/balance`, {
      headers: { Authorization: `App ${key}` },
    });
    if (!res.ok) throw new Error(`Infobip verify failed (${res.status})`);
    return true;
  }
  if (kind === 'sinch') {
    if (!key || !secret) throw new Error('Sinch service plan ID and API token are required');
    return true;
  }
  return true;
}
