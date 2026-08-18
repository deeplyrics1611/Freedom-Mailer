import { Router } from 'express';
import { config } from '../config.js';
import { db } from '../db.js';
import { requireAuth } from '../auth.js';
import { isSuppressed, withUnsubscribeFooter, withOutreachFooter, renderTemplate } from '../compliance.js';
import { render, auditPlaceholders, leadVars } from '../lib/personalize.js';
import { analyzeContent, htmlToText } from '../lib/spamcheck.js';
import { poolCapacity, poolStatus } from '../pool.js';

const router = Router();
router.use(requireAuth);

const int = (v, fallback = 0) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
};

// Statuses that are never worth sending to once a list has been validated.
const UNSENDABLE = ['invalid', 'unchecked'];

router.get('/', (req, res) => {
  const rows = db
    .prepare(
      `SELECT c.*, l.name AS list_name, ll.name AS lead_list_name, s.label AS sender_label,
        (SELECT COUNT(*) FROM messages m WHERE m.campaign_id = c.id) AS total,
        (SELECT COUNT(*) FROM messages m WHERE m.campaign_id = c.id AND m.status = 'sent') AS sent,
        (SELECT COUNT(*) FROM messages m WHERE m.campaign_id = c.id AND m.status = 'queued') AS queued,
        (SELECT COUNT(*) FROM messages m WHERE m.campaign_id = c.id AND m.status = 'failed') AS failed,
        (SELECT COUNT(*) FROM messages m WHERE m.campaign_id = c.id AND m.status = 'skipped') AS skipped
       FROM campaigns c
       LEFT JOIN lists l ON l.id = c.list_id
       LEFT JOIN lead_lists ll ON ll.id = c.lead_list_id
       LEFT JOIN senders s ON s.id = c.sender_id
       WHERE c.user_id = ? ORDER BY c.id DESC`
    )
    .all(req.user.id);
  res.json(rows);
});

router.get('/:id', (req, res) => {
  const campaign = db
    .prepare('SELECT * FROM campaigns WHERE id = ? AND user_id = ?')
    .get(int(req.params.id), req.user.id);
  if (!campaign) return res.status(404).json({ error: 'Not found' });
  res.json(campaign);
});

function campaignFields(body, existing = {}) {
  const b = body || {};
  const mode = b.mode === 'outreach' ? 'outreach' : b.mode === 'optin' ? 'optin' : existing.mode || 'optin';
  return {
    name: b.name ?? existing.name,
    mode,
    sender_id: b.sender_id === undefined ? existing.sender_id ?? null : b.sender_id || null,
    list_id: b.list_id === undefined ? existing.list_id ?? null : b.list_id || null,
    lead_list_id: b.lead_list_id === undefined ? existing.lead_list_id ?? null : b.lead_list_id || null,
    use_pool: b.use_pool === undefined ? existing.use_pool ?? (mode === 'outreach' ? 1 : 0) : (b.use_pool ? 1 : 0),
    subject: b.subject ?? existing.subject ?? '',
    html: b.html ?? existing.html ?? '',
    text: b.text ?? existing.text ?? '',
    postal_address: b.postal_address ?? existing.postal_address ?? '',
    reply_to: b.reply_to ?? existing.reply_to ?? '',
    min_delay_sec: Math.max(0, int(b.min_delay_sec, existing.min_delay_sec ?? 45)),
    max_delay_sec: Math.max(0, int(b.max_delay_sec, existing.max_delay_sec ?? 120)),
    daily_cap: Math.max(0, int(b.daily_cap, existing.daily_cap ?? 0)),
    only_valid: b.only_valid === undefined ? existing.only_valid ?? 1 : (b.only_valid ? 1 : 0),
  };
}

