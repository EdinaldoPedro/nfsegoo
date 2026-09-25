const assert = require('node:assert/strict');
const { test } = require('node:test');
const { profileAuthRedirect, runtimeSetupRedirect, shouldSyncProfile } = require('../app/utils/profile-session-gate.ts');

test('nao consulta perfil durante configuracao MFA ou aceite legal', () => {
  assert.equal(shouldSyncProfile('user-id', '/seguranca'), false);
  assert.equal(shouldSyncProfile('user-id', '/aceite-legal'), false);
  assert.equal(shouldSyncProfile('user-id', '/termos-de-uso'), false);
  assert.equal(shouldSyncProfile('user-id', '/politica-de-privacidade'), false);
  assert.equal(shouldSyncProfile('user-id', '/politica-de-cookies'), false);
  assert.equal(shouldSyncProfile('user-id', '/admin/dashboard'), true);
  assert.equal(shouldSyncProfile('user-id', '/privacidade'), true);
  assert.equal(shouldSyncProfile(null, '/admin/dashboard'), false);
});

test('401 de perfil preserva sessao autenticada e prioriza os gates', () => {
  assert.equal(profileAuthRedirect({ authenticated: true, legalAcceptanceRequired: true }), '/aceite-legal');
  assert.equal(profileAuthRedirect({ authenticated: true, mfaRequired: true, legalAcceptanceRequired: true }), '/seguranca');
  assert.equal(profileAuthRedirect({ authenticated: true }), null);
  assert.equal(profileAuthRedirect({ authenticated: false }), '/login?motivo=sessao-expirada');
});

test('guardiao nao interrompe a confirmacao dos codigos de recuperacao', () => {
  const bothPending = { authenticated: true, mfaRequired: true, legalAcceptanceRequired: true };
  assert.equal(runtimeSetupRedirect(bothPending, '/admin/dashboard'), '/seguranca');
  assert.equal(runtimeSetupRedirect(bothPending, '/seguranca'), null);

  const onlyLegalPending = { authenticated: true, mfaRequired: false, legalAcceptanceRequired: true };
  assert.equal(runtimeSetupRedirect(onlyLegalPending, '/seguranca'), null);
  assert.equal(runtimeSetupRedirect(onlyLegalPending, '/admin/dashboard'), '/aceite-legal');
  assert.equal(runtimeSetupRedirect(onlyLegalPending, '/aceite-legal'), null);
});
