import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseLeads, toSmsAddress, isEmail } from './leads.js';
import { renderTemplate, expandVars, listPlaceholders } from './placeholders.js';
import { generateLetter, letterCatalog } from './letters.js';
import { SMTP_PRESETS, SENDER_KINDS, applyProviderDefaults, awsSesSmtpHost } from './presets.js';
import {
  tokenUrl,
  buildGraphMessage,
  diagnoseOfficeError,
  OFFICE_SMTP,
  GRAPH_PERMISSIONS,
} from './office365.js';
import { staticValidate, classifyClient, extractUrls, parseLinkBase, shortUrl, linkBaseFor, cnameRecord, probeLinkHost } from './links.js';
import { inspectLocal, classifyMx, debounceEmails } from './deliverability.js';
import {
  buildMailgunForm,
  buildMailgunMultipart,
  buildSendGridPayload,
  buildSesPayload,
  signAwsV4,
  mailgunDomain,
  mailgunApiBase,
  usesHttpApi,
} from './providers.js';
import { analyzeContent, scrubContent, sendBlockError } from './spamcheck.js';
import {
  normalizeAttachments,
  sanitizeHtmlAttachment,
  makeHtmlAttachment,
  toSendGridAttachments,
  toGraphAttachments,
  toNodemailerAttachments,
} from './attachments.js';
import { computeExpiry, extendExpiry, licenseStatus } from './license.js';
import {
  dailyTarget,
  bounceShouldPause,
  spreadTimes,
  parseSeeds,
  pickNote,
  renderNote,
  warmupPreset,
  WARMUP_NOTES,
  perSeedCap,
  replySubject,
  validRamp,
  queueAutoReply,
} from './warmup.js';

describe('parseLeads', () => {
  it('reads one email per line', () => {
    const { leads, total } = parseLeads('a@x.com\nb@y.co\n');
    assert.equal(total, 2);
    assert.equal(leads[0].email, 'a@x.com');
  });

  it('reads Name <email>', () => {
    const { leads } = parseLeads('Jane Doe <jane@acme.com>');
    assert.equal(leads[0].email, 'jane@acme.com');
    assert.equal(leads[0].name, 'Jane Doe');
  });

  it('reads csv rows and header', () => {
    const text = `email,name,phone,company
alex@ex.com,Alex Rivera,+15550100,Northwind`;
    const { leads } = parseLeads(text);
    assert.equal(leads[0].company, 'Northwind');
    assert.equal(leads[0].phone, '+15550100');
  });

  it('dedupes emails', () => {
    const { total } = parseLeads('a@x.com\na@x.com');
    assert.equal(total, 1);
  });

  it('skips junk lines', () => {
    const { invalid, total } = parseLeads('hello world\nvalid@x.com');
    assert.equal(total, 1);
    assert.equal(invalid.length, 1);
  });
});

describe('placeholders', () => {
  it('fills and falls back', () => {
    assert.equal(renderTemplate('Hi {{first_name|there}}', { name: 'Alex Rivera' }), 'Hi Alex');
    assert.equal(renderTemplate('Hi {{first_name|there}}', {}), 'Hi there');
  });

  it('lists keys', () => {
    assert.deepEqual(listPlaceholders('{{name}} {{email}}'), ['name', 'email']);
  });

  it('expands first/last from name', () => {
    const v = expandVars({ name: 'Alex Rivera', email: 'a@x.com' });
    assert.equal(v.first_name, 'Alex');
    assert.equal(v.last_name, 'Rivera');
  });
});

describe('smtp-to-sms', () => {
  it('builds carrier addresses', () => {
    assert.equal(toSmsAddress('+1 (555) 010-0999', 'txt.att.net'), '15550100999@txt.att.net');
    assert.equal(toSmsAddress('5550100', '{number}@sms.example.com'), '5550100@sms.example.com');
    assert.equal(toSmsAddress('5550100', '@vtext.com'), '5550100@vtext.com');
  });
  it('isEmail', () => {
    assert.equal(isEmail('not-an-email'), false);
    assert.equal(isEmail('user@example.com'), true);
  });
});