router.post('/', (req, res) => {
  const f = campaignFields(req.body);
  if (!f.name) return res.status(400).json({ error: 'Name required' });

  const info = db
    .prepare(
      `INSERT INTO campaigns
        (user_id, name, mode, sender_id, list_id, lead_list_id, use_pool, subject, html, text,
         postal_address, reply_to, min_delay_sec, max_delay_sec, daily_cap, only_valid)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      req.user.id, f.name, f.mode, f.sender_id, f.list_id, f.lead_list_id, f.use_pool,
      f.subject, f.html, f.text, f.postal_address, f.reply_to,
      f.min_delay_sec, f.max_delay_sec, f.daily_cap, f.only_valid
    );
  res.status(201).json({ id: info.lastInsertRowid });
});

router.put('/:id', (req, res) => {
  const id = int(req.params.id);
  const existing = db.prepare('SELECT * FROM campaigns WHERE id = ? AND user_id = ?').get(id, req.user.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  if (existing.status !== 'draft') return res.status(400).json({ error: 'Only draft campaigns can be edited' });

  const f = campaignFields(req.body, existing);
  db.prepare(
    `UPDATE campaigns SET name=?, mode=?, sender_id=?, list_id=?, lead_list_id=?, use_pool=?, subject=?,
      html=?, text=?, postal_address=?, reply_to=?, min_delay_sec=?, max_delay_sec=?, daily_cap=?, only_valid=?
     WHERE id=?`
  ).run(
    f.name, f.mode, f.sender_id, f.list_id, f.lead_list_id, f.use_pool, f.subject, f.html, f.text,
    f.postal_address, f.reply_to, f.min_delay_sec, f.max_delay_sec, f.daily_cap, f.only_valid, id
  );
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM campaigns WHERE id = ? AND user_id = ?').run(int(req.params.id), req.user.id);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Recipient selection
// ---------------------------------------------------------------------------

function outreachRecipients(campaign) {
  const rows = db
    .prepare('SELECT * FROM leads WHERE lead_list_id = ? ORDER BY id').all(campaign.lead_list_id);

  const eligible = [];
  const excluded = { opted_out: 0, suppressed: 0, invalid: 0, unchecked: 0 };

  for (const lead of rows) {
    if (lead.opted_out) {
      excluded.opted_out++;
      continue;
    }
    if (isSuppressed(campaign.user_id, lead.email)) {
      excluded.suppressed++;
      continue;
    }
    if (campaign.only_valid && UNSENDABLE.includes(lead.status)) {
      excluded[lead.status === 'invalid' ? 'invalid' : 'unchecked']++;
      continue;
    }
    eligible.push(lead);
  }

  return { eligible, excluded, total: rows.length };
}

// ---------------------------------------------------------------------------
// Preview and pre-send checks
// ---------------------------------------------------------------------------

/**
 * Render the campaign exactly as the first few recipients will see it, and
 * report any merge field that would come out blank. An unresolved placeholder
 * is the most common and most visible mistake in personalised outreach.
 */
router.post('/:id/preview', (req, res) => {
  const campaign = db
    .prepare('SELECT * FROM campaigns WHERE id = ? AND user_id = ?')
    .get(int(req.params.id), req.user.id);
  if (!campaign) return res.status(404).json({ error: 'Not found' });

  const count = Math.min(10, Math.max(1, int(req.body?.count, 3)));

  if (campaign.mode !== 'outreach') {
    const contacts = campaign.list_id
      ? db.prepare(
          `SELECT c.email, c.name FROM subscriptions s JOIN contacts c ON c.id = s.contact_id
           WHERE s.list_id = ? AND s.status = 'confirmed' LIMIT ?`
        ).all(campaign.list_id, count)
      : [];
    return res.json({
      mode: 'optin',
      previews: contacts.map((c) => ({
        to: c.email,
        subject: renderTemplate(campaign.subject, { name: c.name || '', email: c.email }),
        html: renderTemplate(campaign.html, { name: c.name || '', email: c.email }),
        text: renderTemplate(campaign.text, { name: c.name || '', email: c.email }),
      })),
    });
  }

  if (!campaign.lead_list_id) return res.status(400).json({ error: 'This campaign has no lead list' });

  const { eligible, excluded, total } = outreachRecipients(campaign);
  const sample = eligible.slice(0, count);
  const allLeadVars = eligible.map(leadVars);
  const audit = auditPlaceholders([campaign.subject, campaign.html, campaign.text], allLeadVars);

  const previews = sample.map((lead) => {
    const vars = leadVars(lead);
    const subject = render(campaign.subject, vars);
    const html = render(campaign.html, vars);
    const text = render(campaign.text, vars) || htmlToText(html);
    const withFooter = withOutreachFooter({ html, text }, {
      token: lead.unsub_token,
      postalAddress: campaign.postal_address,
    });
    return {
      to: lead.email,
      fields: vars,
      subject,
      html: withFooter.html,
      text: withFooter.text,
      // Flags an obvious rendering failure such as "Hi ," or a stray token.
      unresolved: /\{\{|\bHi\s*,|\bHello\s*,|\s{2,},/.test(`${subject} ${text}`),
    };
  });

  res.json({
    mode: 'outreach',
    eligible: eligible.length,
    total,
    excluded,
    placeholders: audit,
    risky_placeholders: audit.filter((p) => !p.safe),
    previews,
  });
});

// The footer is appended at send time, so any analysis of the draft has to
// include it to reflect what the recipient will receive. A placeholder token
// stands in for the per-recipient unsubscribe link.
function composeForAnalysis(campaign) {
  const base = { html: campaign.html, text: campaign.text || htmlToText(campaign.html) };
  return campaign.mode === 'outreach'
    ? withOutreachFooter(base, { token: 'preview-token', postalAddress: campaign.postal_address })
    : withUnsubscribeFooter(base, 'preview-token');
}

/** Everything that would stop this campaign from sending, before it is queued. */
router.get('/:id/preflight', (req, res) => {
  const campaign = db
    .prepare('SELECT * FROM campaigns WHERE id = ? AND user_id = ?')
    .get(int(req.params.id), req.user.id);
  if (!campaign) return res.status(404).json({ error: 'Not found' });

  const blockers = [];
  const warnings = [];

  if (!campaign.subject) blockers.push('The campaign has no subject.');

  let recipients = null;
  let fromEmail = '';

  if (campaign.mode === 'outreach') {
    if (!campaign.lead_list_id) blockers.push('No lead list is selected.');
    if (!campaign.postal_address.trim()) {
      blockers.push('Cold outreach needs a physical postal address in the footer. CAN-SPAM requires it in every commercial email.');
    }
    if (campaign.lead_list_id) {
      recipients = outreachRecipients(campaign);
      if (!recipients.eligible.length) blockers.push('No eligible leads — every lead is opted out, suppressed or filtered by the validation gate.');
      if (recipients.excluded.unchecked) {
        warnings.push(`${recipients.excluded.unchecked} lead(s) have never been validated and will be skipped. Run validation on the list first, or turn the gate off.`);
      }
    }
  } else if (!campaign.list_id) {
    blockers.push('No list is selected.');
  }

  if (campaign.use_pool) {
    const pool = poolStatus(req.user.id);
    const usable = pool.filter((m) => m.verified && m.active);
    if (!usable.length) blockers.push('No verified mailbox is in the sending pool.');
    else {
      fromEmail = usable[0].email;
      const capacity = poolCapacity(req.user.id);
      if (recipients && capacity < recipients.eligible.length) {
        warnings.push(
          `The pool can send about ${capacity} more messages today but ${recipients.eligible.length} are queued. The rest will go out over the following days as quotas reset.`
        );
      }
    }
  } else if (campaign.sender_id) {
    const sender = db.prepare('SELECT * FROM senders WHERE id = ? AND user_id = ?').get(campaign.sender_id, req.user.id);
    if (!sender) blockers.push('The selected sender identity no longer exists.');
    else if (!sender.verified) blockers.push('The sender identity is not verified.');
    else fromEmail = sender.from_email;
  } else if (!config.systemSmtp.host) {
    blockers.push('No sending mailbox, sender identity or system SMTP is configured.');
  }

  // Analyse the message as it will actually be sent — with the opt-out footer
  // this platform appends — rather than the raw draft, which would report a
  // missing unsubscribe link that is in fact always added.
  const composed = composeForAnalysis(campaign);
  const content = analyzeContent({
    subject: campaign.subject,
    html: composed.html,
    text: composed.text,
    fromEmail,
    postalAddress: campaign.postal_address,
    mode: campaign.mode,
    sendingDomain: fromEmail.includes('@') ? fromEmail.split('@').pop() : '',
  });
  for (const issue of content.issues.filter((i) => i.severity === 'critical')) {
    warnings.push(`Content: ${issue.title} — ${issue.detail}`);
  }

  res.json({
    ready: blockers.length === 0,
    blockers,
    warnings,
    recipients: recipients ? { eligible: recipients.eligible.length, excluded: recipients.excluded, total: recipients.total } : null,
    content_score: content.score,
    pool_capacity_today: campaign.use_pool ? poolCapacity(req.user.id) : null,
  });
});

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

// Cold outreach is paced with a randomised gap between sends. Mailbox providers
// throttle bursts, and a steady trickle from each account is both safer and
// closer to how a person actually sends mail.
function scheduleOffsets(count, minSec, maxSec) {
  const offsets = [];
  let cursor = 0;
  const lo = Math.max(0, Math.min(minSec, maxSec));
  const hi = Math.max(lo, maxSec);
  for (let i = 0; i < count; i++) {
    offsets.push(cursor);
    cursor += lo + Math.floor(Math.random() * (hi - lo + 1));
  }
  return offsets;
}

router.post('/:id/send', (req, res) => {
  const id = int(req.params.id);
  const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ? AND user_id = ?').get(id, req.user.id);
  if (!campaign) return res.status(404).json({ error: 'Not found' });
  if (campaign.status !== 'draft') return res.status(400).json({ error: 'Campaign already processed' });
  if (!campaign.subject) return res.status(400).json({ error: 'Campaign needs a subject' });

  return campaign.mode === 'outreach'
    ? sendOutreach(req, res, campaign)
    : sendOptIn(req, res, campaign);
});

function sendOutreach(req, res, campaign) {
  if (!campaign.lead_list_id) return res.status(400).json({ error: 'Campaign needs a lead list' });
  if (!campaign.postal_address.trim()) {
    return res.status(400).json({
      error: 'A physical postal address is required for cold outreach. CAN-SPAM requires one in every commercial email, and mail without it is both unlawful in the US and more likely to be filtered.',
    });
  }

  const { eligible, excluded } = outreachRecipients(campaign);
  if (!eligible.length) {
    return res.status(400).json({ error: 'No eligible leads to send to', excluded });
  }

  // Refuse to send copy that would visibly break, unless explicitly overridden.
  // Checked before the sending infrastructure because it is a problem with the
  // campaign itself, which is what the author can act on.
  const audit = auditPlaceholders([campaign.subject, campaign.html, campaign.text], eligible.map(leadVars));
  const risky = audit.filter((p) => !p.safe);
  if (risky.length && !req.body?.allow_missing_fields) {
    return res.status(400).json({
      error: 'Some merge fields would render empty for part of the list.',
      placeholders: risky,
      hint: 'Give each one a fallback, for example {{first_name|there}}, or resend with allow_missing_fields set to true.',
    });
  }

  if (campaign.use_pool) {
    const usable = poolStatus(req.user.id).filter((m) => m.verified && m.active);
    if (!usable.length) return res.status(400).json({ error: 'Add and verify at least one mailbox in the sending pool first' });
  } else if (campaign.sender_id) {
    const sender = db.prepare('SELECT * FROM senders WHERE id = ? AND user_id = ?').get(campaign.sender_id, req.user.id);
    if (!sender?.verified) return res.status(400).json({ error: 'The sender identity must be verified before sending' });
  } else if (!config.systemSmtp.host) {
    return res.status(400).json({ error: 'No sending mailbox or SMTP configured' });
  }

  const offsets = scheduleOffsets(eligible.length, campaign.min_delay_sec, campaign.max_delay_sec);
  const insert = db.prepare(
    `INSERT INTO messages
      (user_id, channel, campaign_id, sender_id, mailbox_id, use_pool, lead_id, to_address, subject,
       html, text, status, unsub_token, source, reply_to, not_before)
     VALUES (?, 'email', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, 'campaign', ?, datetime('now', ?))`
  );

  let queued = 0;
  db.transaction(() => {
    eligible.forEach((lead, i) => {
      const vars = leadVars(lead);
      const subject = render(campaign.subject, vars);
      const html = render(campaign.html, vars);
      const text = render(campaign.text, vars) || htmlToText(html);
      const withFooter = withOutreachFooter({ html, text }, {
        token: lead.unsub_token,
        postalAddress: campaign.postal_address,
      });
      insert.run(
        // mailbox_id is left null for pool sends: the mailbox is chosen at
        // dispatch time from whichever accounts still have capacity.
        req.user.id, campaign.id, campaign.use_pool ? null : campaign.sender_id, null,
        campaign.use_pool ? 1 : 0, lead.id, lead.email, subject,
        withFooter.html, withFooter.text, lead.unsub_token, campaign.reply_to || '',
        `+${offsets[i]} seconds`
      );
      queued++;
    });
    db.prepare("UPDATE campaigns SET status = 'sending' WHERE id = ?").run(campaign.id);
  })();

  const capacity = campaign.use_pool ? poolCapacity(req.user.id) : null;
  const spanMinutes = Math.round(offsets[offsets.length - 1] / 60);

  res.json({
    ok: true,
    queued,
    excluded,
    pool_capacity_today: capacity,
    schedule_span_minutes: spanMinutes,
    note: capacity !== null && capacity < queued
      ? `Queued ${queued} messages. The pool has room for about ${capacity} today; the remainder will send automatically as each mailbox's quota resets.`
      : `Queued ${queued} messages, paced over roughly ${spanMinutes} minutes.`,
  });
}

