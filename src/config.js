import 'dotenv/config';

const bool = (v, def = false) => {
  if (v === undefined) return def;
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
};

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  host: process.env.HOST || '0.0.0.0',
  appBaseUrl: (process.env.APP_BASE_URL || 'http://localhost:3000').replace(/\/$/, ''),
  jwtSecret: process.env.JWT_SECRET || 'insecure-dev-secret-change-me',
  ownerEmail: String(process.env.OWNER_ADMIN_EMAIL || 'kenneth121d@protonmail.com').toLowerCase(),
  bootstrap: {
    email: String(process.env.BOOTSTRAP_ADMIN_EMAIL || process.env.OWNER_ADMIN_EMAIL || 'kenneth121d@protonmail.com').toLowerCase(),
    password: process.env.BOOTSTRAP_ADMIN_PASSWORD || 'changeme123',
  },
  globalRatePerMinute: parseInt(process.env.GLOBAL_RATE_PER_MINUTE || '60', 10),
  requireDoubleOptIn: bool(process.env.REQUIRE_DOUBLE_OPT_IN, true),
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
  openai: {
    apiKey: process.env.OPENAI_API_KEY || '',
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
  },
};

export const smsEnabled = () =>
  !!(config.twilio.accountSid && config.twilio.authToken && config.twilio.fromNumber);
