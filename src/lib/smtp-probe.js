import net from 'net';
import tls from 'tls';
import crypto from 'crypto';

// Minimal SMTP client used to ask a recipient's mail server whether an address
// exists, using the standard EHLO / MAIL FROM / RCPT TO conversation and
// stopping before DATA so no mail is ever delivered. This is the same technique
// commercial validation services use.
//
// Note: many networks (most cloud providers included) block outbound port 25.
// When that happens every probe times out, and results are reported as
// `unknown` rather than being guessed at.

class SmtpClient {
  constructor({ host, port = 25, timeout = 8000 }) {
    this.host = host;
    this.port = port;
    this.timeout = timeout;
    this.socket = null;
    this.buffer = '';
    this.pending = null;
    this.closed = false;
    this.transcript = [];
  }

  _attach(socket) {
    this.socket = socket;
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => {
      this.buffer += chunk;
      this._drain();
    });
    socket.on('error', (err) => this._fail(err));
    socket.on('close', () => {
      this.closed = true;
      this._fail(new Error('Connection closed by server'));
    });
  }

  _fail(err) {
    if (this.pending) {
      const { reject, timer } = this.pending;
      this.pending = null;
      clearTimeout(timer);
      reject(err);
    }
  }

  // An SMTP reply is one or more lines; continuation lines put a '-' after the
  // status code and the final line puts a space there.
  _drain() {
    if (!this.pending) return;
    const lines = this.buffer.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^\d{3} /.test(line)) {
        const consumed = lines.slice(0, i + 1);
        this.buffer = lines.slice(i + 1).join('\r\n');
        const text = consumed.join('\n');
        const code = parseInt(line.slice(0, 3), 10);
        const { resolve, timer } = this.pending;
        this.pending = null;
        clearTimeout(timer);
        this.transcript.push(`S: ${text}`);
        resolve({ code, text });
        return;
      }
    }
  }

  _read() {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending = null;
        reject(new Error(`Timed out waiting for ${this.host}`));
      }, this.timeout);
      this.pending = { resolve, reject, timer };
      this._drain();
    });
  }

  async connect() {
    await new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: this.host, port: this.port });
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error(`Connection to ${this.host}:${this.port} timed out`));
      }, this.timeout);
      socket.once('connect', () => {
        clearTimeout(timer);
        this._attach(socket);
        resolve();
      });
      socket.once('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
    return this._read();
  }

  async cmd(line) {
    if (this.closed) throw new Error('Connection closed');
    this.transcript.push(`C: ${line.replace(/^(AUTH \w+).*/i, '$1 ***')}`);
    this.socket.write(`${line}\r\n`);
    return this._read();
  }

  async startTls(servername) {
    const res = await this.cmd('STARTTLS');
    if (res.code !== 220) return false;
    const plain = this.socket;
    plain.removeAllListeners('data');
    plain.removeAllListeners('error');
    plain.removeAllListeners('close');
    const secure = await new Promise((resolve, reject) => {
      const s = tls.connect(
        { socket: plain, servername, rejectUnauthorized: false },
        () => resolve(s)
      );
      s.once('error', reject);
      setTimeout(() => reject(new Error('TLS handshake timed out')), this.timeout);
    });
    this.buffer = '';
    this._attach(secure);
    return true;
  }

  quit() {
    try {
      if (!this.closed && this.socket?.writable) this.socket.write('QUIT\r\n');
      this.socket?.destroy();
    } catch {
      /* the connection is being torn down anyway */
    }
    this.closed = true;
  }
}

function verdictFor(code, text) {
  if (code >= 200 && code < 300) return 'accepted';
  if (code >= 400 && code < 500) {
    // 4xx is temporary: greylisting, rate limiting, or a policy deferral.
    return /rate|too many|try again|greylist|temporar/i.test(text) ? 'deferred' : 'deferred';
  }
  if (code >= 500) {
    if (/user unknown|no such user|does not exist|unknown user|invalid recipient|mailbox unavailable|recipient rejected|no mailbox|address rejected/i.test(text)) {
      return 'rejected';
    }
    // 5xx can also mean "we refuse to talk to you" rather than "no such user".
    if (/blocked|blacklist|denied|not allowed|policy|spam|reputation|refused|banned/i.test(text)) {
      return 'blocked';
    }
    return 'rejected';
  }
  return 'unknown';
}

export const randomLocalPart = () =>
  `no-such-user-${crypto.randomBytes(6).toString('hex')}`;

/**
 * Open one SMTP session to `mxHost` and test each address in `recipients`.
 * Returns a verdict per address: accepted | rejected | deferred | blocked.
 * `error` is set when the conversation could not be completed at all.
 */
export async function probeRecipients(mxHost, recipients, opts = {}) {
  const { heloName = 'localhost', mailFrom = '', timeout = 8000, port = 25 } = opts;
  const client = new SmtpClient({ host: mxHost, port, timeout });
  const results = {};
  const envelopeFrom = mailFrom || `probe@${heloName}`;

  try {
    const greeting = await client.connect();
    if (greeting.code !== 220) {
      throw new Error(`Server refused the connection: ${greeting.text.split('\n')[0]}`);
    }

    let ehlo = await client.cmd(`EHLO ${heloName}`);
    if (ehlo.code !== 250) {
      const helo = await client.cmd(`HELO ${heloName}`);
      if (helo.code !== 250) throw new Error(`EHLO/HELO rejected: ${helo.text.split('\n')[0]}`);
      ehlo = helo;
    }

    if (/STARTTLS/i.test(ehlo.text)) {
      try {
        if (await client.startTls(mxHost)) {
          ehlo = await client.cmd(`EHLO ${heloName}`);
        }
      } catch {
        // Continue unencrypted; some hosts advertise STARTTLS but fail on it.
      }
    }

    const from = await client.cmd(`MAIL FROM:<${envelopeFrom}>`);
    if (from.code >= 400) {
      throw new Error(`Sender rejected: ${from.text.split('\n')[0]}`);
    }

    for (const address of recipients) {
      try {
        const rcpt = await client.cmd(`RCPT TO:<${address}>`);
        const firstLine = rcpt.text.split('\n').pop() || rcpt.text;
        results[address] = {
          code: rcpt.code,
          message: firstLine.slice(0, 300),
          verdict: verdictFor(rcpt.code, rcpt.text),
        };
        // Some servers drop the session after a rejection; reset to be safe.
        if (rcpt.code >= 500) await client.cmd('RSET').catch(() => {});
      } catch (err) {
        results[address] = { code: 0, message: String(err.message || err), verdict: 'unknown' };
        break;
      }
    }

    client.quit();
    return { ok: true, results, transcript: client.transcript };
  } catch (err) {
    client.quit();
    const message = String(err.message || err);
    for (const address of recipients) {
      if (!results[address]) results[address] = { code: 0, message, verdict: 'unknown' };
    }
    return {
      ok: false,
      error: message,
      // Port 25 being unreachable is by far the most common cause and needs a
      // clearer explanation than a bare timeout.
      portBlocked: /timed out|ECONNREFUSED|EHOSTUNREACH|ENETUNREACH/i.test(message),
      results,
      transcript: client.transcript,
    };
  }
}