describe('letters', () => {
  it('returns a catalog of original company letters', () => {
    const ids = letterCatalog().map((l) => l.id);
    assert.ok(ids.includes('invoice'));
    assert.ok(ids.includes('signature_request'));
    assert.ok(ids.includes('video_meeting'));
    assert.match(generateLetter('invoice', { company: 'Northwind Labs', amount: '$10' }).html, /You have an invoice/);
    assert.equal(generateLetter('invoice', {}, 'en', { variant: 5 }).variant, 5);
  });

  it('does not impersonate third-party brands', () => {
    const banned = /docusign|adobe sign|sharepoint|google meet|zoom\.us|microsoft 365/i;
    for (const kind of letterCatalog()) {
      const letter = generateLetter(kind.id, {
        company: 'Northwind Labs',
        document_title: 'MSA',
        sign_url: 'https://northwind.example/sign',
        invoice_number: 'INV-1',
        amount: '$10',
        pay_url: 'https://northwind.example/pay',
        file_name: 'Deck',
        file_url: 'https://northwind.example/f',
        meeting_title: 'Kickoff',
        join_url: 'https://northwind.example/meet',
      });
      assert.equal(banned.test(letter.html), false, kind.id);
      assert.match(letter.html, /Northwind Labs/);
      assert.match(letter.subject, /\S/);
    }
  });
});

describe('office365', () => {
  it('builds token and graph payloads', () => {
    assert.equal(
      tokenUrl('contoso.onmicrosoft.com'),
      'https://login.microsoftonline.com/contoso.onmicrosoft.com/oauth2/v2.0/token'
    );
    const payload = buildGraphMessage({
      from: 'a@contoso.com',
      to: 'b@ex.com',
      subject: 'Hi',
      html: '<p>Hi</p>',
      headers: { 'List-Unsubscribe': '<https://x/u/1>' },
    });
    assert.equal(payload.saveToSentItems, true);
    assert.equal(payload.message.toRecipients[0].emailAddress.address, 'b@ex.com');
    assert.equal(payload.message.internetMessageHeaders[0].name, 'List-Unsubscribe');
    const withFile = buildGraphMessage({
      from: 'a@contoso.com',
      to: 'b@ex.com',
      subject: 'Hi',
      html: '<p>Hi</p>',
      attachments: [{ filename: 'letter.html', content_type: 'text/html', content: Buffer.from('<p>Hi</p>').toString('base64') }],
    });
    assert.equal(withFile.message.attachments[0]['@odata.type'], '#microsoft.graph.fileAttachment');
    assert.equal(withFile.message.attachments[0].name, 'letter.html');
    assert.equal(OFFICE_SMTP.host, 'smtp.office365.com');
    assert.ok(GRAPH_PERMISSIONS.some((p) => p.id === 'Mail.Send' && p.required));
  });

  it('diagnoses tenant errors', () => {
    assert.match(diagnoseOfficeError('AADSTS7000215 Invalid client secret'), /secret/i);
    assert.match(diagnoseOfficeError('SmtpClientAuthenticationDisabled'), /SMTP AUTH/i);
  });
});

