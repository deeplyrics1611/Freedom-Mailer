import nodemailer from 'nodemailer';
import { config } from './config.js';
import { decryptSecret } from './lib/secrets.js';

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

// ---------------------------------------------------------------------------
// Pooled mailboxes (app-password accounts)
// ---------------------------------------------------------------------------

// Transports are cached per mailbox and reuse their SMTP connection. Opening a
// fresh TLS session for every message is slow and, at volume, looks like
// abusive behaviour to the provider.
const transports = new Map();

function cacheKey(mailbox) {
  return `${mailbox.id}:${mailbox.host}:${mailbox.port}:${mailbox.email}`;
}

export function transportForMailbox(mailbox) {
  const key = cacheKey(mailbox);
  const cached = transports.get(key);
  if (cached) return cached;

  const transport = nodemailer.createTransport({
    host: mailbox.host,
    port: mailbox.port,
    secure: !!mailbox.secure,
    auth: { user: mailbox.email, pass: decryptSecret(mailbox.app_password) },
    pool: true,
    maxConnections: 1,
    maxMessages: 50,
    // Gmail throttles hard on burst; the pool module paces sends, this is a
    // second safety net at the connection level.
    rateDelta: 1000,
    rateLimit: 1,
    connectionTimeout: 20_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  });

  transports.set(key, transport);
  return transport;
}

export function closeMailboxTransport(mailboxId) {
  for (const [key, transport] of transports) {
    if (key.startsWith(`${mailboxId}:`)) {
      try {
        transport.close();
      } catch {
        /* already closed */
      }
      transports.delete(key);
    }
  }
}

export function mailboxFrom(mailbox) {
  const name = (mailbox.from_name || '').replace(/"/g, '');
  return name ? `"${name}" <${mailbox.email}>` : mailbox.email;
}

export async function verifyMailbox(mailbox) {
  // Verification always uses a fresh, non-pooled connection so a stale cached
  // transport cannot report success for credentials that have since changed.
  const transport = nodemailer.createTransport({
    host: mailbox.host,
    port: mailbox.port,
    secure: !!mailbox.secure,
    auth: { user: mailbox.email, pass: decryptSecret(mailbox.app_password) },
    connectionTimeout: 20_000,
    greetingTimeout: 15_000,
  });
  try {
    await transport.verify();
    return true;
  } finally {
    transport.close();
  }
}

export async function sendViaMailbox(mailbox, message) {
  const transport = transportForMailbox(mailbox);
  const info = await transport.sendMail({
    from: mailboxFrom(mailbox),
    replyTo: message.replyTo || mailbox.reply_to || undefined,
    to: message.to,
    subject: message.subject,
    html: message.html || undefined,
    text: message.text || undefined,
    headers: message.headers || undefined,
  });
  return info.messageId;
}

/**
 * Translate the SMTP errors app-password users actually hit into instructions.
 * Gmail's own wording ("Username and Password not accepted") sends people to
 * reset their account password, which is not the problem.
 */
export function explainSmtpError(error) {
  const message = String(error?.message || error || '');
  if (/application-specific password required/i.test(message)) {
    return 'This account has 2-Step Verification on and needs an app password, not the normal account password. Create one at myaccount.google.com/apppasswords.';
  }
  if (/username and password not accepted|invalid login|535[- ]5\.7\.8/i.test(message)) {
    return 'Google rejected the credentials. Check that 2-Step Verification is enabled on the account, that the 16-character app password was copied without spaces, and that the username is the full address.';
  }
  if (/please log in via your web browser|5\.7\.14/i.test(message)) {
    return 'Google wants an interactive sign-in first. Log into the account in a browser, confirm the security prompt, then retry.';
  }
  if (/daily user sending (quota|limit) exceeded|550[- ]5\.4\.5/i.test(message)) {
    return 'This account hit its daily sending quota. Google resets it about 24 hours after the limit was reached; lower the daily cap for this mailbox.';
  }
  if (/rate|too many|4\.7\.0|try again later/i.test(message)) {
    return 'Google is rate-limiting this account. The mailbox has been cooled down for two hours; increase the gap between sends.';
  }
  if (/ETIMEDOUT|ECONNREFUSED|ENOTFOUND|ECONNRESET/i.test(message)) {
    return `Could not reach the SMTP server (${message}). Check the host and port, and that outbound SMTP is not blocked on this network.`;
  }
  if (/certificate|self.signed|SSL/i.test(message)) {
    return `TLS problem talking to the server: ${message}`;
  }
  return message;
}
