const assert = require('node:assert/strict');
const { test } = require('node:test');
const { profileAuthRedirect, shouldSyncProfile } = require('../app/utils/profile-session-gate.ts');

test('nao consulta perfil durante configuracao MFA ou aceite legal', () => {
  assert.equal(shouldSyncProfile('user-id', '/seguranca'), false);
  assert.equal(shouldSyncProfile('user-id', '/aceite-legal'), false);
  assert.equal(shouldSyncProfile('user-id', '/admin/dashboard'), true);
  assert.equal(shouldSyncProfile(null, '/admin/dashboard'), false);
});

test('401 de perfil preserva sessao autenticada e prioriza os gates', () => {
  assert.equal(profileAuthRedirect({ authenticated: true, legalAcceptanceRequired: true }), '/aceite-legal');
  assert.equal(profileAuthRedirect({ authenticated: true, mfaRequired: true, legalAcceptanceRequired: true }), '/seguranca');
  assert.equal(profileAuthRedirect({ authenticated: true }), null);
  assert.equal(profileAuthRedirect({ authenticated: false }), '/login?motivo=sessao-expirada');
});
