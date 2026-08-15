import { config, smsEnabled } from './config.js';

// Send an SMS via a Twilio-compatible REST API. Uses fetch directly so we
// don't pull in a heavy SDK. Only enabled when credentials are configured.
export async function sendSms({ to, body }) {
  if (!smsEnabled()) {
    throw new Error('SMS is not configured (set TWILIO_* env vars).');
  }
  const { accountSid, authToken, fromNumber } = config.twilio;
  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
  const params = new URLSearchParams({ To: to, From: fromNumber, Body: body });
  const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.message || `SMS provider error (${res.status})`);
  }
  return data.sid;
}
