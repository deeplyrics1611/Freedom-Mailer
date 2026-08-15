import { customAlphabet } from 'nanoid';
import { db } from './db.js';
import { renderTemplate as mergeFields } from './placeholders.js';
import { linkBaseFor } from './links.js';

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

export function confirmUrl(token, user) {
  return `${linkBaseFor(user)}/c/${token}`;
}
export function unsubscribeUrl(token, user) {
  return `${linkBaseFor(user)}/u/${token}`;
}

// Inject a required unsubscribe footer + List-Unsubscribe header data.
// Every marketing email must carry a working one-click unsubscribe (CAN-SPAM,
// GDPR, RFC 8058). `token` ties the link to a specific subscription.
export function withUnsubscribeFooter({ html, text }, token, user) {
  const link = unsubscribeUrl(token, user);
  const footerHtml = `
    <hr style="border:none;border-top:1px solid #ddd;margin:24px 0" />
    <p style="font-size:12px;color:#888">
      You received this because you confirmed your subscription.
      <a href="${link}">Unsubscribe</a> at any time.
    </p>`;
  const footerText = `\n\n---\nYou received this because you confirmed your subscription.\nUnsubscribe: ${link}`;
  return {
    html: (html || '') + footerHtml,
    text: (text || '') + footerText,
    headers: {
      'List-Unsubscribe': `<${link}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  };
}

export const renderTemplate = mergeFields;
