const { test } = require('node:test');
const assert = require('node:assert/strict');
const { roleRequiresMfa, userNeedsMfa } = require('../app/utils/mfa-policy.ts');
const { TOTP_TRUST_SECONDS, EMAIL_TRUST_SECONDS } = require('../app/services/mfaLoginService.ts');

test('MFA obrigatório por papel e opcional para cliente comum', () => {
  for (const role of ['MASTER', 'ADMIN', 'SUPORTE', 'SUPORTE_TI', 'COMERCIAL', 'CONTADOR']) assert.equal(roleRequiresMfa(role), true);
  assert.equal(roleRequiresMfa('COMUM'), false);
  assert.equal(userNeedsMfa('COMUM', null), false);
  assert.equal(userNeedsMfa('COMUM', new Date()), true);
});

test('confiança tem prazo fixo de 7 dias no autenticador e 24 horas no e-mail', () => {
  assert.equal(TOTP_TRUST_SECONDS, 7 * 24 * 60 * 60);
  assert.equal(EMAIL_TRUST_SECONDS, 24 * 60 * 60);
});
