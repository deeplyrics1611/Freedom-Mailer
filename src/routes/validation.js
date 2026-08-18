import net from 'net';
import { Router } from 'express';
import { db } from '../db.js';
import { config } from '../config.js';
import { requireAuth } from '../auth.js';
import { verifyEmail } from '../lib/verify-email.js';
import { parseCsv, toCsv, findEmailColumn } from '../lib/csv.js';

const router = Router();
router.use(requireAuth);

const int = (v, fallback = 0) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
};

/**
 * Whether this host can actually run SMTP mailbox probes. Most cloud providers
 * block outbound port 25, and without it validation is limited to DNS-level
 * checks — so it is better to say so up front than to return a wall of
 * "unknown" results with no explanation.
 */
let capabilityCache = null;
async function probeCapability() {
  if (capabilityCache && Date.now() - capabilityCache.at < 10 * 60_000) return capabilityCache.value;

  const reachable = await new Promise((resolve) => {
    const socket = net.createConnection({ host: 'gmail-smtp-in.l.google.com', port: 25 });
    const finish = (result) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(6000);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });

  const value = {
    smtp_probe_enabled: config.verification.smtpProbe,
    port_25_reachable: reachable,
    helo_name: config.verification.heloName,
    mail_from: config.verification.mailFrom || `probe@${config.verification.heloName}`,
    note: !config.verification.smtpProbe
      ? 'SMTP probing is switched off (VERIFY_SMTP_PROBE=false). Only DNS-level checks will run.'
      : reachable
        ? 'Outbound port 25 is open, so mailbox-level checks can run.'
        : 'Outbound port 25 is blocked on this host, so mailbox existence cannot be tested. Syntax, domain, MX, disposable and role checks still work; results that need SMTP are reported as "unknown" rather than guessed.',
    accuracy_note:
      'Confidence is highest for domains that answer honestly at SMTP. Google, Microsoft, Yahoo and most enterprise filters accept every recipient during the SMTP conversation, so addresses there are reported as "unknown" or "catch-all" instead of being asserted as valid. Treat any tool that claims a fixed accuracy figure on those domains with suspicion.',
  };
  capabilityCache = { at: Date.now(), value };
  return value;
}

router.get('/capabilities', async (req, res) => res.json(await probeCapability()));

// ---- Single address ---------------------------------------------------------

