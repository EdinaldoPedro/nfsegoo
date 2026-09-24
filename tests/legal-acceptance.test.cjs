const { test } = require('node:test');
const assert = require('node:assert/strict');
const { privacyVersion, termsVersion } = require('../app/legal-content.ts');
const { parseLegalAcceptanceInput } = require('../app/services/legalAcceptanceService.ts');

test('reaceite exige confirmação explícita, senha e versões exatamente vigentes', () => {
  const valid = { accepted: true, termsVersion, privacyVersion, password: 'senha-atual' };
  assert.equal(parseLegalAcceptanceInput(valid).termsVersion, termsVersion);
  assert.throws(() => parseLegalAcceptanceInput({ ...valid, accepted: false }), /atualizados/);
  assert.throws(() => parseLegalAcceptanceInput({ ...valid, termsVersion: 'antiga' }), /atualizados/);
  assert.throws(() => parseLegalAcceptanceInput({ ...valid, password: '' }), /senha/);
  assert.throws(() => parseLegalAcceptanceInput({ ...valid, role: 'MASTER' }), /não permitidos/);
});
