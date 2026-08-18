import nodemailer from 'nodemailer';
import * as socks from 'socks';
import { config } from './config.js';
import { decryptSecret } from './secrets.js';
import { socks5Url } from './smtpCatalog.js';

function authFor(sender) {
  if (!sender) return null;
  return {
    user: sender.username,
    pass: decryptSecret(sender.password),
  };
}

function proxyFor(sender) {
  if (!sender?.socks5_host) return undefined;
  return socks5Url({
    host: sender.socks5_host,
    port: sender.socks5_port || 1080,
    user: sender.socks5_user || '',
    pass: decryptSecret(sender.socks5_pass || ''),
  });
}

function attachProxy(transport) {
  if (typeof transport.set === 'function') {
    transport.set('proxy_socks_module', socks);
  }
  return transport;
}

// Build a nodemailer transport from a stored sender identity, or fall back to
// the system SMTP credentials in the environment.
export function transportForSender(sender) {
  if (sender) {
    const auth = authFor(sender);
    const proxy = proxyFor(sender);
    const base = {
      auth,
      connectionTimeout: 20000,
      greetingTimeout: 20000,
      ...(proxy ? { proxy } : {}),
    };
    if (sender.kind === 'gmail' || /gmail\.com$/i.test(sender.host || '')) {
      return attachProxy(nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 587,
        secure: false,
        requireTLS: true,
        ...base,
      }));
    }
    return attachProxy(nodemailer.createTransport({
      host: sender.host,
      port: sender.port,
      secure: !!sender.secure,
      requireTLS: !sender.secure,
      ...base,
    }));
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

export function gmailSenderPayload({ label, email, appPassword, fromName, dailyLimit = 80 }) {
  const addr = String(email || '').trim().toLowerCase();
  return {
    label: label || addr,
    host: 'smtp.gmail.com',
    port: 587,
    secure: 0,
    username: addr,
    password: appPassword,
    from_name: fromName || addr.split('@')[0],
    from_email: addr,
    kind: 'gmail',
    daily_limit: dailyLimit,
  };
}
