import { ImapFlow } from 'imapflow';
import { checkSpam } from './spamcheck.js';
import { checkLinks } from './linkcheck.js';
import { decryptSecret } from './secrets.js';
import { sendEmail } from './mailer.js';

/**
 * Estimate Gmail/Outlook placement from content + sender setup.
 * Optional live check: send a probe to a Gmail you own and look in IMAP
 * (INBOX vs [Gmail]/Spam). Category tabs (Primary/Promotions) are not
 * separate IMAP folders, so those are estimated only.
 */
export async function estimatePlacement({
  subject, html, text, fromName, fromEmail, gmailAuthenticated = false, linkFollow = false,
} = {}) {
  const spam = checkSpam({ subject, html, text, fromName, fromEmail });
  const links = await checkLinks({ html, text, follow: linkFollow });

  const factors = [];
  let inbox = 78;

  if (gmailAuthenticated) {
    inbox += 8;
    factors.push({ ok: true, text: 'Sending via Gmail SMTP (Google authenticates DKIM/SPF for the mailbox).' });
  } else {
    inbox -= 10;
    factors.push({ ok: false, text: 'Not using a verified Gmail identity — authenticate the domain (SPF/DKIM/DMARC) or use Gmail app passwords.' });
  }

  if (spam.verdict === 'fail') { inbox -= 35; factors.push({ ok: false, text: `Spam check failed (score ${spam.score}).` }); }
  else if (spam.verdict === 'warn') { inbox -= 12; factors.push({ ok: false, text: `Spam check has warnings (score ${spam.score}).` }); }
  else { inbox += 6; factors.push({ ok: true, text: 'Content passed the spam-phrase / HTML checks.' }); }

  if (links.summary === 'bad') { inbox -= 20; factors.push({ ok: false, text: 'Link check found bad URLs (shorteners, IP hosts, or dead links).' }); }
  else if (links.summary === 'caution') { inbox -= 8; factors.push({ ok: false, text: 'Link check has cautions.' }); }
  else { factors.push({ ok: true, text: links.count ? 'Links look cold-mail safe.' : 'No links — reply-only CTA is fine for RFQs.' }); }

  const hasText = String(text || '').trim().length > 0;
  if (!hasText) { inbox -= 6; factors.push({ ok: false, text: 'Add a plain-text part.' }); }
  else factors.push({ ok: true, text: 'Plain-text alternative present.' });

  const personalized = /\{\{\s*(first_name|name|company)\s*\}\}/.test(`${subject}\n${html}\n${text}`);
  if (personalized) { inbox += 3; factors.push({ ok: true, text: 'Personalization placeholders present.' }); }

  inbox = Math.max(5, Math.min(96, Math.round(inbox)));

  let tab = 'primary';
  if (/(unsubscribe|newsletter|% off|deal|promo)/i.test(`${subject} ${html}`)) tab = 'promotions';
  if (spam.verdict === 'fail' || links.summary === 'bad' || inbox < 45) tab = 'spam';
  else if (inbox < 65) tab = 'promotions';

  return {
    inbox_likelihood: inbox,
    predicted_tab: tab,
    predicted_label:
      tab === 'primary' ? 'Likely Primary / Inbox'
        : tab === 'promotions' ? 'Likely Promotions (still inbox, not spam)'
          : 'Likely spam / junk',
    factors,
    spam,
    links: { summary: links.summary, count: links.count },
    note: 'This is an estimator. Gmail Primary vs Promotions is a content classifier; only INBOX vs Spam can be verified with an IMAP probe on a mailbox you own.',
  };
}

export async function imapPlacementCheck(sender, { subjectContains, sentTo, waitMs = 8000 } = {}) {
  const pass = decryptSecret(sender.password);
  const client = new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: { user: sender.username, pass },
    logger: false,
  });

  const found = { inbox: false, spam: false, all: false, labels: [] };
  try {
    await new Promise((r) => setTimeout(r, waitMs));
    await client.connect();
    for (const box of ['INBOX', '[Gmail]/Spam', '[Gmail]/All Mail']) {
      try {
        const lock = await client.getMailboxLock(box);
        try {
          const uids = await client.search({ subject: subjectContains, since: new Date(Date.now() - 36e5) });
          if (uids && uids.length) {
            if (box === 'INBOX') found.inbox = true;
            if (box.includes('Spam')) found.spam = true;
            if (box.includes('All Mail')) found.all = true;
            found.labels.push(box);
          }
        } finally {
          lock.release();
        }
      } catch {
        // mailbox name can differ on Workspace / locale
      }
    }
  } finally {
    try { await client.logout(); } catch { /* ignore */ }
  }

  let placement = 'unknown';
  if (found.spam && !found.inbox) placement = 'spam';
  else if (found.inbox) placement = 'inbox';
  else if (found.all) placement = 'archived_or_filtered';

  return { to: sentTo || sender.from_email, placement, found, subjectContains };
}

export async function sendPlacementProbe(sender, to) {
  const token = `PLCM-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const subject = `[RFQ placement probe] ${token}`;
  await sendEmail({
    sender,
    to,
    subject,
    text: `Inbox placement probe ${token}. You can delete this message.`,
    html: `<p>Inbox placement probe <strong>${token}</strong>. You can delete this message.</p>`,
  });
  return { token, subject };
}
