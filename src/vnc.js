import net from 'node:net';
import { WebSocketServer } from 'ws';
import jwt from 'jsonwebtoken';
import { config } from './config.js';
import { db } from './db.js';

export const MAX_TARGETS = 20;
export const DEFAULT_PORT = 5900;
export const CONNECT_MS = 8000;
const MAX_OPEN = 3;

const openByUser = new Map();

const HOST_RE = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i;
const IPV4_RE = /^(?:\d{1,3}\.){3}\d{1,3}$/;

export function parseTarget(body = {}) {
  const label = String(body.label || '').trim().slice(0, 80);
  let host = String(body.host || '').trim().toLowerCase();
  host = host.replace(/^vnc:\/\//i, '').replace(/^https?:\/\//i, '');
  if (host.includes('/')) host = host.split('/')[0];
  if (host.includes('@')) {
    return { error: 'Do not put a username in the host. VNC auth is the password field.' };
  }
  let port = body.port;
  if (/^[\w.-]+:\d+$/.test(host) || /^(?:\d{1,3}\.){3}\d{1,3}:\d+$/.test(host)) {
    const idx = host.lastIndexOf(':');
    if (port == null || port === '') port = host.slice(idx + 1);
    host = host.slice(0, idx);
  }
  if (!host) return { error: 'Host is required' };
  if (IPV4_RE.test(host)) {
    const oct = host.split('.').map((n) => parseInt(n, 10));
    if (oct.some((n) => n > 255)) return { error: 'Not a valid IPv4 address' };
  } else if (host !== 'localhost' && !HOST_RE.test(host)) {
    return { error: 'Host must be a hostname or IPv4 address' };
  }
  const p = port == null || port === '' ? DEFAULT_PORT : parseInt(port, 10);
  if (!Number.isInteger(p) || p < 1 || p > 65535) {
    return { error: 'Port must be between 1 and 65535' };
  }
  return {
    label: label || `${host}:${p}`,
    host,
    port: p,
    password: body.password == null ? undefined : String(body.password),
    view_only: body.view_only === true || body.view_only === 1 || body.view_only === '1' || body.view_only === 'on',
  };
}

export function publicTarget(row, { includePassword = false } = {}) {
  if (!row) return null;
  const out = {
    id: row.id,
    label: row.label,
    host: row.host,
    port: row.port,
    view_only: !!row.view_only,
    has_password: Boolean(row.password),
    created_at: row.created_at,
  };
  if (includePassword) out.password = row.password || '';
  return out;
}

export function wsPath(id) {
  return `/api/vnc/ws/${parseInt(id, 10)}`;
}

export function userFromToken(token) {
  if (!token) return null;
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    const user = db.prepare('SELECT * FROM users WHERE id = ? AND active = 1').get(payload.id);
    if (!user) return null;
    if (user.role !== 'admin') return null;
    return user;
  } catch {
    return null;
  }
}

function bumpOpen(userId, delta) {
  const n = (openByUser.get(userId) || 0) + delta;
  if (n <= 0) openByUser.delete(userId);
  else openByUser.set(userId, n);
  return n;
}

export function attachVncProxy(server) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 2 * 1024 * 1024 });

  server.on('upgrade', (req, socket, head) => {
    let url;
    try {
      url = new URL(req.url, 'http://localhost');
    } catch {
      socket.destroy();
      return;
    }
    const m = url.pathname.match(/^\/api\/vnc\/ws\/(\d+)$/);
    if (!m) return;

    const user = userFromToken(url.searchParams.get('token') || '');
    if (!user) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    const target = db
      .prepare('SELECT * FROM vnc_targets WHERE id = ? AND user_id = ?')
      .get(parseInt(m[1], 10), user.id);
    if (!target) {
      socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    if ((openByUser.get(user.id) || 0) >= MAX_OPEN) {
      socket.write('HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      bumpOpen(user.id, 1);
      const tcp = net.connect({ host: target.host, port: target.port, timeout: CONNECT_MS });
      let ready = false;

      const closeBoth = () => {
        try { ws.close(); } catch { /* already */ }
        try { tcp.destroy(); } catch { /* already */ }
      };

      tcp.once('timeout', () => {
        tcp.destroy();
        if (!ready) {
          try { ws.close(4000, 'VNC host did not accept the connection'); } catch { /* */ }
        }
      });
      tcp.on('error', () => closeBoth());
      tcp.on('close', () => {
        bumpOpen(user.id, -1);
        try { ws.close(); } catch { /* */ }
      });
      tcp.on('connect', () => {
        ready = true;
        tcp.setTimeout(0);
      });
      tcp.on('data', (buf) => {
        if (ws.readyState === ws.OPEN) ws.send(buf);
      });

      ws.on('message', (data, isBinary) => {
        if (!tcp.writable) return;
        const buf = isBinary || Buffer.isBuffer(data) ? data : Buffer.from(data);
        tcp.write(buf);
      });
      ws.on('close', () => tcp.destroy());
      ws.on('error', () => closeBoth());
    });
  });
}
