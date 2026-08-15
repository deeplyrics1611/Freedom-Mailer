import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseLeads, toSmsAddress, isEmail } from './leads.js';
import { renderTemplate, expandVars, listPlaceholders } from './placeholders.js';
import { generateLetter, letterCatalog } from './letters.js';
import { SMTP_PRESETS, SENDER_KINDS } from './presets.js';
import {
  tokenUrl,
  buildGraphMessage,
  diagnoseOfficeError,
  OFFICE_SMTP,
  GRAPH_PERMISSIONS,
} from './office365.js';
import { staticValidate, classifyClient, extractUrls } from './links.js';
import { inspectLocal, classifyMx, debounceEmails } from './deliverability.js';

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
  it('covers smtp, ovh, webmail, japan, smtp_sms, office365', () => {
    const kinds = new Set(SENDER_KINDS.map((k) => k.id));
    for (const id of ['smtp', 'ovh', 'webmail', 'japan', 'smtp_sms', 'office365']) assert.ok(kinds.has(id));
    assert.ok(SMTP_PRESETS.some((p) => p.host === 'smtp.mail.ovh.net'));
    assert.ok(SMTP_PRESETS.some((p) => p.host.includes('yahoo.co.jp')));
    assert.ok(SMTP_PRESETS.some((p) => p.host === 'smtp.office365.com'));
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
    assert.ok(out.results.find((r) => r.email === 'c@no-mx.test').verdict === 'drop');
  });
});