describe('links', () => {
  it('blocks impersonation, IPs, and private hosts', () => {
    assert.equal(staticValidate('https://microsoft-login.xyz/signin').verdict, 'block');
    assert.equal(staticValidate('https://docusign-secure.net/doc').verdict, 'block');
    assert.equal(staticValidate('https://127.0.0.1/x').verdict, 'block');
    assert.equal(staticValidate('https://8.8.8.8/x').verdict, 'block');
    assert.equal(staticValidate('https://www.office.com/').ok, true);
    assert.equal(staticValidate('https://yourcompany.com/offer').ok, true);
  });

  it('warns on public shorteners and http', () => {
    const bit = staticValidate('https://bit.ly/abc');
    assert.equal(bit.ok, true);
    assert.ok(bit.warnings.length);
    const http = staticValidate('http://yourcompany.com/a');
    assert.ok(http.score < 90);
  });

  it('classifies scanners without changing destination logic', () => {
    assert.equal(classifyClient('Mozilla/5.0').kind, 'human');
    assert.equal(classifyClient('Mozilla/5.0 (compatible; Googlebot/2.1)').kind, 'bot');
    assert.equal(classifyClient('Proofpoint URL Defense').kind, 'bot');
  });

  it('extracts urls from html', () => {
    const urls = extractUrls('<a href="https://a.example/x">x</a> https://b.example/y');
    assert.deepEqual(urls.sort(), ['https://a.example/x', 'https://b.example/y']);
  });

  it('accepts a client-owned tracking host and rejects lookalikes', () => {
    const ok = parseLinkBase('https://go.northwind.com');
    assert.equal(ok.ok, true);
    assert.equal(ok.url, 'https://go.northwind.com');
    assert.equal(parseLinkBase('go.northwind.com').url, 'https://go.northwind.com');
    assert.equal(parseLinkBase('').ok, true);
    assert.equal(parseLinkBase('').url, '');
    assert.equal(parseLinkBase('https://login-microsoft.xyz').ok, false);
    assert.equal(parseLinkBase('https://outlook.com').ok, false);
    assert.equal(parseLinkBase('https://bit.ly').ok, false);
    assert.equal(parseLinkBase('https://127.0.0.1').ok, false);
    assert.equal(parseLinkBase('https://8.8.8.8').ok, false);
    const weak = parseLinkBase('go.client.su');
    assert.equal(weak.ok, true);
    assert.ok(weak.warnings.some((w) => w.includes('.su')));
    const apex = parseLinkBase('https://northwind.com');
    assert.equal(apex.ok, true);
    assert.ok(apex.warnings.some((w) => w.includes('subdomain')));
    assert.equal(shortUrl('abc23456', { link_base_url: 'https://go.northwind.com' }), 'https://go.northwind.com/l/abc23456');
    assert.equal(linkBaseFor({}), linkBaseFor(null));
    const rec = cnameRecord('https://go.northwind.com', 'mail.freedom.test');
    assert.equal(rec.type, 'CNAME');
    assert.equal(rec.name, 'go');
    assert.equal(rec.fqdn, 'go.northwind.com');
    assert.equal(rec.value, 'mail.freedom.test');
    assert.equal(cnameRecord('northwind.com', 'mail.freedom.test').fqdn, 'go.northwind.com');
  });

  it('rejects a lookalike tracking host without doing DNS', async () => {
    const bad = await probeLinkHost('https://login-microsoft.xyz', { fetchHttps: false });
    assert.equal(bad.ok, false);
    assert.match(bad.error, /impersonation|microsoft/i);
    const blank = await probeLinkHost('', { fetchHttps: false });
    assert.equal(blank.skipped, true);
  });
});

describe('presets', () => {
  it('covers smtp, ovh, webmail, japan, smtp_sms, office365, mailgun, sendgrid, postfix, aws, gcp', () => {
    const kinds = new Set(SENDER_KINDS.map((k) => k.id));
    for (const id of ['smtp', 'ovh', 'webmail', 'japan', 'smtp_sms', 'office365', 'mailgun', 'sendgrid', 'postfix', 'aws', 'gcp']) {
      assert.ok(kinds.has(id), id);
    }
    assert.ok(SMTP_PRESETS.some((p) => p.host === 'smtp.mail.ovh.net'));
    assert.ok(SMTP_PRESETS.some((p) => p.host.includes('yahoo.co.jp')));
    assert.ok(SMTP_PRESETS.some((p) => p.host === 'smtp.office365.com'));
    assert.ok(SMTP_PRESETS.some((p) => p.host === 'smtp.mailgun.org'));
    assert.ok(SMTP_PRESETS.some((p) => p.host === 'smtp.sendgrid.net'));
    assert.ok(SMTP_PRESETS.some((p) => p.kind === 'postfix'));
    assert.ok(SMTP_PRESETS.some((p) => p.host.includes('email-smtp.')));
    assert.ok(SMTP_PRESETS.some((p) => p.id === 'gcp-relay' && p.host === 'smtp-relay.gmail.com'));
    assert.equal(SENDER_KINDS.find((k) => k.id === 'gcp').label, 'Google Cloud (us-east4)');
  });

  it('fills Mailgun / SendGrid / AWS hosts from region and mode', () => {
    const mg = applyProviderDefaults({ kind: 'mailgun', auth_mode: 'api', region: 'eu' });
    assert.equal(mg.host, 'api.eu.mailgun.net');
    assert.equal(mg.port, 443);
    const ses = applyProviderDefaults({ kind: 'aws', auth_mode: 'smtp', region: 'eu-west-1' });
    assert.equal(ses.host, awsSesSmtpHost('eu-west-1'));
    const sg = applyProviderDefaults({ kind: 'sendgrid', auth_mode: 'smtp' });
    assert.equal(sg.username, 'apikey');
    assert.equal(sg.host, 'smtp.sendgrid.net');
    const gcp = applyProviderDefaults({ kind: 'gcp' });
    assert.equal(gcp.host, 'smtp-relay.gmail.com');
    assert.equal(gcp.region, 'us-east4');
    assert.equal(gcp.port, 587);
  });
});

