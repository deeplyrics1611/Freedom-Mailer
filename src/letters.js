import { htmlToText, renderTemplate } from './placeholders.js';

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

function btn(href, label, color) {
  return `<a href="${esc(href)}" style="display:inline-block;background:${color};color:#ffffff;text-decoration:none;padding:14px 28px;border-radius:8px;font-weight:700;font-size:15px">${esc(label)}</a>`;
}

function shell({ preheader, accent, header, body, footerNote }) {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${esc(header)}</title>
</head>
<body style="margin:0;padding:0;background:#f4f1ea;font-family:Georgia,'Times New Roman',serif;color:#1c1917">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(preheader)}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f1ea;padding:32px 12px">
    <tr><td align="center">
      <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;width:100%;background:#fffaf3;border:1px solid #e7e0d4;border-radius:16px;overflow:hidden">
        <tr>
          <td style="padding:28px 36px 12px;border-bottom:4px solid ${accent}">
            <div style="font-family:system-ui,-apple-system,sans-serif;font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:${accent};font-weight:700">{{company|Your company}}</div>
            <h1 style="margin:10px 0 0;font-size:26px;line-height:1.25;font-weight:700">${header}</h1>
          </td>
        </tr>
        <tr>
          <td style="padding:28px 36px 8px;font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:16px;line-height:1.6;color:#44403c">
            ${body}
          </td>
        </tr>
        <tr>
          <td style="padding:8px 36px 28px;font-family:system-ui,-apple-system,sans-serif;font-size:12px;color:#a8a29e;line-height:1.5">
            ${footerNote || 'Sent by {{company|your company}} for {{name|you}}. This is a transactional message from an organization you work with.'}
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function kv(rows) {
  const cells = rows
    .filter((r) => r[1])
    .map(
      ([k, v]) =>
        `<tr>
          <td style="padding:8px 0;color:#a8a29e;font-size:13px;width:38%;vertical-align:top">${esc(k)}</td>
          <td style="padding:8px 0;font-size:14px;color:#1c1917">${v}</td>
        </tr>`
    )
    .join('');
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:16px 0 22px">${cells}</table>`;
}