// Send (or schedule) an opt-in campaign: enqueue one message per CONFIRMED
// subscriber, skipping suppressed addresses. Each message gets a unique
// unsubscribe token and a compliant footer + List-Unsubscribe header.
function sendOptIn(req, res, c) {
  if (!c.list_id) return res.status(400).json({ error: 'Campaign needs a list' });

  const sender = c.sender_id
    ? db.prepare('SELECT * FROM senders WHERE id = ? AND user_id = ?').get(c.sender_id, req.user.id)
    : null;
  if (c.sender_id && !sender) return res.status(400).json({ error: 'Sender not found' });
  if (sender && !sender.verified) {
    return res.status(400).json({ error: 'Sender identity must be verified before sending' });
  }
  if (c.use_pool) {
    const usable = poolStatus(req.user.id).filter((m) => m.verified && m.active);
    if (!usable.length) return res.status(400).json({ error: 'No verified mailbox in the sending pool' });
  } else if (!sender && !config.systemSmtp.host) {
    return res.status(400).json({ error: 'No verified sender and no system SMTP configured' });
  }

  // Only confirmed subscribers are eligible.
  const statusFilter = config.requireDoubleOptIn ? "'confirmed'" : "'confirmed','pending'";
  const recipients = db
    .prepare(
      `SELECT c.id AS contact_id, c.email, c.name, s.token
       FROM subscriptions s JOIN contacts c ON c.id = s.contact_id
       WHERE s.list_id = ? AND s.status IN (${statusFilter})`
    )
    .all(c.list_id);

  let queued = 0;
  let skipped = 0;
  const insert = db.prepare(
    `INSERT INTO messages (user_id, channel, campaign_id, sender_id, use_pool, to_address, subject, html, text, status, unsub_token, source, reply_to)
     VALUES (?, 'email', ?, ?, ?, ?, ?, ?, ?, 'queued', ?, 'campaign', ?)`
  );

  const tx = db.transaction((rows) => {
    for (const r of rows) {
      if (isSuppressed(req.user.id, r.email)) {
        skipped++;
        continue;
      }
      const vars = { name: r.name || '', email: r.email };
      const subject = renderTemplate(c.subject, vars);
      const baseHtml = renderTemplate(c.html, vars);
      const baseText = renderTemplate(c.text, vars);
      const withFooter = withUnsubscribeFooter({ html: baseHtml, text: baseText }, r.token);
      insert.run(
        req.user.id, c.id, c.use_pool ? null : c.sender_id || null, c.use_pool ? 1 : 0,
        r.email, subject, withFooter.html, withFooter.text, r.token, c.reply_to || ''
      );
      queued++;
    }
  });
  tx(recipients);

  db.prepare("UPDATE campaigns SET status = 'sending' WHERE id = ?").run(c.id);
  res.json({ ok: true, queued, skipped, eligible: recipients.length });
}

// Stop a campaign that is mid-flight; anything already delivered stays sent.
router.post('/:id/pause', (req, res) => {
  const id = int(req.params.id);
  const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ? AND user_id = ?').get(id, req.user.id);
  if (!campaign) return res.status(404).json({ error: 'Not found' });

  const info = db
    .prepare("UPDATE messages SET status = 'skipped', error = 'campaign cancelled' WHERE campaign_id = ? AND status = 'queued'")
    .run(id);
  db.prepare("UPDATE campaigns SET status = 'sent' WHERE id = ?").run(id);
  res.json({ ok: true, cancelled: info.changes });
});

export default router;
