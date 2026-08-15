import nodemailer from 'nodemailer';
import { config } from './config.js';
import { db } from './db.js';
import { getAppToken, graphFetch, sendViaGraph } from './office365.js';
import {
  usesHttpApi,
  sendViaMailgun,
  verifyMailgun,
  sendViaSendGrid,
  verifySendGrid,
  sendViaSes,
  verifySes,
} from './providers.js';

export function transportForSender(sender) {
  if (sender) {
    const opts = {
      host: sender.host,
      port: sender.port,
      secure: !!sender.secure,
      requireTLS:
        sender.host === 'smtp.office365.com' ||
        sender.host === 'smtp.gmail.com' ||
        sender.host === 'smtp-relay.gmail.com' ||
        (sender.kind === 'aws' && String(sender.host || '').includes('email-smtp.')),
    };
    if (sender.username && sender.password) {
      opts.auth = { user: sender.username, pass: sender.password };
    }
    return nodemailer.createTransport(opts);
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

function officeTenant(sender) {
  if (!sender?.office_tenant_id) return null;
  return db.prepare('SELECT * FROM office_tenants WHERE id = ?').get(sender.office_tenant_id);
}

export async function verifyTransport(sender) {
  if (sender?.kind === 'office365') {
    const tenant = officeTenant(sender);
    const mode = sender.auth_mode || tenant?.send_mode;
    if (mode === 'graph') {
      if (!tenant) throw new Error('Office 365 tenant not found for Graph send');
      const tok = await getAppToken(tenant);
      await graphFetch(
        tok.access_token,
        `users/${encodeURIComponent(sender.from_email)}?$select=id,mail,userPrincipalName`
      );
      return true;
    }
  }
  if (usesHttpApi(sender)) {
    if (sender.kind === 'mailgun') return verifyMailgun(sender);
    if (sender.kind === 'sendgrid') return verifySendGrid(sender);
    if (sender.kind === 'aws') return verifySes(sender);
  }
  const transport = transportForSender(sender);
  await transport.verify();
  return true;
}

export async function sendEmail({ sender, to, subject, html, text, headers }) {
  if (sender?.kind === 'office365') {
    const tenant = officeTenant(sender);
    const mode = sender.auth_mode || tenant?.send_mode;
    if (mode === 'graph' && tenant) {
      return sendViaGraph(tenant, {
        from: sender.from_email,
        to,
        subject,
        html,
        text,
        headers,
      });
    }
  }
  if (usesHttpApi(sender)) {
    const from = fromAddress(sender);
    if (sender.kind === 'mailgun') {
      return sendViaMailgun(sender, { from, to, subject, html, text, headers });
    }
    if (sender.kind === 'sendgrid') {
      return sendViaSendGrid(sender, {
        fromName: sender.from_name,
        fromEmail: sender.from_email,
        to,
        subject,
        html,
        text,
        headers,
      });
    }
    if (sender.kind === 'aws') {
      return sendViaSes(sender, { from, to, subject, html, text, headers });
    }
  }
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
