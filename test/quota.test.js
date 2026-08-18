import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { maskSecret, pickUsage } from '../src/quota.js';

describe('quota helpers', () => {
  it('masks API keys / Account SIDs', () => {
    assert.equal(maskSecret('ACaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa').startsWith('ACaa'), true);
    assert.match(maskSecret('ACaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'), /…aaaa$/);
    assert.equal(maskSecret('short'), '••••');
    assert.equal(maskSecret(''), '');
  });

  it('picks Twilio usage records by category', () => {
    const payload = {
      usage_records: [
        { category: 'calls', count: '3', price: '0.10' },
        { category: 'sms', count: '42', price: '1.25', usage: '42' },
      ],
    };
    const sms = pickUsage(payload, 'sms');
    assert.equal(sms.count, 42);
    assert.equal(sms.price, '1.25');
    assert.equal(pickUsage({ usage_records: [] }, 'sms').count, 0);
  });
});
