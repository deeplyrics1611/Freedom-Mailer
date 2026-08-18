import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { renderTemplate, contactVars, extractPlaceholders } from '../src/placeholders.js';
import { checkSpam } from '../src/spamcheck.js';
import { classifyUrl, extractUrls } from '../src/linkcheck.js';
import { syntaxOk, parseEmailList, parseContactCsv, parseEmail } from '../src/validate.js';
import { encryptSecret, decryptSecret, normalizeAppPassword, looksLikeGmailAppPassword } from '../src/secrets.js';
import { RFQ_TEMPLATES } from '../src/rfqTemplates.js';

describe('placeholders', () => {
  it('merges contact fields and extra RFQ vars', () => {
    const vars = contactVars(
      { email: 'a@b.com', first_name: 'Sam', company: 'Acme' },
      { rfq_item: 'widgets', sender_name: 'Jo' }
    );
    const out = renderTemplate('Hi {{first_name}} at {{company}} re {{rfq_item}} from {{sender_name}} ({{email}})', vars);
    assert.equal(out, 'Hi Sam at Acme re widgets from Jo (a@b.com)');
  });

  it('extracts placeholder keys', () => {
    assert.deepEqual(extractPlaceholders('{{first_name}} {{company}}').sort(), ['company', 'first_name']);
  });
});

describe('spam check', () => {
  it('passes a normal RFQ', () => {
    const r = checkSpam({
      subject: 'Request for quote — aluminum housings',
      html: '<p>Hi {{first_name}}, please quote 2500 units of housings. Reply to this email.</p>',
      text: 'Hi {{first_name}}, please quote 2500 units of housings. Reply to this email.',
    });
    assert.equal(r.verdict, 'pass');
  });

  it('fails ALL CAPS + shortener + javascript', () => {
    const r = checkSpam({
      subject: 'FREE WINNER!!! CLICK NOW',
      html: '<script></script><a href="https://bit.ly/abc">click here</a>',
    });
    assert.equal(r.verdict, 'fail');
    assert.ok(r.score >= 5);
  });
});

describe('link check', () => {
  it('flags shorteners and extracts hrefs', () => {
    const html = '<p><a href="https://bit.ly/x">x</a> and <a href="https://acme.com/rfq">acme</a></p>';
    const urls = extractUrls(html);
    assert.ok(urls.includes('https://bit.ly/x'));
    const bad = classifyUrl('https://bit.ly/x');
    assert.equal(bad.verdict, 'bad');
    const good = classifyUrl('https://acme.com/pricing');
    assert.equal(good.verdict, 'good');
  });
});

describe('validation helpers', () => {
  it('syntax and list parsing', () => {
    assert.equal(syntaxOk('alex@acme.com'), true);
    assert.equal(syntaxOk('not-an-email'), false);
    assert.deepEqual(parseEmail('Alex@Acme.com').domain, 'acme.com');
    const list = parseEmailList('hello\nalex@acme.com\ninfo@vendor.org');
    assert.ok(list.includes('alex@acme.com'));
  });

  it('parses contact CSV', () => {
    const rows = parseContactCsv('email,first_name,company\na@b.com,Ann,Acme\n');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].first_name, 'Ann');
    assert.equal(rows[0].company, 'Acme');
  });
});

describe('secrets', () => {
  it('round-trips app passwords and strips spaces', () => {
    const pw = 'abcd efgh ijkl mnop';
    assert.equal(normalizeAppPassword(pw).length, 16);
    assert.equal(looksLikeGmailAppPassword(pw), true);
    const enc = encryptSecret(normalizeAppPassword(pw));
    assert.match(enc, /^enc:/);
    assert.equal(decryptSecret(enc), 'abcdefghijklmnop');
    assert.equal(decryptSecret('legacy-plain'), 'legacy-plain');
  });
});

describe('RFQ templates', () => {
  it('ships three RFQ starters with placeholders', () => {
    assert.equal(RFQ_TEMPLATES.length, 3);
    assert.ok(RFQ_TEMPLATES.every((t) => t.subject.includes('{{')));
  });
});
