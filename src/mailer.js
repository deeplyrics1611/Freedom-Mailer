import nodemailer from 'nodemailer';
import { config } from './config.js';

// Build a nodemailer transport from a stored sender identity, or fall back to
// the system SMTP credentials in the environment.
export function transportForSender(sender) {
  if (sender) {
    return nodemailer.createTransport({
      host: sender.host,
      port: sender.port,
      secure: !!sender.secure,
      auth: { user: sender.username, pass: sender.password },
    });
  }
  const s = config.systemSmtp;
  if (!s.host || !s.user) {
    throw new Error('No sender identity provided and no system SMTP is configured.');
  }
  return nodemailer.createTransport({
    host: s.host,
    port: s.port,
    secure: s.secure,
    auth: { user: s.user, pass: s.pass },
  });
}

export function fromAddress(sender) {
  if (sender) return `"${sender.from_name}" <${sender.from_email}>`;
  const s = config.systemSmtp;
  return `"${s.fromName}" <${s.fromEmail || s.user}>`;
}

// Verify SMTP credentials without sending mail.
export async function verifyTransport(sender) {
  const transport = transportForSender(sender);
  await transport.verify();
  return true;
}

export async function sendEmail({ sender, to, subject, html, text, headers }) {
  const transport = transportForSender(sender);
  const info = await transport.sendMail({
    from: fromAddress(sender),
    to,
    subject,
    html: html || undefined,
    text: text || undefined,
    headers: headers || undefined,
  });
  return info.messageId;
}
