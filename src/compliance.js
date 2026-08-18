import { customAlphabet } from 'nanoid';
import { config } from './config.js';
import { db } from './db.js';
export { renderTemplate, contactVars, extractPlaceholders } from './placeholders.js';

const genToken = customAlphabet('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789', 32);
export const newToken = () => genToken();

export function isSuppressed(userId, email) {
  const row = db
    .prepare('SELECT 1 FROM suppressions WHERE user_id = ? AND email = ?')
    .get(userId, email.toLowerCase());
  return !!row;
}

export function suppress(userId, email, reason = 'manual') {
  db.prepare(
    `INSERT INTO suppressions (user_id, email, reason) VALUES (?, ?, ?)
     ON CONFLICT(user_id, email) DO UPDATE SET reason = excluded.reason`
  ).run(userId, email.toLowerCase(), reason);
}

export function confirmUrl(token) {
  return `${config.appBaseUrl}/c/${token}`;
}
export function unsubscribeUrl(token) {
  return `${config.appBaseUrl}/u/${token}`;
}

// Inject a required unsubscribe footer + List-Unsubscribe header data.
// Every marketing email must carry a working one-click unsubscribe (CAN-SPAM,
// GDPR, RFC 8058). `token` ties the link to a specific subscription.
export function withUnsubscribeFooter({ html, text }, token, { physicalAddress = '' } = {}) {
  const link = unsubscribeUrl(token);
  const addr = physicalAddress
    ? `<br>${escapeHtml(physicalAddress)}`
    : '';
  const addrText = physicalAddress ? `\n${physicalAddress}` : '';
  const footerHtml = `
    <hr style="border:none;border-top:1px solid #ddd;margin:24px 0" />
    <p style="font-size:12px;color:#888">
      You received this because you were added to an RFQ / mailing list.
      <a href="${link}">Unsubscribe</a> at any time.${addr}
    </p>`;
  const footerText = `\n\n---\nYou received this because you were added to an RFQ / mailing list.\nUnsubscribe: ${link}${addrText}`;
  return {
    html: (html || '') + footerHtml,
    text: (text || '') + footerText,
    headers: {
      'List-Unsubscribe': `<${link}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
