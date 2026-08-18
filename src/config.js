import 'dotenv/config';

const bool = (v, def = false) => {
  if (v === undefined) return def;
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
};

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  appBaseUrl: (process.env.APP_BASE_URL || 'http://localhost:3000').replace(/\/$/, ''),
  jwtSecret: process.env.JWT_SECRET || 'insecure-dev-secret-change-me',
  bootstrap: {
    email: process.env.BOOTSTRAP_ADMIN_EMAIL || 'admin@example.com',
    password: process.env.BOOTSTRAP_ADMIN_PASSWORD || 'changeme123',
  },
  globalRatePerMinute: parseInt(process.env.GLOBAL_RATE_PER_MINUTE || '60', 10),
  requireDoubleOptIn: bool(process.env.REQUIRE_DOUBLE_OPT_IN, true),
  // Key used to encrypt stored mailbox app passwords. Defaults to JWT_SECRET so
  // existing installs keep working, but should be set independently.
  credentialKey: process.env.CREDENTIAL_KEY || process.env.JWT_SECRET || 'insecure-dev-secret-change-me',
  verification: {
    // HELO name and MAIL FROM used for SMTP recipient probes. Point these at a
    // domain you control with matching forward/reverse DNS, otherwise many
    // mail servers will refuse to answer.
    heloName: process.env.VERIFY_HELO_NAME || 'localhost',
    mailFrom: process.env.VERIFY_MAIL_FROM || '',
    timeoutMs: parseInt(process.env.VERIFY_TIMEOUT_MS || '8000', 10),
    concurrency: parseInt(process.env.VERIFY_CONCURRENCY || '5', 10),
    // Skip the SMTP probe entirely (DNS-level checks only).
    smtpProbe: bool(process.env.VERIFY_SMTP_PROBE, true),
  },
  // Optional Google Safe Browsing key for the link checker.
  safeBrowsingKey: process.env.SAFE_BROWSING_API_KEY || '',
  systemSmtp: {
    host: process.env.SMTP_HOST || '',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: bool(process.env.SMTP_SECURE, false),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    fromName: process.env.SMTP_FROM_NAME || 'Freedom Mailer',
    fromEmail: process.env.SMTP_FROM_EMAIL || '',
  },
  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID || '',
    authToken: process.env.TWILIO_AUTH_TOKEN || '',
    fromNumber: process.env.TWILIO_FROM_NUMBER || '',
  },
};

export const smsEnabled = () =>
  !!(config.twilio.accountSid && config.twilio.authToken && config.twilio.fromNumber);
