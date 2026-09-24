const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fiscalCnpj, isDpsId, isNfseAccessKey, isNfseId, normalizeNfseAccessKey } = require('../app/utils/fiscal-identifiers.ts');

test('identificadores fiscais preservam CNPJ alfanumerico e exigem comprimentos oficiais', () => {
  const cnpj = '12ABC34501DE35';
  const key = `123456${cnpj}${'7'.repeat(30)}`;
  const dps = `DPS35503082${cnpj}00900${'1'.padStart(15, '0')}`;
  assert.equal(fiscalCnpj(cnpj.toLowerCase()), cnpj);
  assert.equal(normalizeNfseAccessKey(key.toLowerCase()), key);
  assert.equal(isNfseAccessKey(key), true);
  assert.equal(isNfseId(`NFS${key}`), true);
  assert.equal(isDpsId(dps), true);
  for (const invalid of [key.slice(1), `${key}0`, key.replace(cnpj, '12-BC34501DE35'), `12345A${cnpj}${'7'.repeat(30)}`]) {
    assert.equal(isNfseAccessKey(invalid), false);
  }
});

test('identificadores fiscais nunca fabricam documento removendo caracteres', () => {
  assert.equal(fiscalCnpj('12-ABC34501DE35'), '');
  assert.equal(isDpsId('DPS3550308212-BC34501DE350090000000000000001'), false);
});