export const LETTER_KINDS = [
  {
    id: 'signature_request',
    title: 'Signature request',
    blurb: 'Ask a recipient to review and sign a document on your own site.',
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
    id: 'document_review',
    title: 'Document review',
    blurb: 'Share a PDF or file for review — hosted on your domain, not a third-party brand.',
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
    id: 'invoice',
    title: 'Invoice',
    blurb: 'A payment request from your company with amount, due date, and pay link.',
    accent: '#1e3a5f',
    fields: [
      { key: 'company', label: 'Your company', placeholder: 'Northwind Labs' },
      { key: 'invoice_number', label: 'Invoice number', placeholder: 'INV-1042' },
      { key: 'amount', label: 'Amount due', placeholder: '$2,400.00' },
      { key: 'due_date', label: 'Due date', placeholder: '1 September 2026' },
      { key: 'description', label: 'Description', placeholder: 'August retainer — design & engineering' },
      { key: 'pay_url', label: 'Your payment URL', placeholder: 'https://pay.yourcompany.com/inv/1042' },
      { key: 'cta', label: 'Button label', placeholder: 'Pay invoice' },
    ],
  },
  {
    id: 'shared_file',
    title: 'Shared workspace file',
    blurb: 'Notify someone that your team shared a folder or file in your workspace.',
    accent: '#5b21b6',
    fields: [
      { key: 'company', label: 'Your company', placeholder: 'Northwind Labs' },
      { key: 'file_name', label: 'File or folder name', placeholder: 'Launch assets / Week 12' },
      { key: 'shared_by', label: 'Shared by', placeholder: 'Sam Chen' },
      { key: 'file_url', label: 'Your workspace URL', placeholder: 'https://workspace.yourcompany.com/f/abc' },
      { key: 'permission', label: 'Permission', placeholder: 'Can comment' },
      { key: 'cta', label: 'Button label', placeholder: 'Open in workspace' },
    ],
  },
  {
    id: 'video_meeting',
    title: 'Video meeting',
    blurb: 'Invite someone to a call on whatever conferencing URL you actually use.',
    accent: '#075985',
    fields: [
      { key: 'company', label: 'Your company', placeholder: 'Northwind Labs' },
      { key: 'meeting_title', label: 'Meeting title', placeholder: 'Project kickoff' },
      { key: 'meeting_time', label: 'When', placeholder: 'Tue 18 Aug 2026, 10:00 JST' },
      { key: 'duration', label: 'Duration', placeholder: '45 minutes' },
      { key: 'join_url', label: 'Your join URL', placeholder: 'https://meet.yourcompany.com/kickoff' },
      { key: 'agenda', label: 'Agenda', placeholder: 'Goals, timeline, owners' },
      { key: 'cta', label: 'Button label', placeholder: 'Join meeting' },
    ],
  },
  {
    id: 'calendar_meeting',
    title: 'Calendar invite',
    blurb: 'A written meeting notice with time, location, and optional video link.',
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

function applyFields(template, fields) {
  // Letter field keys are merged on top of recipient placeholders.
  return renderTemplate(template, fields);
}

function build(kind, fields) {
  const f = { cta: '', ...fields };
  const company = f.company || '{{company|Your company}}';

  if (kind === 'signature_request') {
    const header = 'A document is ready for your signature';
    const html = shell({
      preheader: `${f.document_title || 'A document'} from ${f.company || 'your team'} is waiting for a signature.`,
      accent: '#0f766e',
      header,
      body: `
        <p>Hi {{first_name|there}},</p>
        <p><strong>${esc(company)}</strong> asked you to review and sign a document. This request comes from them, not from a third-party signing brand.</p>
        ${kv([
          ['Document', esc(f.document_title || '{{document_title}}')],
          ['Requested by', esc(f.requester || '{{requester}}')],
          ['Expires', esc(f.expires || '{{expires}}')],
        ])}
        <p style="margin:24px 0">${btn(f.sign_url || '{{sign_url}}', f.cta || 'Review and sign', '#0f766e')}</p>
        <p style="font-size:13px;color:#78716c">If the button does not work, copy this address into your browser:<br />
        <span style="word-break:break-all">${esc(f.sign_url || '{{sign_url}}')}</span></p>`,
    });
    return {
      subject: `Signature requested: ${f.document_title || '{{document_title}}'} — ${f.company || '{{company}}'}`,
      html,
    };
  }

  if (kind === 'document_review') {
    const html = shell({
      preheader: `${f.requester || 'A teammate'} shared ${f.document_title || 'a document'} with you.`,
      accent: '#9a3412',
      header: 'A document was shared with you',
      body: `
        <p>Hi {{first_name|there}},</p>
        <p>${esc(f.requester || '{{requester}}')} at <strong>${esc(company)}</strong> shared a file for your review.</p>
        ${kv([
          ['File', esc(f.document_title || '{{document_title}}')],
          ['From', esc(f.requester || '{{requester}}')],
        ])}
        ${f.note ? `<p style="background:#fff7ed;border:1px solid #fed7aa;padding:12px 14px;border-radius:8px">${esc(f.note)}</p>` : ''}
        <p style="margin:24px 0">${btn(f.review_url || '{{review_url}}', f.cta || 'Open document', '#9a3412')}</p>`,
    });
    return {
      subject: `${f.requester || '{{requester}}'} shared “${f.document_title || '{{document_title}}'}”`,
      html,
    };
  }

  if (kind === 'invoice') {
    const html = shell({
      preheader: `Invoice ${f.invoice_number || ''} from ${f.company || 'us'} — ${f.amount || ''} due ${f.due_date || ''}.`,
      accent: '#1e3a5f',
      header: 'Invoice',
      body: `
        <p>Hi {{first_name|there}},</p>
        <p>Here is an invoice from <strong>${esc(company)}</strong>.</p>
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:20px 22px;margin:18px 0">
          <div style="font-size:13px;color:#64748b">Amount due</div>
          <div style="font-size:32px;font-weight:800;color:#1e3a5f;margin:4px 0 12px">${esc(f.amount || '{{amount}}')}</div>
          ${kv([
            ['Invoice', esc(f.invoice_number || '{{invoice_number}}')],
            ['Due', esc(f.due_date || '{{due_date}}')],
            ['For', esc(f.description || '{{description}}')],
            ['Bill to', '{{name}} · {{email}}'],
          ])}
        </div>
        <p style="margin:24px 0">${btn(f.pay_url || '{{pay_url}}', f.cta || 'Pay invoice', '#1e3a5f')}</p>`,
    });
    return {
      subject: `Invoice ${f.invoice_number || '{{invoice_number}}'} from ${f.company || '{{company}}'} — ${f.amount || '{{amount}}'} due`,
      html,
    };
  }

  if (kind === 'shared_file') {
    const html = shell({
      preheader: `${f.shared_by || 'A teammate'} shared ${f.file_name || 'a file'} in the ${f.company || ''} workspace.`,
      accent: '#5b21b6',
      header: 'A file was shared with you',
      body: `
        <p>Hi {{first_name|there}},</p>
        <p>${esc(f.shared_by || '{{shared_by}}')} shared an item in the <strong>${esc(company)}</strong> workspace.</p>
        ${kv([
          ['Item', esc(f.file_name || '{{file_name}}')],
          ['Shared by', esc(f.shared_by || '{{shared_by}}')],
          ['Access', esc(f.permission || '{{permission}}')],
        ])}
        <p style="margin:24px 0">${btn(f.file_url || '{{file_url}}', f.cta || 'Open in workspace', '#5b21b6')}</p>
        <p style="font-size:13px;color:#78716c">You will sign in with your existing ${esc(company)} account. This is not a Microsoft or Google notice.</p>`,
    });
    return {
      subject: `${f.shared_by || '{{shared_by}}'} shared “${f.file_name || '{{file_name}}'}” with you`,
      html,
    };
  }

  if (kind === 'video_meeting') {
    const html = shell({
      preheader: `${f.meeting_title || 'Meeting'} · ${f.meeting_time || ''} · ${f.company || ''}`,
      accent: '#075985',
      header: f.meeting_title || 'Video meeting',
      body: `
        <p>Hi {{first_name|there}},</p>
        <p>You are invited to a video meeting hosted by <strong>${esc(company)}</strong>.</p>
        ${kv([
          ['When', esc(f.meeting_time || '{{meeting_time}}')],
          ['Duration', esc(f.duration || '{{duration}}')],
          ['Agenda', esc(f.agenda || '{{agenda}}')],
        ])}
        <p style="margin:24px 0">${btn(f.join_url || '{{join_url}}', f.cta || 'Join meeting', '#075985')}</p>
        <p style="font-size:13px;color:#78716c">Join link: <span style="word-break:break-all">${esc(f.join_url || '{{join_url}}')}</span></p>`,
    });
    return {
      subject: `${f.meeting_title || '{{meeting_title}}'} — ${f.meeting_time || '{{meeting_time}}'}`,
      html,
    };
  }

  if (kind === 'calendar_meeting') {
    const html = shell({
      preheader: `${f.meeting_title || 'Meeting'} with ${f.company || 'us'} on ${f.meeting_time || ''}.`,
      accent: '#365314',
      header: f.meeting_title || 'You are invited',
      body: `
        <p>Hi {{first_name|there}},</p>
        <p>${esc(f.organizer || '{{organizer}}')} at <strong>${esc(company)}</strong> invited you to a meeting.</p>
        ${kv([
          ['When', esc(f.meeting_time || '{{meeting_time}}')],
          ['Where', esc(f.location || '{{location}}')],
          ['Organizer', esc(f.organizer || '{{organizer}}')],
        ])}
        <p style="margin:24px 0">${btn(f.join_url || f.location || '{{join_url}}', f.cta || 'View details', '#365314')}</p>`,
    });
    return {
      subject: `Invitation: ${f.meeting_title || '{{meeting_title}}'} — ${f.meeting_time || '{{meeting_time}}'}`,
      html,
    };
  }

  if (kind === 'receipt') {
    const html = shell({
      preheader: `Receipt ${f.receipt_number || ''} · ${f.amount || ''} paid to ${f.company || 'us'}.`,
      accent: '#0f766e',
      header: 'Payment received',
      body: `
        <p>Hi {{first_name|there}},</p>
        <p>Thank you. <strong>${esc(company)}</strong> received your payment.</p>
        ${kv([
          ['Receipt', esc(f.receipt_number || '{{receipt_number}}')],
          ['Amount', esc(f.amount || '{{amount}}')],
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

export function generateLetter(kind, fields = {}, locale = 'en') {
  const meta = LETTER_KINDS.find((k) => k.id === kind);
  if (!meta) throw new Error('Unknown letter kind');
  const filled = nonempty(fields);
  const built = build(kind, filled);
  let html = applyFields(built.html, filled);
  let subject = applyFields(built.subject, filled);

  if (locale === 'ja') {
    // Keep structure; wrap a Japanese greeting when locale requested without an LLM.
    html = html.replace('Hi {{first_name|there}},', '{{first_name|お客様}} 様');
  }

  return {
    kind,
    locale,
    subject,
    html,
    text: htmlToText(html),
  };
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
