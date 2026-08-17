import { htmlToText } from './placeholders.js';

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

export const LETTER_VARIANTS = [
  { id: 1, label: 'Letterhead', blurb: 'Cream page, serif title, company mark on top.' },
  { id: 2, label: 'Ledger', blurb: 'White invoice sheet with a navy amount block.' },
  { id: 3, label: 'Banner', blurb: 'Full-width color header, then a clean body.' },
  { id: 4, label: 'Rail', blurb: 'Left accent bar, tight details, strong button.' },
  { id: 5, label: 'Spotlight', blurb: 'Centered card, oversized CTA, quiet footer.' },
];

function btn(href, label, color) {
  return `<a href="${esc(href)}" style="display:inline-block;background:${color};color:#ffffff;text-decoration:none;padding:14px 28px;border-radius:6px;font-weight:700;font-size:15px;letter-spacing:.01em">${esc(label)}</a>`;
}

function kv(rows) {
  const cells = rows
    .filter((r) => r[1])
    .map(
      ([k, v]) =>
        `<tr>
          <td style="padding:9px 0;border-bottom:1px solid #eee8df;color:#7a746c;font-size:12px;width:34%;vertical-align:top;text-transform:uppercase;letter-spacing:.06em">${esc(k)}</td>
          <td style="padding:9px 0;border-bottom:1px solid #eee8df;font-size:15px;color:#1c1917">${v}</td>
        </tr>`
    )
    .join('');
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:8px 0 20px">${cells}</table>`;
}

function linkBox(url) {
  const u = url || '{{link_url}}';
  return `<p style="margin:18px 0 0;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;color:#57534e;word-break:break-all;background:#f5f0e8;border:1px dashed #d6cfc3;padding:10px 12px;border-radius:6px">${esc(u)}</p>`;
}

function shell({ preheader, accent, header, kicker, body, footerNote, variant = 1 }) {
  const v = Math.min(5, Math.max(1, Number(variant) || 1));
  const company = '{{company|Your company}}';
  const foot =
    footerNote ||
    `This message was sent by ${company} to {{name|you}} because you already work with them. It is not a notice from a third-party software brand.`;

  const inner = {
    1: `<table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;width:100%;background:#fffaf3;border:1px solid #e7e0d4;border-radius:16px;overflow:hidden">
        <tr><td style="padding:28px 36px 14px;border-bottom:4px solid ${accent}">
          <div style="font-family:system-ui,sans-serif;font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:${accent};font-weight:700">${esc(kicker || company)}</div>
          <h1 style="margin:10px 0 0;font-size:26px;line-height:1.25;font-weight:700;font-family:Georgia,serif">${header}</h1>
        </td></tr>
        <tr><td style="padding:28px 36px 10px;font-family:system-ui,Segoe UI,sans-serif;font-size:16px;line-height:1.6;color:#44403c">${body}</td></tr>
        <tr><td style="padding:8px 36px 28px;font-family:system-ui,sans-serif;font-size:12px;color:#a8a29e;line-height:1.5">${foot}</td></tr>
      </table>`,
    2: `<table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;width:100%;background:#ffffff;border:1px solid #dbe3ee">
        <tr><td style="background:${accent};padding:22px 32px;color:#fff">
          <div style="font-size:12px;letter-spacing:.14em;text-transform:uppercase;opacity:.85">${esc(kicker || company)}</div>
          <div style="font-size:22px;font-weight:800;margin-top:6px">${header}</div>
        </td></tr>
        <tr><td style="padding:28px 32px 12px;font-family:system-ui,sans-serif;font-size:15px;line-height:1.6;color:#1e293b">${body}</td></tr>
        <tr><td style="padding:8px 32px 24px;font-size:12px;color:#64748b">${foot}</td></tr>
      </table>`,
    3: `<table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;width:100%;background:#ffffff">
        <tr><td style="height:8px;background:${accent};font-size:0;line-height:0">&nbsp;</td></tr>
        <tr><td style="padding:28px 32px 0;font-family:system-ui,sans-serif">
          <div style="font-size:12px;color:${accent};font-weight:700;letter-spacing:.08em;text-transform:uppercase">${esc(kicker || company)}</div>
          <h1 style="margin:8px 0 18px;font-size:28px;color:#111827">${header}</h1>
        </td></tr>
        <tr><td style="padding:0 32px 12px;font-family:system-ui,sans-serif;font-size:16px;line-height:1.65;color:#374151">${body}</td></tr>
        <tr><td style="padding:12px 32px 28px;font-size:12px;color:#9ca3af;border-top:1px solid #e5e7eb">${foot}</td></tr>
      </table>`,
    4: `<table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;width:100%;background:#fff;border:1px solid #e5e7eb">
        <tr>
          <td style="width:8px;background:${accent};font-size:0">&nbsp;</td>
          <td style="padding:28px 28px 12px;font-family:system-ui,sans-serif">
            <div style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#6b7280">${esc(kicker || company)}</div>
            <h1 style="margin:8px 0 16px;font-size:24px;color:#111">${header}</h1>
            <div style="font-size:15px;line-height:1.65;color:#374151">${body}</div>
            <div style="margin-top:22px;font-size:12px;color:#9ca3af">${foot}</div>
          </td>
        </tr>
      </table>`,
    5: `<table role="presentation" width="560" cellspacing="0" cellpadding="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 8px 32px rgba(15,23,42,.08)">
        <tr><td style="padding:36px 32px 8px;text-align:center;font-family:system-ui,sans-serif">
          <div style="display:inline-block;padding:6px 12px;border-radius:999px;background:#f1f5f9;color:${accent};font-size:11px;font-weight:800;letter-spacing:.12em;text-transform:uppercase">${esc(kicker || company)}</div>
          <h1 style="margin:16px 0 8px;font-size:26px;color:#0f172a">${header}</h1>
        </td></tr>
        <tr><td style="padding:8px 36px 28px;font-family:system-ui,sans-serif;font-size:16px;line-height:1.65;color:#334155;text-align:center">${body}<div style="margin-top:24px;font-size:12px;color:#94a3b8;text-align:left">${foot}</div></td></tr>
      </table>`,
  };

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${esc(header)}</title>
</head>
<body style="margin:0;padding:0;background:#eef1f4;font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#1c1917">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(preheader)}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#eef1f4;padding:32px 12px">
    <tr><td align="center">${inner[v] || inner[1]}</td></tr>
  </table>
