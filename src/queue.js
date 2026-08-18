import { config } from './config.js';
import { db } from './db.js';
import { sendEmail, sendViaMailbox, explainSmtpError } from './mailer.js';
import { sendSms } from './sms.js';
import { isSuppressed, suppress } from './compliance.js';
import { pickMailbox, poolStatus, recordSend, handleSendFailure } from './pool.js';
import { verifyEmail, mapLimit } from './lib/verify-email.js';

const MAX_ATTEMPTS = 3;

// How many messages we may process per tick to honor GLOBAL_RATE_PER_MINUTE.
// Worker runs every 5s, so per-tick budget = rate/12.
const TICK_MS = 5000;
const perTickBudget = () => Math.max(1, Math.ceil(config.globalRatePerMinute / 12));

function claimBatch(limit) {
  const rows = db
    .prepare(
      `SELECT * FROM messages
       WHERE status = 'queued'
         AND (attempts < ?)
         AND (not_before IS NULL OR not_before <= datetime('now'))
       ORDER BY COALESCE(not_before, created_at) ASC, id ASC
       LIMIT ?`
    )
    .all(MAX_ATTEMPTS, limit);
  return rows;
}

// Put a message back without spending an attempt. Used when the send never
// happened — no mailbox was free, or the campaign hit its own daily cap.
function defer(msgId, seconds, reason) {
  db.prepare(
    `UPDATE messages
     SET status = 'queued', attempts = MAX(0, attempts - 1), error = ?,
         not_before = datetime('now', ?)
     WHERE id = ?`
  ).run(reason, `+${seconds} seconds`, msgId);
}

function campaignSentToday(campaignId) {
  return db.prepare(
    `SELECT COUNT(*) n FROM messages
     WHERE campaign_id = ? AND status = 'sent' AND date(sent_at) = date('now')`
  ).get(campaignId).n;
}

