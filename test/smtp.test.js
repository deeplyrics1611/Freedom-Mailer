import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SMTP_CATALOG, smtpById, socks5Url } from '../src/smtpCatalog.js';
import { parseSmtpPaste, inferFromDomain, extractSmtp } from '../src/smtpExtract.js';

describe('SMTP catalog', () => {
  it('includes SES Japan, SendGrid, and Mailchimp', () => {
    const ids = SMTP_CATALOG.map((p) => p.id);
    assert.ok(ids.includes('ses-ap-northeast-1'));
    assert.ok(ids.includes('sendgrid'));
    assert.ok(ids.includes('mailchimp'));
    assert.ok(ids.includes('muumuu'));
    assert.ok(ids.includes('office365'));
    assert.equal(smtpById('sendgrid').host, 'smtp.sendgrid.net');
    assert.equal(smtpById('ses-ap-northeast-1').region, 'ap-northeast-1');
    assert.equal(smtpById('muumuu').group, 'japan');
  });

  it('builds SOCKS5 URLs and rejects junk hosts', () => {
    assert.equal(
      socks5Url({ host: '10.0.0.5', port: 1080, user: 'u', pass: 'p@ss' }),
      'socks5://u:p%40ss@10.0.0.5:1080'
    );
    assert.equal(socks5Url({ host: '' }), '');
    assert.throws(() => socks5Url({ host: 'bad host' }), /Invalid SOCKS5 host/);
  });
});

describe('SMTP extract', () => {
  it('parses a control-panel dump and smtp:// URI', () => {
    const pasted = parseSmtpPaste(`
SMTP host: smtp.sakura.ne.jp
Port: 587
Username: quotes@shop.jp
Password: s3cret
SOCKS5: 203.0.113.9:1080
`);
    assert.equal(pasted.host, 'smtp.sakura.ne.jp');
    assert.equal(pasted.port, '587');
    assert.equal(pasted.username, 'quotes@shop.jp');
    assert.equal(pasted.password, 's3cret');
    assert.equal(pasted.from_email, 'quotes@shop.jp');

    const uri = parseSmtpPaste('smtp://apikey:SG.xxx@smtp.sendgrid.net:587');
    assert.equal(uri.host, 'smtp.sendgrid.net');
    assert.equal(uri.username, 'apikey');
    assert.equal(uri.password, 'SG.xxx');
    assert.equal(uri.port, '587');
  });

  it('infers Japan and Gmail hosts from a domain', () => {
    assert.equal(inferFromDomain('sakura.ne.jp').catalog_id, 'sakura');
    assert.equal(inferFromDomain('gmail.com').host, 'smtp.gmail.com');
    assert.equal(inferFromDomain('sv123.xserver.jp').host, 'sv123.xserver.jp');
  });

  it('extracts without MX and fills a SendGrid paste', async () => {
    const r = await extractSmtp('smtp://apikey:SG.key@smtp.sendgrid.net:587', { lookupMx: false });
    assert.equal(r.catalog_id, 'sendgrid');
    assert.equal(r.host, 'smtp.sendgrid.net');
    assert.equal(r.username, 'apikey');
    assert.equal(r.password, 'SG.key');
    assert.equal(r.port, 587);
  });
});
