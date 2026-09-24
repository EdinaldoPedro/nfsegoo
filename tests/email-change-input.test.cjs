const { test } = require('node:test');
const assert = require('node:assert/strict');
const { emailVerificationHash, normalizeEmailChangeInput, normalizeEmailCode } = require('../app/services/emailChangeService.ts');

test('troca de e-mail normaliza endereço e limita senha/campos', () => {
  assert.deepEqual(normalizeEmailChangeInput({ newEmail: ' NOVO@Example.COM ', password: 'senha' }), { email: 'novo@example.com', password: 'senha' });
  for (const body of [{ newEmail: 'sem-dominio', password: 'senha' }, { newEmail: 'a@b.com', password: '' },
    { newEmail: 'a@b.com', password: 'x'.repeat(73) }, { newEmail: 'a@b.com', password: 'senha', role: 'MASTER' }]) assert.throws(() => normalizeEmailChangeInput(body));
});
test('código de e-mail tem formato estrito e hash vinculado à conta', () => {
  assert.equal(normalizeEmailCode({ code: '012345' }), '012345');
  for (const input of [{ code: '12345' }, { code: 123456 }, { code: '123456', email: 'x' }]) assert.throws(() => normalizeEmailCode(input));
  assert.match(emailVerificationHash('user-a', '123456'), /^[a-f0-9]{64}$/);
  assert.notEqual(emailVerificationHash('user-a', '123456'), emailVerificationHash('user-b', '123456'));
});
