import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SMTP_CATALOG, smtpById, socks5Url } from '../src/smtpCatalog.js';

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
