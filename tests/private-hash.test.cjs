const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');

test('fingerprint privado é determinístico, separado por escopo e não é digest público', () => {
  const previousKey = process.env.ENCRYPTION_KEY;
  process.env.ENCRYPTION_KEY = 'qa-private-hash-key-32-bytes-000';
  const { privateHash } = require('../app/utils/private-hash.ts');
  const value = 'titular@example.invalid';
  try {
    const first = privateHash('email-audit', value);
    assert.match(first, /^[a-f0-9]{64}$/);
    assert.equal(privateHash('email-audit', value), first);
    assert.notEqual(privateHash('rate-limit', value), first);
    assert.notEqual(first, createHash('sha256').update(value).digest('hex'));
    assert.equal(first.includes(value), false);
  } finally {
    if (previousKey === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = previousKey;
  }
});