router.post('/single', async (req, res) => {
  const email = String(req.body?.email || '').trim();
  if (!email) return res.status(400).json({ error: 'An email address is required' });
  try {
    const result = await verifyEmail(email, { deep: req.body?.deep !== false });
    db.prepare('INSERT INTO checks (user_id, kind, target, score, verdict, report) VALUES (?, ?, ?, ?, ?, ?)')
      .run(req.user.id, 'validation', email, result.score, result.status, JSON.stringify(result));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

// ---- Bulk jobs --------------------------------------------------------------

function createJob(userId, { name, emails, leadListId = null, deep = true }) {
  const unique = [...new Set(emails.map((e) => String(e).trim().toLowerCase()).filter(Boolean))];
  const job = db
    .prepare(
      `INSERT INTO verification_jobs (user_id, name, lead_list_id, total, deep) VALUES (?, ?, ?, ?, ?)`
    )
    .run(userId, name || `Batch of ${unique.length}`, leadListId, unique.length, deep ? 1 : 0);

  const jobId = job.lastInsertRowid;
  const insert = db.prepare('INSERT INTO verification_queue (job_id, email, lead_id) VALUES (?, ?, ?)');
  const leadIds = new Map();
  if (leadListId) {
    for (const row of db.prepare('SELECT id, email FROM leads WHERE lead_list_id = ?').all(leadListId)) {
      leadIds.set(row.email.toLowerCase(), row.id);
    }
  }
  db.transaction(() => {
    for (const email of unique) insert.run(jobId, email, leadIds.get(email) ?? null);
  })();

  return { id: jobId, total: unique.length };
}

router.post('/bulk', (req, res) => {
  const deep = req.body?.deep !== false;
  let emails = [];

  if (Array.isArray(req.body?.emails)) {
    emails = req.body.emails;
  } else if (req.body?.csv) {
    const csv = String(req.body.csv);
    // Accept either a real CSV or a plain newline/comma separated list.
    if (/[,;\t]/.test(csv.split('\n')[0] || '') && csv.includes('\n')) {
      const { headers, rows } = parseCsv(csv);
      const column = findEmailColumn(headers, rows);
      emails = column ? rows.map((r) => r[column]) : [];
    }
    if (!emails.length) {
      emails = csv.split(/[\s,;]+/).filter((v) => v.includes('@'));
    }
  }

  emails = emails.filter((e) => String(e || '').includes('@'));
  if (!emails.length) return res.status(400).json({ error: 'No email addresses found in the input' });
  if (emails.length > 50_000) return res.status(400).json({ error: 'Batches are limited to 50,000 addresses' });

  const job = createJob(req.user.id, { name: req.body?.name, emails, deep });
  res.status(201).json(job);
});

// Validate an existing lead list in place; results are written back onto the
// leads so campaigns can filter on them.
router.post('/lead-list/:id', (req, res) => {
  const list = db
    .prepare('SELECT * FROM lead_lists WHERE id = ? AND user_id = ?')
    .get(int(req.params.id), req.user.id);
  if (!list) return res.status(404).json({ error: 'Not found' });

  const onlyUnchecked = req.body?.only_unchecked !== false;
  const rows = onlyUnchecked
    ? db.prepare("SELECT email FROM leads WHERE lead_list_id = ? AND status = 'unchecked'").all(list.id)
    : db.prepare('SELECT email FROM leads WHERE lead_list_id = ?').all(list.id);

  if (!rows.length) {
    return res.status(400).json({ error: onlyUnchecked ? 'Every lead in this list has already been checked' : 'This list is empty' });
  }

  const job = createJob(req.user.id, {
    name: `${list.name} (${rows.length} leads)`,
    emails: rows.map((r) => r.email),
    leadListId: list.id,
    deep: req.body?.deep !== false,
  });
  res.status(201).json(job);
});

const jobSummary = (jobId) =>
  Object.fromEntries(
    db.prepare('SELECT status, COUNT(*) n FROM verification_results WHERE job_id = ? GROUP BY status')
      .all(jobId)
      .map((r) => [r.status, r.n])
  );

router.get('/jobs', (req, res) => {
  const jobs = db
    .prepare('SELECT * FROM verification_jobs WHERE user_id = ? ORDER BY id DESC LIMIT 50')
    .all(req.user.id);
  res.json(jobs.map((j) => ({ ...j, summary: jobSummary(j.id) })));
});

router.get('/jobs/:id', (req, res) => {
  const job = db
    .prepare('SELECT * FROM verification_jobs WHERE id = ? AND user_id = ?')
    .get(int(req.params.id), req.user.id);
  if (!job) return res.status(404).json({ error: 'Not found' });
  res.json({ ...job, summary: jobSummary(job.id), remaining: db.prepare('SELECT COUNT(*) n FROM verification_queue WHERE job_id = ?').get(job.id).n });
});

router.get('/jobs/:id/results', (req, res) => {
  const job = db
    .prepare('SELECT * FROM verification_jobs WHERE id = ? AND user_id = ?')
    .get(int(req.params.id), req.user.id);
  if (!job) return res.status(404).json({ error: 'Not found' });

  const status = String(req.query.status || 'all');
  const limit = Math.min(1000, Math.max(1, int(req.query.limit, 200)));
  const offset = Math.max(0, int(req.query.offset, 0));

  const rows =
    status === 'all'
      ? db.prepare('SELECT * FROM verification_results WHERE job_id = ? ORDER BY id LIMIT ? OFFSET ?').all(job.id, limit, offset)
      : db.prepare('SELECT * FROM verification_results WHERE job_id = ? AND status = ? ORDER BY id LIMIT ? OFFSET ?').all(job.id, status, limit, offset);

  res.json({
    total: job.processed,
    results: rows.map((r) => ({ ...r, detail: JSON.parse(r.detail || '{}') })),
  });
});

router.get('/jobs/:id/export', (req, res) => {
  const job = db
    .prepare('SELECT * FROM verification_jobs WHERE id = ? AND user_id = ?')
    .get(int(req.params.id), req.user.id);
  if (!job) return res.status(404).json({ error: 'Not found' });

  const status = String(req.query.status || 'all');
  const rows =
    status === 'all'
      ? db.prepare('SELECT * FROM verification_results WHERE job_id = ? ORDER BY id').all(job.id)
      : db.prepare('SELECT * FROM verification_results WHERE job_id = ? AND status = ? ORDER BY id').all(job.id, status);

  const flat = rows.map((r) => {
    const detail = JSON.parse(r.detail || '{}');
    const checks = detail.checks || {};
    return {
      email: r.email,
      status: r.status,
      score: r.score,
      reason: r.reason,
      mx: (checks.mx || []).map((m) => m.host).join(' '),
      disposable: checks.disposable ? 'yes' : 'no',
      free_provider: checks.free ? 'yes' : 'no',
      role_account: checks.role ? 'yes' : 'no',
      catch_all: checks.catch_all === null || checks.catch_all === undefined ? 'unknown' : checks.catch_all ? 'yes' : 'no',
      suggestion: checks.suggestion || '',
      notes: (detail.notes || []).join(' | '),
    };
  });

  res.setHeader('content-type', 'text/csv; charset=utf-8');
  res.setHeader('content-disposition', `attachment; filename="validation-${job.id}-${status}.csv"`);
  res.send(toCsv(flat));
});

router.post('/jobs/:id/cancel', (req, res) => {
  const id = int(req.params.id);
  const job = db.prepare('SELECT * FROM verification_jobs WHERE id = ? AND user_id = ?').get(id, req.user.id);
  if (!job) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM verification_queue WHERE job_id = ?').run(id);
  db.prepare("UPDATE verification_jobs SET status = 'cancelled', finished_at = datetime('now') WHERE id = ?").run(id);
  res.json({ ok: true });
});

router.delete('/jobs/:id', (req, res) => {
  db.prepare('DELETE FROM verification_jobs WHERE id = ? AND user_id = ?').run(int(req.params.id), req.user.id);
  res.json({ ok: true });
});

export default router;