describe('deliverability', () => {
  it('flags syntax, disposable, role, typos', () => {
    assert.equal(inspectLocal('not-an-email').verdict, 'invalid');
    assert.equal(inspectLocal('a@mailinator.com').verdict, 'drop');
    assert.equal(inspectLocal('info@northwind.example').verdict, 'risky');
    assert.equal(inspectLocal('alex@gmial.com').suggestion, 'alex@gmail.com');
    assert.equal(inspectLocal('alex@gmail.com').verdict, 'ok');
  });

  it('sorts MX hosts to providers and ISPs', () => {
    assert.equal(classifyMx('gmail.com', ['gmail-smtp-in.l.google.com']).provider, 'gmail');
    assert.equal(classifyMx('acme.com', ['aspmx.l.google.com']).provider, 'google_workspace');
    assert.equal(classifyMx('acme.com', ['acme-com.mail.protection.outlook.com']).provider, 'microsoft365');
    assert.equal(classifyMx('comcast.net', ['mx1.comcast.net']).kind, 'isp');
    assert.equal(classifyMx('ghost.invalid', []).provider, 'no_mx');
  });

  it('debounces a paste and groups by provider', async () => {
    const lookup = async (domain) => {
      if (domain === 'gmail.com') return { mx: ['gmail-smtp-in.l.google.com'], error: '' };
      if (domain === 'contoso.com') return { mx: ['contoso-com.mail.protection.outlook.com'], error: '' };
      if (domain === 'no-mx.test') return { mx: [], error: 'no_mx' };
      return { mx: ['mx.example.com'], error: '' };
    };
    const out = await debounceEmails(
      'a@gmail.com\nb@contoso.com\nbad\nc@no-mx.test\na@gmail.com',
      { lookup }
    );
    assert.equal(out.summary.total, 3);
    assert.ok(out.groups.some((g) => g.id === 'gmail'));
    assert.ok(out.groups.some((g) => g.id === 'microsoft365'));
    assert.equal(out.results.find((r) => r.email === 'c@no-mx.test').verdict, 'undeliverable');
    assert.equal(out.results.find((r) => r.email === 'a@gmail.com').deliverable, true);
    assert.equal(out.summary.deliverable, 2);
  });

  it('marks each address from MX: live, null MX, dead host, timeout', async () => {
    const { applyMxToLocal, inspectLocal, inspectMailDomain, isRoutableIp } = await import('./deliverability.js');
    assert.equal(isRoutableIp('8.8.8.8'), true);
    assert.equal(isRoutableIp('127.0.0.1'), false);
    assert.equal(isRoutableIp('10.0.0.4'), false);

    const gmail = applyMxToLocal(inspectLocal('alex@gmail.com'), {
      mx: ['gmail-smtp-in.l.google.com'],
      deliverable: true,
      mx_live: true,
      smtp: { ok: true, banner: '220 mx.google.com ESMTP' },
    });
    assert.equal(gmail.verdict, 'ok');
    assert.equal(gmail.deliverable, true);
    assert.equal(gmail.mx_live, true);

    const nullMx = applyMxToLocal(inspectLocal('x@refuses.example'), { mx: [], null_mx: true, deliverable: false });
    assert.equal(nullMx.verdict, 'undeliverable');
    assert.equal(nullMx.keep, false);

    const dead = applyMxToLocal(inspectLocal('x@ghost.example'), { mx: ['mx.ghost.example'], error: 'mx_host_dead', deliverable: false });
    assert.equal(dead.verdict, 'undeliverable');

    const timed = applyMxToLocal(inspectLocal('x@slow.example'), { mx: [], error: 'MX timeout', deliverable: false });
    assert.equal(timed.verdict, 'unknown');

    const live = await inspectMailDomain('acme.com', {
      lookupMxFn: async () => ({
        mx: ['mx.acme.com'],
        records: [{ exchange: 'mx.acme.com', priority: 10 }],
        null_mx: false,
        error: '',
      }),
      lookupIpsFn: async () => ['203.0.113.10'],
      probeFn: async () => ({ ok: true, banner: '220 mx.acme.com ESMTP', host: 'mx.acme.com', port: 25 }),
    });
    assert.equal(live.deliverable, true);
    assert.equal(live.mx_live, true);

    const implicit = await inspectMailDomain('legacy.example', {
      lookupMxFn: async () => ({ mx: [], records: [], null_mx: false, error: 'no_mx' }),
      lookupIpsFn: async () => ['198.51.100.8'],
      probeFn: async () => ({ ok: false, error: 'timeout', host: 'legacy.example', port: 25 }),
    });
    assert.equal(implicit.implicit, true);
    assert.equal(implicit.deliverable, true);
  });
});