async function processMessage(msg) {
  db.prepare("UPDATE messages SET status = 'sending', attempts = attempts + 1 WHERE id = ?").run(
    msg.id
  );

  // Enforce suppression at send time (last line of defense).
  if (msg.channel === 'email' && isSuppressed(msg.user_id, msg.to_address)) {
    db.prepare(
      "UPDATE messages SET status = 'skipped', error = 'recipient suppressed' WHERE id = ?"
    ).run(msg.id);
    return;
  }

  if (msg.channel === 'sms') {
    try {
      await sendSms({ to: msg.to_address, body: msg.text || msg.subject || '' });
      markSent(msg.id);
    } catch (err) {
      markFailed(msg, String(err.message || err));
    }
    return;
  }

  // A campaign may cap its own daily volume independently of mailbox limits.
  if (msg.campaign_id) {
    const campaign = db.prepare('SELECT daily_cap FROM campaigns WHERE id = ?').get(msg.campaign_id);
    if (campaign?.daily_cap > 0 && campaignSentToday(msg.campaign_id) >= campaign.daily_cap) {
      defer(msg.id, 1800, `campaign daily cap of ${campaign.daily_cap} reached`);
      return;
    }
  }

  // Rebuild the one-click List-Unsubscribe header for list and outreach mail.
  let headers;
  if (msg.unsub_token) {
    const link = `${config.appBaseUrl}/u/${msg.unsub_token}`;
    headers = {
      'List-Unsubscribe': `<${link}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    };
  }

  // ---- Pooled app-password mailboxes --------------------------------------
  if (msg.use_pool || msg.mailbox_id) {
    const mailbox = msg.mailbox_id
      ? db.prepare('SELECT * FROM mailboxes WHERE id = ? AND user_id = ?').get(msg.mailbox_id, msg.user_id)
      : pickMailbox(msg.user_id);

    if (!mailbox) {
      // Every mailbox is at its cap, cooling down, or unverified. Wait rather
      // than burning an attempt — capacity comes back on the hour or the day.
      defer(msg.id, 300, 'no mailbox in the pool is available right now');
      return;
    }
    // A pinned mailbox that is currently unavailable also just waits.
    if (msg.mailbox_id) {
      const state = poolStatus(msg.user_id).find((m) => m.id === mailbox.id);
      if (state && !state.available) {
        defer(msg.id, 300, `mailbox ${mailbox.email} unavailable: ${state.blockers.join(', ')}`);
        return;
      }
    }

    try {
      await sendViaMailbox(mailbox, {
        to: msg.to_address,
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
        replyTo: msg.reply_to || undefined,
        headers,
      });
      recordSend(mailbox.id);
      db.prepare('UPDATE messages SET mailbox_id = ? WHERE id = ?').run(mailbox.id, msg.id);
      markSent(msg.id);
      if (msg.seed_result_id) {
        db.prepare("UPDATE seed_results SET send_status = 'sent' WHERE id = ?").run(msg.seed_result_id);
      }
    } catch (err) {
      const explained = explainSmtpError(err);
      const outcome = handleSendFailure(mailbox.id, explained);
      if (outcome.paused && !msg.mailbox_id) {
        // The mailbox is the problem, not the message: let another one take it.
        defer(msg.id, 60, `mailbox ${mailbox.email} unavailable (${outcome.reason}): ${explained}`);
        return;
      }
      markFailed(msg, explained);
      if (msg.seed_result_id) {
        db.prepare("UPDATE seed_results SET send_status = 'failed', send_error = ? WHERE id = ?")
          .run(explained.slice(0, 300), msg.seed_result_id);
      }
    }
    return;
  }

  // ---- Legacy sender identity / system SMTP -------------------------------
  try {
    const sender = msg.sender_id
      ? db.prepare('SELECT * FROM senders WHERE id = ?').get(msg.sender_id)
      : null;
    await sendEmail({
      sender,
      to: msg.to_address,
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
      headers,
    });
    markSent(msg.id);
  } catch (err) {
    markFailed(msg, String(err.message || err));
  }
}

function markSent(id) {
  db.prepare("UPDATE messages SET status = 'sent', error = '', sent_at = datetime('now') WHERE id = ?").run(id);
}

function markFailed(msg, message) {
  const finalFail = msg.attempts + 1 >= MAX_ATTEMPTS;
  db.prepare('UPDATE messages SET status = ?, error = ? WHERE id = ?').run(
    finalFail ? 'failed' : 'queued',
    message.slice(0, 500),
    msg.id
  );

  // Auto-suppress on clear hard-bounce signals.
  if (msg.channel === 'email' && /550|no such user|does not exist|invalid recipient|user unknown|mailbox unavailable/i.test(message)) {
    suppress(msg.user_id, msg.to_address, 'bounce');
  }
}

let running = false;
async function tick() {
  if (running) return;
  running = true;
  try {
    const batch = claimBatch(perTickBudget());
    for (const msg of batch) {
      await processMessage(msg);
    }
    // Mark campaigns done when they have no more queued/sending messages.
    db.exec(`
      UPDATE campaigns SET status = 'sent'
      WHERE status = 'sending'
        AND NOT EXISTS (
          SELECT 1 FROM messages
          WHERE messages.campaign_id = campaigns.id
            AND messages.status IN ('queued','sending')
        );
    `);
  } catch (err) {
    console.error('[queue] tick error:', err.message);
  } finally {
    running = false;
  }
}

// ---------------------------------------------------------------------------
// Bulk address-validation worker
// ---------------------------------------------------------------------------

const VERIFY_TICK_MS = 2000;
let verifying = false;

async function verifyTick() {
  if (verifying) return;
  verifying = true;
  try {
    const job = db
      .prepare("SELECT * FROM verification_jobs WHERE status IN ('queued','running') ORDER BY id ASC LIMIT 1")
      .get();
    if (!job) return;

    if (job.status === 'queued') {
      db.prepare("UPDATE verification_jobs SET status = 'running' WHERE id = ?").run(job.id);
    }

    const batchSize = Math.max(1, config.verification.concurrency);
    const batch = db
      .prepare('SELECT * FROM verification_queue WHERE job_id = ? ORDER BY id ASC LIMIT ?')
      .all(job.id, batchSize);

    if (!batch.length) {
      db.prepare("UPDATE verification_jobs SET status = 'done', finished_at = datetime('now') WHERE id = ?")
        .run(job.id);
      return;
    }

    const results = await mapLimit(batch, batchSize, async (row) => ({
      row,
      result: await verifyEmail(row.email, { deep: !!job.deep }),
    }));

    const persist = db.transaction((items) => {
      const insertResult = db.prepare(
        `INSERT INTO verification_results (job_id, email, status, score, reason, detail)
         VALUES (?, ?, ?, ?, ?, ?)`
      );
      const updateLead = db.prepare(
        `UPDATE leads SET status = ?, score = ?, reason = ?, detail = ?, checked_at = datetime('now')
         WHERE id = ?`
      );
      const removeFromQueue = db.prepare('DELETE FROM verification_queue WHERE id = ?');

      for (const { row, result } of items) {
        const r = result?.status
          ? result
          : { status: 'unknown', score: 0, reason: 'error', notes: [String(result?.error || 'failed')], checks: {} };
        const detail = JSON.stringify({ notes: r.notes || [], checks: r.checks || {} });
        insertResult.run(job.id, row.email, r.status, r.score, r.reason, detail);
        if (row.lead_id) updateLead.run(r.status, r.score, r.reason, detail, row.lead_id);
        removeFromQueue.run(row.id);
      }
      db.prepare('UPDATE verification_jobs SET processed = processed + ? WHERE id = ?').run(items.length, job.id);
    });
    persist(results);
  } catch (err) {
    console.error('[verify] tick error:', err.message);
  } finally {
    verifying = false;
  }
}

// A message is flipped to 'sending' before the SMTP handshake, so a crash or
// restart mid-send would strand it there forever. Anything left in that state
// at startup is put back in the queue; the attempt has already been counted, so
// a message that reliably kills the process still gives up after MAX_ATTEMPTS.
function recoverInterrupted() {
  const info = db
    .prepare("UPDATE messages SET status = 'queued', error = 'interrupted by a restart' WHERE status = 'sending'")
    .run();
  if (info.changes) console.log(`[queue] requeued ${info.changes} message(s) interrupted by a restart`);

  // Bulk validation jobs are safe to resume: processed rows are removed from
  // the queue table as they complete.
  const jobs = db.prepare("UPDATE verification_jobs SET status = 'queued' WHERE status = 'running'").run();
  if (jobs.changes) console.log(`[verify] resumed ${jobs.changes} interrupted job(s)`);
}

export function startWorker() {
  recoverInterrupted();
  console.log(`[queue] worker started (rate ${config.globalRatePerMinute}/min)`);
  setInterval(tick, TICK_MS);
  setInterval(verifyTick, VERIFY_TICK_MS);
}
