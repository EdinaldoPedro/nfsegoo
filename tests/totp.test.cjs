const { test } = require('node:test');
const assert = require('node:assert/strict');
const { encodeBase32, decodeBase32, totpAtStep, matchingTotpStep, createRecoveryCodes, recoveryCodeHash } = require('../app/utils/totp.ts');

test('TOTP corresponde aos seis vetores SHA1 da RFC 6238 (inclusive apos 2038)', () => {
  const secret = encodeBase32(Buffer.from('12345678901234567890'));
  const vectors = [[59, '94287082'], [1111111109, '07081804'], [1111111111, '14050471'], [1234567890, '89005924'], [2000000000, '69279037'], [20000000000, '65353130']];
  for (const [time, expected] of vectors) assert.equal(totpAtStep(secret, Math.floor(time / 30), 8), expected);
});

test('Base32 faz roundtrip e rejeita caracteres fora do alfabeto', () => {
  const bytes = Buffer.from('teste de codificacao TOTP');
  assert.deepEqual(decodeBase32(encodeBase32(bytes)), bytes);
  assert.throws(() => decodeBase32('INVALID0!'));
});

test('TOTP aceita somente janela curta e rejeita passo ja consumido', () => {
  const secret = encodeBase32(Buffer.from('12345678901234567890'));
  const step = 12345;
  const now = step * 30 * 1000;
  assert.equal(matchingTotpStep(secret, totpAtStep(secret, step), now), step);
  assert.equal(matchingTotpStep(secret, totpAtStep(secret, step - 1), now), step - 1);
  assert.equal(matchingTotpStep(secret, totpAtStep(secret, step + 1), now), step + 1);
  assert.equal(matchingTotpStep(secret, totpAtStep(secret, step - 2), now), null);
  assert.equal(matchingTotpStep(secret, totpAtStep(secret, step), now, step), null);
  assert.equal(matchingTotpStep(secret, '12345', now), null);
});

test('Codigos de recuperacao sao unicos, de alta entropia e armazenados como hashes', () => {
  const { codes, hashes } = createRecoveryCodes();
  assert.equal(codes.length, 10);
  assert.equal(new Set(codes).size, 10);
  for (let index = 0; index < codes.length; index++) {
    assert.match(codes[index], /^[A-F0-9]{8}(?:-[A-F0-9]{8}){3}$/);
    assert.match(hashes[index], /^[a-f0-9]{64}$/);
    assert.equal(recoveryCodeHash(codes[index].toLowerCase().replaceAll('-', ' ')), hashes[index]);
  }
});