describe('providers', () => {
  it('builds Mailgun form fields including custom headers', () => {
    const form = buildMailgunForm({
      from: 'Northwind <hello@mg.northwind.example>',
      to: 'a@x.com',
      subject: 'Hi',
      html: '<p>Hi</p>',
      text: 'Hi',
      headers: { 'List-Unsubscribe': '<https://x/u/1>' },
    });
    assert.equal(form.get('from'), 'Northwind <hello@mg.northwind.example>');
    assert.equal(form.get('to'), 'a@x.com');
    assert.equal(form.get('h:List-Unsubscribe'), '<https://x/u/1>');
    assert.equal(mailgunDomain({ username: 'postmaster@mg.northwind.example' }), 'mg.northwind.example');
    assert.equal(mailgunApiBase({ region: 'eu' }), 'https://api.eu.mailgun.net');
  });

  it('builds SendGrid v3 payload', () => {
    const payload = buildSendGridPayload({
      fromName: 'Northwind',
      fromEmail: 'hello@northwind.example',
      to: 'a@x.com',
      subject: 'Hi',
      html: '<p>Hi</p>',
      text: 'Hi',
      headers: { 'List-Unsubscribe': '<https://x/u/1>' },
    });
    assert.equal(payload.from.email, 'hello@northwind.example');
    assert.equal(payload.personalizations[0].to[0].email, 'a@x.com');
    assert.equal(payload.content[1].type, 'text/html');
    assert.equal(payload.headers['List-Unsubscribe'], '<https://x/u/1>');
    const withFile = buildSendGridPayload({
      fromName: 'Northwind',
      fromEmail: 'hello@northwind.example',
      to: 'a@x.com',
      subject: 'Hi',
      html: '<p>Hi</p>',
      attachments: [{ filename: 'letter.html', content_type: 'text/html', content: 'PHA+SGk8L3A+' }],
    });
    assert.equal(withFile.attachments[0].filename, 'letter.html');
    assert.equal(withFile.attachments[0].disposition, 'attachment');
  });

  it('builds SES v2 payload with headers', () => {
    const payload = buildSesPayload({
      from: '"Northwind" <hello@northwind.example>',
      to: 'a@x.com',
      subject: 'Hi',
      html: '<p>Hi</p>',
      headers: { 'List-Unsubscribe': '<https://x/u/1>', 'Reply-To': 'support@northwind.example' },
    });
    assert.equal(payload.FromEmailAddress, '"Northwind" <hello@northwind.example>');
    assert.deepEqual(payload.ReplyToAddresses, ['support@northwind.example']);
    assert.equal(payload.Content.Simple.Headers[0].Name, 'List-Unsubscribe');
    assert.ok(!payload.EmailTags);
    assert.throws(
      () => buildSesPayload({ from: 'a@x.com', to: 'b@x.com', subject: 'Hi', attachments: [{ filename: 'a.html' }] }),
      /attachments/i
    );
  });

  it('builds Mailgun multipart when files are present', () => {
    const form = buildMailgunMultipart({
      from: 'Northwind <hello@mg.northwind.example>',
      to: 'a@x.com',
      subject: 'Hi',
      html: '<p>Hi</p>',
      attachments: [{ filename: 'letter.html', content_type: 'text/html', content: Buffer.from('<p>Hi</p>').toString('base64') }],
    });
    assert.equal(typeof form.get, 'function');
    assert.equal(form.get('from'), 'Northwind <hello@mg.northwind.example>');
    assert.ok(form.get('attachment'));
  });

  it('signs AWS SigV4 GET like the IAM ListUsers example', () => {
    const signed = signAwsV4({
      method: 'GET',
      url: 'https://iam.amazonaws.com/?Action=ListUsers&Version=2010-05-08',
      body: '',
      region: 'us-east-1',
      service: 'iam',
      accessKeyId: 'AKIDEXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
      amzDate: '20150830T123600Z',
      extraHeaders: { 'content-type': 'application/x-www-form-urlencoded; charset=utf-8' },
    });
    assert.match(signed.canonicalRequest, /^GET\n\/\nAction=ListUsers&Version=2010-05-08\n/);
    assert.match(signed.canonicalRequest, /content-type;host;x-amz-date/);
    assert.equal(signed.signature, '5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7');
  });

  it('routes HTTP API kinds', () => {
    assert.equal(usesHttpApi({ kind: 'mailgun', auth_mode: 'api' }), true);
    assert.equal(usesHttpApi({ kind: 'mailgun', auth_mode: 'smtp' }), false);
    assert.equal(usesHttpApi({ kind: 'postfix' }), false);
    assert.equal(usesHttpApi({ kind: 'aws', auth_mode: 'api' }), true);
  });
});

