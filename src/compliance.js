import { customAlphabet } from 'nanoid';
import { config } from './config.js';
import { db } from './db.js';

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
export function withUnsubscribeFooter({ html, text }, token) {
  const link = unsubscribeUrl(token);
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

// Simple {{name}} / {{email}} style merge-field substitution.
export function renderTemplate(str, vars) {
  if (!str) return str;
  return str.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) =>
    vars[k] === undefined || vars[k] === null ? '' : String(vars[k])
  );
}

const escapeHtml = (s) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/**
 * Footer for cold outreach. Recipients here never opted in, so CAN-SPAM's
 * requirements apply in full: say who you are, give a real postal address, and
 * provide a working opt-out. Sending B2B outreach without these is unlawful in
 * the US and, in the EU/UK, needs a legitimate-interest basis plus the same
 * opt-out — so the footer is not optional and cannot be disabled.
 */
export function withOutreachFooter({ html, text }, { token, postalAddress = '', senderName = '' }) {
  const link = unsubscribeUrl(token);
  const who = senderName ? `${senderName} · ` : '';
  const address = postalAddress.trim();

  const footerHtml = `
    <div style="border-top:1px solid #ddd;margin:28px 0 0;padding-top:12px;font-size:12px;color:#777;line-height:1.5">
      <div>${escapeHtml(who)}You received this message because we are contacting businesses about a purchasing enquiry.</div>
      ${address ? `<div style="margin-top:4px">${escapeHtml(address)}</div>` : ''}
      <div style="margin-top:6px"><a href="${link}" style="color:#777">Unsubscribe</a> and we will not contact you again.</div>
    </div>`;

  const footerText = [
    '',
    '--',
    `${who}You received this message because we are contacting businesses about a purchasing enquiry.`,
    address,
    `Unsubscribe: ${link}`,
  ].filter(Boolean).join('\n');

  return {
    html: (html || '') + footerHtml,
    text: (text || '') + `\n${footerText}`,
    headers: {
      'List-Unsubscribe': `<${link}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  };
}
