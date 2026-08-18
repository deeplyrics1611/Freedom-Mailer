import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizePhone,
  smsSegments,
  withSmsOptOut,
  buildSmsRequest,
  providerList,
} from '../src/sms.js';

describe('SMS helpers', () => {
  it('lists Twilio and other gateways', () => {
    const ids = providerList().map((p) => p.id);
    assert.ok(ids.includes('twilio'));
    assert.ok(ids.includes('vonage'));
    assert.ok(ids.includes('telnyx'));
    assert.ok(ids.includes('plivo'));
  });

  it('normalizes numbers to E.164', () => {
    assert.equal(normalizePhone('+1 (555) 123-4567'), '+15551234567');
    assert.equal(normalizePhone('5551234567'), '+15551234567');
    assert.equal(normalizePhone('15551234567'), '+15551234567');
    assert.equal(normalizePhone(''), '');
  });

  it('counts GSM vs Unicode segments', () => {
    const gsm = smsSegments('Hi Alex, please quote 2500 housings.');
    assert.equal(gsm.unicode, false);
    assert.equal(gsm.segments, 1);
    const uni = smsSegments('你好');
    assert.equal(uni.unicode, true);
  });

  it('appends STOP once', () => {
    const a = withSmsOptOut('Hello there, requesting a quote.');
    assert.match(a, /STOP/);
    assert.equal(withSmsOptOut(a), a);
  });

  it('builds a Twilio Messages API request from SID + token', () => {
    const req = buildSmsRequest({
      provider: 'twilio',
      api_key: 'ACaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      api_secret: 'token',
      from_number: '+15550001111',
      extra_json: '{}',
    }, '5551234567', 'Quote request');
    assert.equal(req.url, 'https://api.twilio.com/2010-04-01/Accounts/ACaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/Messages.json');
    assert.match(req.headers.Authorization, /^Basic /);
    assert.match(req.body, /To=%2B15551234567/);
    assert.match(req.body, /From=%2B15550001111/);
    assert.match(req.body, /Body=Quote/);
  });

  it('rejects private custom webhook hosts', () => {
    assert.throws(() => buildSmsRequest({
      provider: 'custom_http',
      extra_json: JSON.stringify({ base_url: 'https://127.0.0.1/send' }),
    }, '+15551234567', 'hi'), /Local hosts/);
  });
});
