import crypto from 'crypto';
import { config } from './config.js';

function key() {
  return crypto.createHash('sha256').update(String(config.jwtSecret)).digest();
}

/** Encrypt a secret (Gmail app password) at rest. */
export function encryptSecret(plain) {
  if (plain == null || plain === '') return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
}

/** Decrypt a stored secret. Plaintext (legacy) values pass through. */
export function decryptSecret(stored) {
  if (stored == null || stored === '') return '';
  const s = String(stored);
  if (!s.startsWith('enc:')) return s;
  const parts = s.split(':');
  if (parts.length !== 4) throw new Error('Corrupt encrypted secret');
  const [, ivH, tagH, dataH] = parts;
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(ivH, 'hex'));
  decipher.setAuthTag(Buffer.from(tagH, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(dataH, 'hex')), decipher.final()]).toString('utf8');
}

/** Gmail app passwords are 16 chars; Google often displays them with spaces. */
export function normalizeAppPassword(pw) {
  return String(pw || '').replace(/\s+/g, '');
}

export function looksLikeGmailAppPassword(pw) {
  const n = normalizeAppPassword(pw);
  return /^[a-zA-Z0-9]{16}$/.test(n);
}
