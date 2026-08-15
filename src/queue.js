import { config } from './config.js';
import { db } from './db.js';
import { sendEmail } from './mailer.js';
import { sendSms } from './sms.js';
import { isSuppressed, suppress } from './compliance.js';

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
       ORDER BY created_at ASC
       LIMIT ?`
    )
    .all(MAX_ATTEMPTS, limit);
  return rows;
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

  try {
    if (msg.channel === 'sms') {
      await sendSms({ to: msg.to_address, body: msg.text || msg.subject || '' });
    } else {
      const sender = msg.sender_id
        ? db.prepare('SELECT * FROM senders WHERE id = ?').get(msg.sender_id)
        : null;
      // Rebuild the one-click List-Unsubscribe header for list mail.
      let headers;
      if (msg.unsub_token) {
        const link = `${config.appBaseUrl}/u/${msg.unsub_token}`;
        headers = {
          'List-Unsubscribe': `<${link}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        };
      }
      await sendEmail({
        sender,
        to: msg.to_address,
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
        headers,
      });
    }
    db.prepare("UPDATE messages SET status = 'sent', error = '', sent_at = datetime('now') WHERE id = ?").run(
      msg.id
    );
  } catch (err) {
    const message = String(err.message || err);
    const finalFail = msg.attempts + 1 >= MAX_ATTEMPTS;
    db.prepare(
      `UPDATE messages SET status = ?, error = ? WHERE id = ?`
    ).run(finalFail ? 'failed' : 'queued', message.slice(0, 500), msg.id);

    // Auto-suppress on clear hard-bounce signals.
    if (msg.channel === 'email' && /550|no such user|does not exist|invalid recipient/i.test(message)) {
      suppress(msg.user_id, msg.to_address, 'bounce');
    }
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

export function startWorker() {
  console.log(`[queue] worker started (rate ${config.globalRatePerMinute}/min)`);
  setInterval(tick, TICK_MS);
}
