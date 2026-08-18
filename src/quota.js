import { db } from './db.js';
import { providerCreds, systemProvider, PROVIDER_META } from './sms.js';
import { listGmailPool, poolStatus } from './rotate.js';

const TIMEOUT = 8000;

export function maskSecret(s) {
  const v = String(s || '');
  if (!v) return '';
  if (v.length <= 8) return '••••';
  return `${v.slice(0, 4)}…${v.slice(-4)}`;
}

export function pickUsage(payload, category) {
  const list = payload?.usage_records || payload?.records || (Array.isArray(payload) ? payload : []);
  const rows = Array.isArray(list) ? list : [];
  const row = (category ? rows.find((r) => r.category === category) : null) || rows[0];
  if (!row) return { count: 0, price: null, category: category || null };
  return {
    category: row.category || category || null,
    count: Number(row.count || row.quantity || 0),
    price: row.price != null ? String(row.price) : null,
    usage: row.usage != null ? String(row.usage) : null,
  };
}

async function getJson(url, headers = {}) {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.message || data.error || data.detail || data.response_msg || `HTTP ${res.status}`;
    const err = new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
    err.status = res.status;
    throw err;
  }
  return data;
}

function basic(user, pass) {
  return `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
}

function count(sql, ...params) {
  return db.prepare(sql).get(...params).n;
}

/** Live account/quota lookup for a stored SMS gateway. */
export async function lookupSmsProvider(provider) {
  const kind = provider.provider;
  const { key, secret, from, extra } = providerCreds(provider);
  const meta = {
    id: provider.id,
    system: !!provider.system,
    provider: kind,
    label: provider.label || PROVIDER_META[kind]?.label || kind,
    from_number: from,
    verified: !!provider.verified,
    active: provider.active !== 0,
    key_masked: maskSecret(key),
  };

  try {
    if (kind === 'twilio' || kind === 'twilio_compat') {
      const base = (extra.base_url || 'https://api.twilio.com').replace(/\/$/, '');
      const auth = { Authorization: basic(key, secret) };
      const sid = encodeURIComponent(key);
      const [acct, bal, today, month, numbers] = await Promise.all([
        getJson(`${base}/2010-04-01/Accounts/${sid}.json`, auth),
        getJson(`${base}/2010-04-01/Accounts/${sid}/Balance.json`, auth).catch(() => ({})),
        getJson(`${base}/2010-04-01/Accounts/${sid}/Usage/Records/Today.json?Category=sms`, auth).catch(() => ({})),
        getJson(`${base}/2010-04-01/Accounts/${sid}/Usage/Records/ThisMonth.json?Category=sms`, auth).catch(() => ({})),
        getJson(`${base}/2010-04-01/Accounts/${sid}/IncomingPhoneNumbers.json?PageSize=20`, auth).catch(() => ({})),
      ]);
      return {
        ...meta,
        ok: true,
        live: true,
        friendly_name: acct.friendly_name || '',
        status: acct.status || '',
        type: acct.type || '',
        date_created: acct.date_created || '',
        balance: bal.balance != null ? String(bal.balance) : null,
        currency: bal.currency || 'USD',
        sms_today: pickUsage(today, 'sms'),
        sms_month: pickUsage(month, 'sms'),
        numbers: (numbers.incoming_phone_numbers || []).map((n) => ({
          phone: n.phone_number,
          sid: n.sid,
          name: n.friendly_name,
        })),
        messaging_service_sid: extra.messaging_service_sid || '',
        console_url: kind === 'twilio' ? 'https://console.twilio.com/' : null,
      };
    }

    if (kind === 'vonage') {
      const q = `api_key=${encodeURIComponent(key)}&api_secret=${encodeURIComponent(secret)}`;
      const [bal, nums] = await Promise.all([
        getJson(`https://rest.nexmo.com/account/get-balance?${q}`),
        getJson(`https://rest.nexmo.com/account/numbers?${q}`).catch(() => ({})),
      ]);
      return {
        ...meta, ok: true, live: true,
        balance: bal.value != null ? String(bal.value) : null,
        currency: 'EUR',
        auto_reload: !!bal.autoReload,
        numbers: (nums.numbers || []).slice(0, 20).map((n) => ({ phone: n.msisdn, country: n.country })),
        console_url: 'https://dashboard.nexmo.com/',
      };
    }

    if (kind === 'messagebird') {
      const bal = await getJson('https://rest.messagebird.com/balance', {
        Authorization: `AccessKey ${key}`,
      });
      return {
        ...meta, ok: true, live: true,
        balance: bal.amount != null ? String(bal.amount) : null,
        currency: bal.payment || 'credits',
        type: bal.type || '',
        console_url: 'https://dashboard.messagebird.com/',
      };
    }

    if (kind === 'plivo') {
      const acct = await getJson(`https://api.plivo.com/v1/Account/${encodeURIComponent(key)}/`, {
        Authorization: basic(key, secret),
      });
      return {
        ...meta, ok: true, live: true,
        friendly_name: acct.name || '',
        cash_credits: acct.cash_credits != null ? String(acct.cash_credits) : null,
        auto_recharge: acct.auto_recharge,
        account_type: acct.account_type,
        console_url: 'https://console.plivo.com/',
      };
    }

    if (kind === 'telnyx') {
      const headers = { Authorization: `Bearer ${key}` };
      const [bal, nums] = await Promise.all([
        getJson('https://api.telnyx.com/v2/balance', headers),
        getJson('https://api.telnyx.com/v2/phone_numbers?page[size]=20', headers).catch(() => ({})),
      ]);
      const b = bal.data || bal;
      return {
        ...meta, ok: true, live: true,
        balance: b.balance != null ? String(b.balance) : (b.available_credit != null ? String(b.available_credit) : null),
        currency: b.currency || 'USD',
        credit_limit: b.credit_limit != null ? String(b.credit_limit) : null,
        numbers: (nums.data || []).map((n) => ({ phone: n.phone_number, id: n.id })),
        console_url: 'https://portal.telnyx.com/',
      };
    }

    if (kind === 'clicksend') {
      const acct = await getJson('https://rest.clicksend.com/v3/account', {
        Authorization: basic(key, secret),
      });
      const d = acct.data || acct;
      return {
        ...meta, ok: true, live: true,
        balance: d.balance != null ? String(d.balance) : null,
        currency: d.currency?.currency_name_short || d.currency || '',
        username: d.username || key,
        console_url: 'https://dashboard.clicksend.com/',
      };
    }

    if (kind === 'infobip') {
      const base = (extra.base_url || 'https://api.infobip.com').replace(/\/$/, '');
      const bal = await getJson(`${base}/account/1/balance`, { Authorization: `App ${key}` });
      return {
        ...meta, ok: true, live: true,
        balance: bal.balance != null ? String(bal.balance) : null,
        currency: bal.currency || '',
        console_url: 'https://portal.infobip.com/',
      };
    }

    return {
      ...meta,
      ok: true,
      live: false,
      note: 'This gateway does not expose a balance/quota API we can read. Local send counts are shown instead.',
    };
  } catch (e) {
    return {
      ...meta,
      ok: false,
      live: false,
      error: String(e.message || e).slice(0, 240),
    };
  }
}

