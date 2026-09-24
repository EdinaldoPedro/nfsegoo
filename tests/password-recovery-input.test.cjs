const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeRecoveryEmailInput, normalizePasswordResetInput, passwordResetTokenHash } = require('../app/services/passwordRecoveryService.ts');

test('recuperação normaliza e-mail e rejeita campos extras', () => {
  assert.equal(normalizeRecoveryEmailInput({ email: '  Conta@Example.INVALID ' }), 'conta@example.invalid');
  assert.throws(() => normalizeRecoveryEmailInput({ email: 'a@example.invalid', role: 'MASTER' }), /Campos/);
  assert.throws(() => normalizeRecoveryEmailInput({ email: 'inválido' }), /válido/);
});

test('redefinição exige token criptográfico e senha dentro da política', () => {
  const token = 'a'.repeat(64);
  assert.deepEqual(normalizePasswordResetInput({ token, senha: 'Nova@Senha1' }), { token, password: 'Nova@Senha1' });
  assert.throws(() => normalizePasswordResetInput({ token: 'abc', senha: 'Nova@Senha1' }), /Link/);
  assert.throws(() => normalizePasswordResetInput({ token, senha: 'fraca' }), /senha deve/);
  assert.throws(() => normalizePasswordResetInput({ token, senha: 'Nova@Senha1', userId: 'outro' }), /Campos/);
});

test('token de recuperação é armazenado somente como hash', () => {
  const token = '0123456789abcdef'.repeat(4);
  const hash = passwordResetTokenHash(token);
  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.notEqual(hash, token);
  assert.equal(hash, passwordResetTokenHash(token));
});
