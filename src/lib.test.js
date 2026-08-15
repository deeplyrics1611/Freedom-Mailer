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
import { staticValidate, classifyClient, extractUrls } from './links.js';
import { inspectLocal, classifyMx, debounceEmails } from './deliverability.js';
import {
  buildMailgunForm,
  buildSendGridPayload,
  buildSesPayload,
  signAwsV4,
  mailgunDomain,
  mailgunApiBase,
  usesHttpApi,
} from './providers.js';
import { computeExpiry, extendExpiry, licenseStatus } from './license.js';

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
});

describe('presets', () => {
  it('covers smtp, ovh, webmail, japan, smtp_sms, office365, mailgun, sendgrid, postfix, aws', () => {
    const kinds = new Set(SENDER_KINDS.map((k) => k.id));
    for (const id of ['smtp', 'ovh', 'webmail', 'japan', 'smtp_sms', 'office365', 'mailgun', 'sendgrid', 'postfix', 'aws']) {
      assert.ok(kinds.has(id), id);
    }
    assert.ok(SMTP_PRESETS.some((p) => p.host === 'smtp.mail.ovh.net'));
    assert.ok(SMTP_PRESETS.some((p) => p.host.includes('yahoo.co.jp')));
    assert.ok(SMTP_PRESETS.some((p) => p.host === 'smtp.office365.com'));
    assert.ok(SMTP_PRESETS.some((p) => p.host === 'smtp.mailgun.org'));
    assert.ok(SMTP_PRESETS.some((p) => p.host === 'smtp.sendgrid.net'));
    assert.ok(SMTP_PRESETS.some((p) => p.kind === 'postfix'));
    assert.ok(SMTP_PRESETS.some((p) => p.host.includes('email-smtp.')));
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