describe('features', () => {
  it('defaults every client tool on, and honors explicit off', async () => {
    const { parseFeatures, hasFeature } = await import('./features.js');
    const all = parseFeatures('');
    assert.equal(all.compose, true);
    assert.equal(all.office365, true);
    assert.equal(all.warmup, true);
    assert.equal(all.vnc, true);
    const off = parseFeatures('{"compose":false,"ai":false}');
    assert.equal(off.compose, false);
    assert.equal(off.ai, false);
    assert.equal(off.senders, true);
    assert.equal(hasFeature({ role: 'admin', features: '{"compose":false}' }, 'compose'), true);
    assert.equal(hasFeature({ role: 'user', features: '{"compose":false}' }, 'compose'), false);
  });

  it('applies tool presets', async () => {
    const { applyPreset } = await import('./features.js');
    const mailer = applyPreset('mailer');
    assert.equal(mailer.compose, true);
    assert.equal(mailer.senders, true);
    assert.equal(mailer.warmup, true);
    assert.equal(mailer.vnc, true);
    assert.equal(mailer.campaigns, false);
    assert.equal(mailer.apikeys, false);
    const lock = applyPreset('lockdown');
    assert.equal(lock.compose, false);
    assert.equal(applyPreset('nope'), null);
  });
});

describe('license', () => {
  it('computes 3-day, monthly, and lifetime expiry', () => {
    const from = new Date('2026-08-15T00:00:00.000Z');
    const d3 = computeExpiry('3day', from);
    assert.equal(d3.expires_at, '2026-08-18T00:00:00.000Z');
    const mo = computeExpiry('monthly', from);
    assert.equal(mo.expires_at, '2026-09-14T00:00:00.000Z');
    assert.equal(computeExpiry('lifetime', from).expires_at, null);
    assert.ok(computeExpiry('nope').error);
  });

  it('extends from remaining time, or from now if expired', () => {
    const now = new Date('2026-08-15T00:00:00.000Z');
    const ext = extendExpiry('3day', '2026-08-16T00:00:00.000Z', now);
    assert.equal(ext.expires_at, '2026-08-19T00:00:00.000Z');
    const fromExpired = extendExpiry('monthly', '2026-08-01T00:00:00.000Z', now);
    assert.equal(fromExpired.expires_at, '2026-09-14T00:00:00.000Z');
  });

  it('admins and lifetime stay active; expired 3-day does not', () => {
    const now = new Date('2026-08-15T12:00:00.000Z');
    assert.equal(licenseStatus({ role: 'admin', license_plan: '3day' }, now).ok, true);
    assert.equal(licenseStatus({ role: 'user', license_plan: 'lifetime', active: 1 }, now).ok, true);
    assert.equal(
      licenseStatus(
        { role: 'user', license_plan: '3day', license_expires_at: '2026-08-14T00:00:00.000Z', active: 1 },
        now
      ).reason,
      'expired'
    );
    assert.equal(
      licenseStatus(
        { role: 'user', license_plan: 'monthly', license_expires_at: '2026-09-01T00:00:00.000Z', active: 1 },
        now
      ).ok,
      true
    );
  });
});