</body>
</html>`;
}

export const LETTER_KINDS = [
  {
    id: 'quote_request',
    title: 'Request for quote',
    blurb: 'Ask each lead for a quote. First name, company, title, and email fill in from your paste.',
    accent: '#1d4ed8',
    fields: [
      { key: 'from_company', label: 'Your company', placeholder: 'Harbor Supply Co.' },
      { key: 'sender_name', label: 'Your name', placeholder: 'Pat Morgan' },
      { key: 'service', label: 'What you need quoted', placeholder: 'Custom millwork and install' },
      { key: 'project', label: 'Project or job name', placeholder: 'Lobby renovation — Phase 1' },
      { key: 'details', label: 'Scope notes', placeholder: 'Need pricing, lead time, and any drawing requirements.' },
      { key: 'reply_url', label: 'Quote form URL (optional)', placeholder: 'https://yourcompany.com/rfq' },
      { key: 'cta', label: 'Button label', placeholder: 'Open quote form' },
    ],
  },
  {
    id: 'invoice',
    title: 'Invoice',
    blurb: 'A real HTML bill from your company: number, amount, due date, pay button.',
    accent: '#1e3a5f',
    fields: [
      { key: 'company', label: 'Your company', placeholder: 'Northwind Labs' },
      { key: 'invoice_number', label: 'Invoice number', placeholder: 'INV-1042' },
      { key: 'amount', label: 'Amount due', placeholder: '$2,400.00' },
      { key: 'due_date', label: 'Due date', placeholder: '1 September 2026' },
      { key: 'description', label: 'Line item', placeholder: 'August retainer — design & engineering' },
      { key: 'pay_url', label: 'Your payment URL', placeholder: 'https://pay.yourcompany.com/inv/1042' },
      { key: 'cta', label: 'Button label', placeholder: 'View and pay' },
    ],
  },
  {
    id: 'signature_request',
    title: 'E-sign request',
    blurb: 'Ask someone to review and sign on your own signing page — not a third-party brand.',
    accent: '#0f766e',
    fields: [
      { key: 'company', label: 'Your company', placeholder: 'Northwind Labs' },
      { key: 'document_title', label: 'Document title', placeholder: 'Master services agreement' },
      { key: 'requester', label: 'Requested by', placeholder: 'Jordan Lee, Legal' },
      { key: 'sign_url', label: 'Your signing page URL', placeholder: 'https://yourcompany.com/sign/abc' },
      { key: 'expires', label: 'Expires', placeholder: '30 August 2026' },
      { key: 'cta', label: 'Button label', placeholder: 'Review and sign' },
    ],
  },
  {
    id: 'video_meeting',
    title: 'Meeting invite',
    blurb: 'Calendar-style invite with time, duration, and your own join URL.',
    accent: '#075985',
    fields: [
      { key: 'company', label: 'Your company', placeholder: 'Northwind Labs' },
      { key: 'meeting_title', label: 'Meeting title', placeholder: 'Project kickoff' },
      { key: 'meeting_time', label: 'When', placeholder: 'Tue 18 Aug 2026, 10:00' },
      { key: 'duration', label: 'Duration', placeholder: '45 minutes' },
      { key: 'join_url', label: 'Your join URL', placeholder: 'https://meet.yourcompany.com/kickoff' },
      { key: 'agenda', label: 'Agenda', placeholder: 'Goals, timeline, owners' },
      { key: 'cta', label: 'Button label', placeholder: 'Join meeting' },
    ],
  },
  {
    id: 'shared_file',
    title: 'Shared files',
    blurb: 'Notify that your team shared a folder or file in your workspace.',
    accent: '#5b21b6',
    fields: [
      { key: 'company', label: 'Your company', placeholder: 'Northwind Labs' },
      { key: 'file_name', label: 'File or folder name', placeholder: 'Launch assets / Week 12' },
      { key: 'shared_by', label: 'Shared by', placeholder: 'Sam Chen' },
      { key: 'file_url', label: 'Your workspace URL', placeholder: 'https://files.yourcompany.com/f/abc' },
      { key: 'permission', label: 'Permission', placeholder: 'Can comment' },
      { key: 'cta', label: 'Button label', placeholder: 'Open files' },
    ],
  },
  {
    id: 'document_review',
    title: 'Document review',
    blurb: 'Share a PDF or file hosted on your domain for comments.',
    accent: '#9a3412',
    fields: [
      { key: 'company', label: 'Your company', placeholder: 'Northwind Labs' },
      { key: 'document_title', label: 'Document title', placeholder: 'Q3 brand guidelines.pdf' },
      { key: 'requester', label: 'Shared by', placeholder: 'Alex Rivera' },
      { key: 'review_url', label: 'Your file URL', placeholder: 'https://files.yourcompany.com/d/abc' },
      { key: 'note', label: 'Note', placeholder: 'Please comment on section 4.' },
      { key: 'cta', label: 'Button label', placeholder: 'Open document' },
    ],
  },
  {
    id: 'calendar_meeting',
    title: 'Calendar hold',
    blurb: 'Written meeting notice with time, room, and optional remote link.',
    accent: '#365314',
    fields: [
      { key: 'company', label: 'Your company', placeholder: 'Northwind Labs' },
      { key: 'meeting_title', label: 'Title', placeholder: 'Quarterly business review' },
      { key: 'meeting_time', label: 'When', placeholder: 'Fri 21 Aug 2026, 15:00' },
      { key: 'location', label: 'Where', placeholder: 'HQ — Room 4, or join remotely' },
      { key: 'join_url', label: 'Remote join URL (optional)', placeholder: 'https://yourcompany.com/meet/qbr' },
      { key: 'organizer', label: 'Organizer', placeholder: 'Taylor Morgan' },
      { key: 'cta', label: 'Button label', placeholder: 'View details' },
    ],
  },
  {
    id: 'receipt',
    title: 'Receipt',
    blurb: 'Confirm a payment the recipient already made to you.',
    accent: '#0f766e',
    fields: [
      { key: 'company', label: 'Your company', placeholder: 'Northwind Labs' },
      { key: 'receipt_number', label: 'Receipt number', placeholder: 'RCT-8891' },
      { key: 'amount', label: 'Amount paid', placeholder: '$2,400.00' },
      { key: 'paid_at', label: 'Paid on', placeholder: '15 August 2026' },
      { key: 'description', label: 'For', placeholder: 'August retainer' },
      { key: 'receipt_url', label: 'Receipt URL', placeholder: 'https://pay.yourcompany.com/r/8891' },
      { key: 'cta', label: 'Button label', placeholder: 'View receipt' },
    ],
  },
];

export const SAMPLE_FIELDS = {
  company: 'Northwind Labs',
  from_company: 'Northwind Labs',
  sender_name: 'Jordan Lee',
  service: 'custom millwork and install',
  project: 'Lobby renovation — Phase 1',
  details: 'Need pricing, lead time, and any drawing requirements.',
  reply_url: 'https://northwind.example/rfq',
  invoice_number: 'INV-1042',
  amount: '$2,400.00',
  due_date: '1 September 2026',
  description: 'August retainer — design and engineering',
  pay_url: 'https://pay.yourcompany.com/inv/1042',
  document_title: 'Master services agreement',
  requester: 'Jordan Lee, Legal',
  sign_url: 'https://yourcompany.com/sign/abc',
  expires: '30 August 2026',
  meeting_title: 'Project kickoff',
  meeting_time: 'Tue 18 Aug 2026, 10:00',
  duration: '45 minutes',
  join_url: 'https://meet.yourcompany.com/kickoff',
  agenda: 'Goals, timeline, owners',
  file_name: 'Launch assets / Week 12',
  shared_by: 'Sam Chen',
  file_url: 'https://files.yourcompany.com/f/abc',
  permission: 'Can comment',
  review_url: 'https://files.yourcompany.com/d/abc',
  note: 'Please comment on section 4.',
  location: 'HQ — Room 4, or join remotely',
  organizer: 'Taylor Morgan',
  receipt_number: 'RCT-8891',
  paid_at: '15 August 2026',
  receipt_url: 'https://pay.yourcompany.com/r/8891',
};

const APPLY_TOKEN = /\{\{\s*([a-zA-Z0-9_]+)(?:\s*\|\s*([^}]+?))?\s*\}\}/g;

function applyFields(template, fields) {
  if (!template) return template;
  const filled = fields || {};
  return String(template).replace(APPLY_TOKEN, (match, key, fallback) => {
    if (!Object.prototype.hasOwnProperty.call(filled, key)) return match;
    const val = filled[key];
    if (val === undefined || val === null || String(val).trim() === '') {
      return fallback !== undefined ? String(fallback).trim() : match;
    }
    return String(val);
  });
}

function build(kind, fields, variant) {
  const f = { cta: '', ...fields };
  const company = f.company || '{{company|Your company}}';
  const v = variant;

  if (kind === 'quote_request') {
    const brand = f.from_company || f.company || 'our team';
    const sender = f.sender_name || 'A teammate';
    const service = f.service || 'the work below';
    const project = f.project || '';
    const details = f.details || '';
    const reply = f.reply_url || '';
    const cta = f.cta || 'Open quote form';
    const html = shell({
      variant: v,
      preheader: `Quote request from ${brand} for ${service}.`,
      accent: '#1d4ed8',
      kicker: brand,
      header: 'Request for quote',
      footerNote: `This quote request was sent by ${esc(brand)} to {{name|you}}. It is not a notice from a marketplace or a third-party software brand.`,
      body: `
        <p>Hi {{first_name|there}},</p>
        <p>${esc(sender)} at <strong>${esc(brand)}</strong> is requesting a quote from {{company|your team}}. Would {{title|the team there}} be able to price the work below?</p>
        ${kv([
          ['From', esc(brand)],
          ['Contact', esc(sender)],
          ['Service', esc(service)],
          ['Project', project ? esc(project) : ''],
          ['Lead email on file', '{{email}}'],
        ])}
        ${details ? `<p style="background:#eff6ff;border:1px solid #bfdbfe;padding:12px 14px;border-radius:8px">${esc(details)}</p>` : ''}
        <p>Please reply to this message with pricing, availability, and any questions. A short written quote is enough.</p>
        ${
          reply
            ? `<p style="margin:24px 0">${btn(reply, cta, '#1d4ed8')}</p>${linkBox(reply)}`
            : '<p style="margin:18px 0 0;color:#57534e;font-size:14px">No form is required — reply to this email.</p>'
        }`,
    });
    return {
      subject: `Quote request for {{company|your team}} — ${project || service}`,
      html,
    };
  }

  if (kind === 'signature_request') {
    const html = shell({
      variant: v,
      preheader: `${f.document_title || 'A document'} from ${f.company || 'your team'} is waiting for a signature.`,
      accent: '#0f766e',
      kicker: company,
      header: 'Please review and sign',
      body: `
        <p>Hi {{first_name|there}},</p>
        <p><strong>${esc(company)}</strong> needs your signature on the document below. Open it on their site — this is their request, not a third-party signing service.</p>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:18px 0;border:1px solid #d7ebe7;border-radius:12px;background:#f3fbf9">
          <tr>
            <td style="width:56px;padding:16px;vertical-align:top">
              <div style="width:40px;height:52px;border:1px solid #99f6e4;background:#fff;border-radius:4px;box-shadow:2px 2px 0 #ccfbf1"></div>
            </td>
            <td style="padding:16px 16px 16px 0">
              <div style="font-size:12px;color:#0f766e;font-weight:700;letter-spacing:.08em;text-transform:uppercase">Document</div>
              <div style="font-size:18px;font-weight:700;margin:4px 0">${esc(f.document_title || '{{document_title}}')}</div>
              <div style="font-size:13px;color:#5b6b68">Requested by ${esc(f.requester || '{{requester}}')} · expires ${esc(f.expires || '{{expires}}')}</div>
            </td>
          </tr>
        </table>
        <p style="margin:24px 0">${btn(f.sign_url || '{{sign_url}}', f.cta || 'Review and sign', '#0f766e')}</p>
        ${linkBox(f.sign_url || '{{sign_url}}')}`,
    });
    return {
      subject: `Signature requested: ${f.document_title || '{{document_title}}'} — ${f.company || '{{company}}'}`,
      html,
    };
  }

  if (kind === 'document_review') {
    const html = shell({
      variant: v,
      preheader: `${f.requester || 'A teammate'} shared ${f.document_title || 'a document'} with you.`,
      accent: '#9a3412',
      kicker: company,
      header: 'A document was shared with you',
      body: `
        <p>Hi {{first_name|there}},</p>
        <p>${esc(f.requester || '{{requester}}')} at <strong>${esc(company)}</strong> shared a file for your review.</p>
        ${kv([
          ['File', esc(f.document_title || '{{document_title}}')],
          ['From', esc(f.requester || '{{requester}}')],
        ])}
        ${f.note ? `<p style="background:#fff7ed;border:1px solid #fed7aa;padding:12px 14px;border-radius:8px">${esc(f.note)}</p>` : ''}
        <p style="margin:24px 0">${btn(f.review_url || '{{review_url}}', f.cta || 'Open document', '#9a3412')}</p>
        ${linkBox(f.review_url || '{{review_url}}')}`,
    });
    return {
      subject: `${f.requester || '{{requester}}'} shared “${f.document_title || '{{document_title}}'}”`,
      html,
    };
  }

  if (kind === 'invoice') {
    const html = shell({
      variant: v,
      preheader: `Invoice ${f.invoice_number || ''} from ${f.company || 'us'} — ${f.amount || ''} due ${f.due_date || ''}.`,
      accent: '#1e3a5f',
      kicker: company,
      header: 'You have an invoice',
      body: `
        <p>Hi {{first_name|there}},</p>
        <p><strong>${esc(company)}</strong> sent you an invoice. Pay on their checkout page using the button below.</p>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:18px 0;background:#f8fafc;border:1px solid #dbe3ee;border-radius:12px">
          <tr><td style="padding:20px 22px">
            <div style="font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:.08em">Amount due</div>
            <div style="font-size:36px;font-weight:800;color:#1e3a5f;margin:6px 0 4px">${esc(f.amount || '{{amount}}')}</div>
            <div style="font-size:13px;color:#64748b">Due ${esc(f.due_date || '{{due_date}}')} · ${esc(f.invoice_number || '{{invoice_number}}')}</div>
          </td></tr>
          <tr><td style="padding:0 22px 8px">${kv([
            ['Bill to', '{{name}} · {{email}}'],
            ['Description', esc(f.description || '{{description}}')],
            ['From', esc(company)],
          ])}</td></tr>
        </table>
        <p style="margin:8px 0 24px">${btn(f.pay_url || '{{pay_url}}', f.cta || 'View and pay', '#1e3a5f')}</p>
        ${linkBox(f.pay_url || '{{pay_url}}')}`,
    });
    return {
      subject: `Invoice ${f.invoice_number || '{{invoice_number}}'} from ${f.company || '{{company}}'} — ${f.amount || '{{amount}}'} due`,
      html,
    };
  }

  if (kind === 'shared_file') {
    const html = shell({
      variant: v,
      preheader: `${f.shared_by || 'A teammate'} shared ${f.file_name || 'a file'} in the ${f.company || ''} workspace.`,
      accent: '#5b21b6',
      kicker: company,
      header: 'Files were shared with you',
      body: `
        <p>Hi {{first_name|there}},</p>
        <p>${esc(f.shared_by || '{{shared_by}}')} shared an item in the <strong>${esc(company)}</strong> workspace. Sign in with your existing ${esc(company)} account.</p>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:18px 0;border:1px solid #e9d5ff;border-radius:12px;background:#faf5ff">
          <tr>
            <td style="width:52px;padding:16px;font-size:22px;color:#7c3aed">▣</td>
            <td style="padding:16px 16px 16px 0">
              <div style="font-size:16px;font-weight:700">${esc(f.file_name || '{{file_name}}')}</div>
              <div style="font-size:13px;color:#6b21a8;margin-top:4px">${esc(f.permission || '{{permission}}')} · shared by ${esc(f.shared_by || '{{shared_by}}')}</div>
            </td>
          </tr>
        </table>
        <p style="margin:24px 0">${btn(f.file_url || '{{file_url}}', f.cta || 'Open files', '#5b21b6')}</p>
        ${linkBox(f.file_url || '{{file_url}}')}`,
    });
    return {
      subject: `${f.shared_by || '{{shared_by}}'} shared “${f.file_name || '{{file_name}}'}” with you`,
      html,
    };
  }

  if (kind === 'video_meeting') {
    const html = shell({
      variant: v,
      preheader: `${f.meeting_title || 'Meeting'} · ${f.meeting_time || ''} · ${f.company || ''}`,
      accent: '#075985',
      kicker: company,
      header: f.meeting_title || 'You are invited to a meeting',
      body: `
        <p>Hi {{first_name|there}},</p>
        <p><strong>${esc(company)}</strong> invited you to a video meeting. Use their join link — this is not a consumer conferencing brand notice.</p>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:18px 0;border:1px solid #bae6fd;border-radius:12px;overflow:hidden">
          <tr><td style="background:#0c4a6e;color:#fff;padding:14px 18px;font-size:13px;letter-spacing:.1em;text-transform:uppercase">When</td></tr>
          <tr><td style="padding:16px 18px;background:#f0f9ff">
            <div style="font-size:20px;font-weight:800;color:#0c4a6e">${esc(f.meeting_time || '{{meeting_time}}')}</div>
            <div style="font-size:14px;color:#075985;margin-top:4px">${esc(f.duration || '{{duration}}')}</div>
          </td></tr>
        </table>
        ${kv([['Agenda', esc(f.agenda || '{{agenda}}')]])}
        <p style="margin:24px 0">${btn(f.join_url || '{{join_url}}', f.cta || 'Join meeting', '#075985')}</p>
        ${linkBox(f.join_url || '{{join_url}}')}`,
    });
    return {
      subject: `Invitation: ${f.meeting_title || '{{meeting_title}}'} — ${f.meeting_time || '{{meeting_time}}'}`,
      html,
    };
  }

  if (kind === 'calendar_meeting') {
    const html = shell({
      variant: v,
      preheader: `${f.meeting_title || 'Meeting'} with ${f.company || 'us'} on ${f.meeting_time || ''}.`,
      accent: '#365314',
      kicker: company,
      header: f.meeting_title || 'You are invited',
      body: `
        <p>Hi {{first_name|there}},</p>
        <p>${esc(f.organizer || '{{organizer}}')} at <strong>${esc(company)}</strong> invited you to a meeting.</p>
        ${kv([
          ['When', esc(f.meeting_time || '{{meeting_time}}')],
          ['Where', esc(f.location || '{{location}}')],
          ['Organizer', esc(f.organizer || '{{organizer}}')],
        ])}
        <p style="margin:24px 0">${btn(f.join_url || '{{join_url}}', f.cta || 'View details', '#365314')}</p>`,
    });
    return {
      subject: `Invitation: ${f.meeting_title || '{{meeting_title}}'} — ${f.meeting_time || '{{meeting_time}}'}`,
      html,
    };
  }

  if (kind === 'receipt') {
    const html = shell({
      variant: v,
      preheader: `Receipt ${f.receipt_number || ''} · ${f.amount || ''} paid to ${f.company || 'us'}.`,
      accent: '#0f766e',
      kicker: company,
      header: 'Payment received',
      body: `
        <p>Hi {{first_name|there}},</p>
        <p>Thank you. <strong>${esc(company)}</strong> received your payment.</p>
        <div style="font-size:32px;font-weight:800;color:#0f766e;margin:12px 0">${esc(f.amount || '{{amount}}')}</div>
        ${kv([
          ['Receipt', esc(f.receipt_number || '{{receipt_number}}')],
          ['Paid on', esc(f.paid_at || '{{paid_at}}')],
          ['For', esc(f.description || '{{description}}')],
        ])}
        <p style="margin:24px 0">${btn(f.receipt_url || '{{receipt_url}}', f.cta || 'View receipt', '#0f766e')}</p>`,
    });
    return {
      subject: `Receipt ${f.receipt_number || '{{receipt_number}}'} from ${f.company || '{{company}}'}`,
      html,
    };
  }

  throw new Error('Unknown letter kind');
}

function nonempty(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (v !== undefined && v !== null && String(v).trim() !== '') out[k] = v;
  }
  return out;
}

const LEAD_MERGE_KEYS = new Set([
  'first_name',
  'last_name',
  'name',
  'email',
  'phone',
  'company',
  'title',
  'custom1',
  'custom2',
]);

function fieldsForApply(kind, filled) {
  if (kind !== 'quote_request') return filled;
  const out = { ...filled };
  for (const k of LEAD_MERGE_KEYS) delete out[k];
  return out;
}

export function generateLetter(kind, fields = {}, locale = 'en', opts = {}) {
  const meta = LETTER_KINDS.find((k) => k.id === kind);
  if (!meta) throw new Error('Unknown letter kind');
  const filled = nonempty(fields);
  const variant = Math.min(5, Math.max(1, parseInt(opts.variant || filled.variant || 1, 10) || 1));
  const built = build(kind, filled, variant);
  const apply = fieldsForApply(kind, filled);
  let html = applyFields(built.html, apply);
  let subject = applyFields(built.subject, apply);

  if (locale === 'ja') {
    html = html.replace('Hi {{first_name|there}},', '{{first_name|お客様}} 様');
  }

  return {
    kind,
    locale,
    variant,
    subject,
    html,
    text: htmlToText(html),
  };
}

export function generateVariations(kind, fields = {}, locale = 'en') {
  return LETTER_VARIANTS.map((v) => generateLetter(kind, fields, locale, { variant: v.id }));
}

export function letterCatalog() {
  return LETTER_KINDS.map(({ id, title, blurb, accent, fields }) => ({
    id,
    title,
    blurb,
    accent,
    fields,
  }));
}
