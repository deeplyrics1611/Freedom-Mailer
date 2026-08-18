import crypto from 'crypto';
import { config } from '../config.js';

// App passwords are long-lived credentials to real mailboxes, so they are
// encrypted at rest with AES-256-GCM rather than stored as plaintext. The key
// comes from CREDENTIAL_KEY (falling back to JWT_SECRET) via scrypt.
const KEY = crypto.scryptSync(config.credentialKey, 'freedom-mailer/credentials', 32);
const PREFIX = 'enc:v1:';

export function encryptSecret(plain) {
  if (plain === undefined || plain === null || plain === '') return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const body = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, body]).toString('base64');
}

export function decryptSecret(stored) {
  if (!stored) return '';
  // Values written before encryption was added are returned as-is.
  if (!String(stored).startsWith(PREFIX)) return String(stored);
  const raw = Buffer.from(String(stored).slice(PREFIX.length), 'base64');
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const body = raw.subarray(28);
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
  } catch {
    // GCM authentication fails when the key has changed. The raw error
    // ("unable to authenticate data") gives no clue what to do about it.
    throw new Error(
      'Could not decrypt the stored app password. This happens when CREDENTIAL_KEY has changed since it was saved — restore the previous value, or re-enter the app password for this mailbox.'
    );
  }
}

// Google shows app passwords as "abcd efgh ijkl mnop"; the spaces are display
// only and must be stripped before use.
export function normalizeAppPassword(pw) {
  return String(pw || '').replace(/\s+/g, '');
}