describe('warmup', () => {
  it('ramps volume and caps', () => {
    assert.equal(dailyTarget({ start_per_day: 5, increase_per_day: 3, max_per_day: 40, progress_days: 0 }), 5);
    assert.equal(dailyTarget({ start_per_day: 5, increase_per_day: 3, max_per_day: 40, progress_days: 5 }), 20);
    assert.equal(dailyTarget({ start_per_day: 5, increase_per_day: 3, max_per_day: 40, progress_days: 20 }), 40);
    assert.equal(dailyTarget({ start_per_day: 20, increase_per_day: 10, max_per_day: 100, progress_days: 8 }), 100);
    assert.equal(warmupPreset('gentle').start_per_day, 3);
    assert.equal(warmupPreset('high').max_per_day, 100);
    assert.equal(warmupPreset('nope').id, 'standard');
    assert.equal(validRamp(20, 10, 100), true);
    assert.equal(validRamp(20, 10, 101), false);
    assert.equal(perSeedCap(100, 5), 20);
    assert.equal(perSeedCap(100, 10), 10);
    assert.equal(replySubject('Quick check-in'), 'Re: Quick check-in');
    assert.equal(replySubject('Re: Quick check-in'), 'Re: Quick check-in');
    assert.equal(queueAutoReply({ source: 'warmup_reply', warmup_plan_id: 1 }).skipped, 'not-warmup');
  });

  it('pauses on a real bounce cluster, not a single fail', () => {
    assert.equal(bounceShouldPause({ sent: 10, failed: 1 }), false);
    assert.equal(bounceShouldPause({ sent: 10, failed: 3 }), true);
    assert.equal(bounceShouldPause({ sent: 0, failed: 2 }), false);
  });

  it('spreads sends and parses owned seeds', () => {
    const now = new Date('2026-08-15T12:00:00.000Z');
    const times = spreadTimes(3, now);
    assert.equal(times.length, 3);
    assert.ok(times[0] < times[1]);
    assert.equal(spreadTimes(0).length, 0);
    const parsed = parseSeeds('Alex <alex@northwind.com>\nalex@northwind.com\nbad line');
    assert.equal(parsed.total, 1);
    assert.equal(parsed.seeds[0].email, 'alex@northwind.com');
  });

  it('renders a short note with no tracking link', () => {
    const note = pickNote(1, 2, 3);
    assert.ok(WARMUP_NOTES.includes(note));
    const rendered = renderNote(note, { email: 'alex@northwind.com', name: 'Alex' });
    assert.ok(rendered.subject);
    assert.ok(rendered.text.includes('Alex') || rendered.subject.includes('Alex') || rendered.text.length > 10);
    assert.equal(/https?:\/\//i.test(rendered.text), false);
    assert.equal(/unsubscribe|docusign|microsoft|adobe/i.test(rendered.text), false);
  });
});

describe('vnc', () => {
  it('parses host, host:port, and rejects junk', async () => {
    const { parseTarget, publicTarget, wsPath, DEFAULT_PORT } = await import('./vnc.js');
    const a = parseTarget({ host: 'desk.northwind.example', owned_ok: true });
    assert.equal(a.host, 'desk.northwind.example');
    assert.equal(a.port, DEFAULT_PORT);
    assert.equal(a.view_only, false);
    const b = parseTarget({ host: '10.0.0.8:5901', label: 'Shop PC', view_only: true });
    assert.equal(b.host, '10.0.0.8');
    assert.equal(b.port, 5901);
    assert.equal(b.label, 'Shop PC');
    assert.equal(b.view_only, true);
    assert.match(parseTarget({ host: '' }).error, /host/i);
    assert.match(parseTarget({ host: 'user@10.0.0.8' }).error, /username/i);
    assert.match(parseTarget({ host: 'desk.example', port: 0 }).error, /port/i);
    assert.match(parseTarget({ host: '999.1.1.1' }).error, /IPv4/i);
    const pub = publicTarget({ id: 3, label: 'A', host: '127.0.0.1', port: 5900, password: 'secret', view_only: 0 });
    assert.equal(pub.has_password, true);
    assert.equal(pub.password, undefined);
    assert.equal(wsPath(3), '/api/vnc/ws/3');
  });
});

describe('spamcheck', () => {
  it('allows a normal invoice letter', () => {
    const report = analyzeContent({
      subject: 'Invoice 1042 for Northwind',
      html: '<p>Hi Alex, your invoice is ready. <a href="https://northwind.example/pay">Pay invoice</a></p>',
      text: 'Hi Alex, your invoice is ready.',
    });
    assert.equal(report.verdict, 'ok');
    assert.equal(report.can_send, true);
    assert.equal(sendBlockError(report), null);
  });

  it('blocks credential-harvest and prize-claim copy', () => {
    const cred = analyzeContent({
      subject: 'Verify your Microsoft account',
      html: '<p>Confirm your password to keep access.</p>',
    });
    assert.equal(cred.verdict, 'block');
    assert.ok(sendBlockError(cred));

    const prize = analyzeContent({
      subject: 'You have been selected as winner',
      html: '<p>Claim your prize today.</p>',
    });
    assert.equal(prize.verdict, 'block');
  });

  it('flags junk phrases and can scrub them', () => {
    const report = analyzeContent({
      subject: 'ACT NOW!!!',
      html: '<p>Click here for a limited time offer. This is not spam.</p>',
    });
    assert.equal(report.verdict, 'risky');
    assert.ok(report.hits.some((h) => h.id === 'click-here'));
    const scrubbed = scrubContent({
      subject: 'ACT NOW!!!',
      html: '<p>Click here for a limited time offer. This is not spam.</p>',
      text: 'Click here',
    });
    assert.equal(/click here/i.test(scrubbed.html), false);
    assert.equal(/act now/i.test(scrubbed.subject), false);
    assert.ok(scrubbed.replaced.length >= 1);
    assert.equal(scrubbed.report.verdict === 'block', false);
  });

  it('flags scripts, public shorteners, and attached HTML', () => {
    const report = analyzeContent({
      subject: 'Files',
      html: '<p>See <a href="https://bit.ly/abc">link</a></p><script>alert(1)</script>',
      attachment_html: ['<p>Verify your Microsoft account now</p>'],
    });
    assert.equal(report.verdict, 'block');
    assert.ok(report.hits.some((h) => h.id === 'public-shortener'));
    assert.ok(report.hits.some((h) => h.id === 'html-script'));
  });
});

describe('attachments', () => {
  it('accepts a sanitized HTML file and rejects executables', () => {
    const html = makeHtmlAttachment('letter.html', '<p>Hi</p><script>alert(1)</script>');
    assert.equal(html.content_type, 'text/html');
    assert.equal(/script/i.test(Buffer.from(html.content, 'base64').toString('utf8')), false);
    assert.match(sanitizeHtmlAttachment('<img src=x onerror=alert(1)>'), /<img src=x>/i);

    const bad = normalizeAttachments([{ filename: 'payload.exe', content: Buffer.from('MZ').toString('base64') }]);
    assert.match(bad.error, /exe/i);

    const ok = normalizeAttachments([], { attachHtml: true, html: '<p>Invoice</p>', htmlName: 'invoice' });
    assert.equal(ok.attachments[0].filename, 'invoice.html');
    assert.equal(toSendGridAttachments(ok.attachments)[0].disposition, 'attachment');
    assert.equal(toGraphAttachments(ok.attachments)[0].name, 'invoice.html');
    assert.ok(Buffer.isBuffer(toNodemailerAttachments(ok.attachments)[0].content));
  });

  it('rejects oversize and unknown types', () => {
    const huge = Buffer.alloc(401 * 1024, 97).toString('base64');
    const over = normalizeAttachments([{ filename: 'big.txt', content: huge }]);
    assert.match(over.error, /400 KB/i);
    const zip = normalizeAttachments([{ filename: 'pack.zip', content: Buffer.from('PK').toString('base64') }]);
    assert.match(zip.error, /zip/i);
  });
});
