import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { customAlphabet } from 'nanoid';
import { config } from './config.js';
import { db } from './db.js';
import { licenseStatus } from './license.js';

const keyAlphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const genKey = customAlphabet(keyAlphabet, 40);

export const hashPassword = (pw) => bcrypt.hashSync(pw, 10);
export const verifyPassword = (pw, hash) => bcrypt.compareSync(pw, hash);

export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

export function signToken(user) {
  return jwt.sign({ id: user.id, email: user.email, role: user.role }, config.jwtSecret, {
    expiresIn: '7d',
  });
}

// Generate a new API key: returns { full, prefix, hash }. Full is shown once.
export function newApiKey() {
  const raw = genKey();
  const full = `fm_${raw}`;
  return { full, prefix: full.slice(0, 10), hash: sha256(full) };
}

// Bearer JWT auth for the panel/UI.
export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing token' });
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    const user = db.prepare('SELECT * FROM users WHERE id = ? AND active = 1').get(payload.id);
    if (!user) return res.status(401).json({ error: 'Invalid session' });
    req.user = user;
    req.license = licenseStatus(user);
    const path = req.originalUrl.split('?')[0];
    const licenseFree =
      (req.method === 'GET' && path === '/api/auth/me') ||
      (req.method === 'POST' && path === '/api/auth/change-password');
    if (!licenseFree && user.role !== 'admin' && !req.license.ok) {
      return res.status(403).json({
        error: 'License expired. Ask the admin to renew your 3-day, monthly, or lifetime access.',
        license: req.license,
      });
    }
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

export function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

// API-key auth for the transactional sending API (X-API-Key header).
export function requireApiKey(req, res, next) {
  const key = req.headers['x-api-key'];
  if (!key) return res.status(401).json({ error: 'Missing X-API-Key header' });
  const row = db
    .prepare('SELECT * FROM api_keys WHERE key_hash = ? AND revoked = 0')
    .get(sha256(key));
  if (!row) return res.status(401).json({ error: 'Invalid API key' });
  const user = db.prepare('SELECT * FROM users WHERE id = ? AND active = 1').get(row.user_id);
  if (!user) return res.status(401).json({ error: 'Account disabled' });
  const lic = licenseStatus(user);
  if (user.role !== 'admin' && !lic.ok) {
    return res.status(403).json({ error: 'License expired', license: lic });
  }
  db.prepare("UPDATE api_keys SET last_used = datetime('now') WHERE id = ?").run(row.id);
  req.user = user;
  req.license = lic;
  req.apiKey = row;
  next();
}