function localSmsCounts(userId, providerId) {
  const pid = providerId || null;
  const clause = pid
    ? 'user_id = ? AND channel = \'sms\' AND sms_provider_id = ?'
    : 'user_id = ? AND channel = \'sms\' AND sms_provider_id IS NULL';
  const params = pid ? [userId, pid] : [userId];
  return {
    sent_today: count(
      `SELECT COUNT(*) n FROM messages WHERE ${clause} AND status='sent' AND created_at >= datetime('now','start of day')`,
      ...params
    ),
    sent_month: count(
      `SELECT COUNT(*) n FROM messages WHERE ${clause} AND status='sent' AND created_at >= datetime('now','start of month')`,
      ...params
    ),
    failed_today: count(
      `SELECT COUNT(*) n FROM messages WHERE ${clause} AND status='failed' AND created_at >= datetime('now','start of day')`,
      ...params
    ),
    queued: count(`SELECT COUNT(*) n FROM messages WHERE ${clause} AND status IN ('queued','sending')`, ...params),
  };
}

export async function buildQuotaReport(user) {
  const uid = user.id;
  const usedToday = count(
    `SELECT COUNT(*) n FROM messages WHERE user_id = ? AND created_at >= datetime('now','start of day')
     AND status IN ('queued','sending','sent')`,
    uid
  );
  const dailyQuota = user.daily_quota || 0;
  const account = {
    daily_quota: dailyQuota,
    used_today: usedToday,
    remaining_today: Math.max(0, dailyQuota - usedToday),
    email_today: count(
      `SELECT COUNT(*) n FROM messages WHERE user_id = ? AND channel='email' AND status='sent'
       AND created_at >= datetime('now','start of day')`,
      uid
    ),
    sms_today: count(
      `SELECT COUNT(*) n FROM messages WHERE user_id = ? AND channel='sms' AND status='sent'
       AND created_at >= datetime('now','start of day')`,
      uid
    ),
    email_month: count(
      `SELECT COUNT(*) n FROM messages WHERE user_id = ? AND channel='email' AND status='sent'
       AND created_at >= datetime('now','start of month')`,
      uid
    ),
    sms_month: count(
      `SELECT COUNT(*) n FROM messages WHERE user_id = ? AND channel='sms' AND status='sent'
       AND created_at >= datetime('now','start of month')`,
      uid
    ),
    email_queued: count(`SELECT COUNT(*) n FROM messages WHERE user_id = ? AND channel='email' AND status IN ('queued','sending')`, uid),
    sms_queued: count(`SELECT COUNT(*) n FROM messages WHERE user_id = ? AND channel='sms' AND status IN ('queued','sending')`, uid),
    failed_today: count(
      `SELECT COUNT(*) n FROM messages WHERE user_id = ? AND status='failed' AND created_at >= datetime('now','start of day')`,
      uid
    ),
  };

  const gmailRows = listGmailPool(uid);
  const gmail = {
    ...poolStatus(uid),
    note: 'Gmail does not publish remaining quota through app passwords. These are this app’s per-mailbox caps (default 80/day; Google personal ≈500, Workspace ≈2000).',
    accounts: gmailRows.map((s) => ({
      id: s.id,
      label: s.label,
      email: s.username,
      from_email: s.from_email,
      verified: !!s.verified,
      in_rotation: !!s.in_rotation,
      active: !!s.active,
      daily_limit: s.daily_limit,
      sent_today: s.sent_today || 0,
      remaining_today: Math.max(0, (s.daily_limit || 80) - (s.sent_today || 0)),
      last_used_at: s.last_used_at,
    })),
  };

  const smtp = db.prepare(
    `SELECT id, label, from_email, host, verified, kind, provider, region,
            socks5_host, socks5_port, daily_limit, sent_today, last_used_at
     FROM senders WHERE user_id = ? AND kind != 'gmail' ORDER BY id DESC`
  ).all(uid).map((s) => ({
    ...s,
    sent_today: s.sent_today || 0,
    remaining_today: Math.max(0, (s.daily_limit || 80) - (s.sent_today || 0)),
    socks5: s.socks5_host ? `${s.socks5_host}:${s.socks5_port || 1080}` : '',
  }));

  const apiKeys = db.prepare(
    `SELECT id, name, key_prefix, last_used, revoked, created_at FROM api_keys WHERE user_id = ? ORDER BY id DESC`
  ).all(uid).map((k) => {
    const sends = count(`SELECT COUNT(*) n FROM messages WHERE user_id = ? AND source='api' AND api_key_id = ?`, uid, k.id);
    const email = count(`SELECT COUNT(*) n FROM messages WHERE user_id = ? AND source='api' AND api_key_id = ? AND channel='email'`, uid, k.id);
    const sms = count(`SELECT COUNT(*) n FROM messages WHERE user_id = ? AND source='api' AND api_key_id = ? AND channel='sms'`, uid, k.id);
    const today = count(
      `SELECT COUNT(*) n FROM messages WHERE user_id = ? AND source='api' AND api_key_id = ? AND created_at >= datetime('now','start of day')`,
      uid, k.id
    );
    return { ...k, sends, email, sms, today };
  });
  const apiUnattributed = count(
    `SELECT COUNT(*) n FROM messages WHERE user_id = ? AND source='api' AND api_key_id IS NULL`,
    uid
  );

  const smsRows = db.prepare(
    `SELECT id, provider, label, from_number, extra_json, verified, active, api_key, api_secret
     FROM sms_providers WHERE user_id = ? ORDER BY id DESC`
  ).all(uid);

  const smsLookups = [];
  const sys = systemProvider();
  if (sys) smsLookups.push(sys);
  smsLookups.push(...smsRows);

  const sms_providers = await Promise.all(smsLookups.map(async (p) => {
    const live = await lookupSmsProvider(p);
    return { ...live, local: localSmsCounts(uid, p.id || null) };
  }));

  return {
    fetched_at: new Date().toISOString(),
    account,
    gmail,
    smtp,
    api_keys: { keys: apiKeys, unattributed_sends: apiUnattributed },
    sms_providers,
  };
}
