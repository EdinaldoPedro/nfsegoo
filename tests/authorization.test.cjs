const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateRoleTransition } = require('../app/utils/admin-security.ts');
const { isSupportTicketRole } = require('../app/utils/access-control.ts');
const { isSafeImpersonationMethod } = require('../app/utils/impersonation.ts');
const { stripUserSecrets } = require('../app/utils/safe-data.ts');

test('ADMIN nao pode promover a MASTER/ADMIN nem alterar pares superiores', () => {
  for (const newRole of ['MASTER', 'ADMIN']) {
    assert.ok(validateRoleTransition({ actorId: 'actor', actorRole: 'ADMIN', targetId: 'target', targetRole: 'COMUM', newRole }));
  }
  for (const targetRole of ['MASTER', 'ADMIN']) {
    assert.ok(validateRoleTransition({ actorId: 'actor', actorRole: 'ADMIN', targetId: 'target', targetRole, newRole: 'COMUM' }));
  }
  assert.equal(validateRoleTransition({ actorId: 'actor', actorRole: 'MASTER', targetId: 'target', targetRole: 'COMUM', newRole: 'ADMIN' }), null);
});

test('Nenhum administrador altera o proprio papel; papeis desconhecidos sao rejeitados', () => {
  assert.ok(validateRoleTransition({ actorId: 'same', actorRole: 'MASTER', targetId: 'same', targetRole: 'MASTER', newRole: 'COMUM' }));
  assert.ok(validateRoleTransition({ actorId: 'actor', actorRole: 'MASTER', targetId: 'target', targetRole: 'COMUM', newRole: 'SUPER_ADMIN' }));
  for (const actorRole of ['COMUM', 'CONTADOR', 'SUPORTE', 'SUPORTE_TI']) {
    assert.ok(validateRoleTransition({ actorId: 'actor', actorRole, targetId: 'target', targetRole: 'COMUM', newRole: 'SUPORTE' }));
  }
});

test('Contador e cliente nao sao staff de tickets', () => {
  assert.equal(isSupportTicketRole('CONTADOR'), false);
  assert.equal(isSupportTicketRole('COMUM'), false);
  assert.equal(isSupportTicketRole('SUPORTE'), true);
});

test('Impersonacao somente leitura rejeita metodos mutantes', () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) assert.equal(isSafeImpersonationMethod(method), false);
  for (const method of ['GET', 'HEAD', 'OPTIONS']) assert.equal(isSafeImpersonationMethod(method), true);
});

test('Serializacao remove segredos de MFA e certificados de empresas proprietarias', () => {
  const safe = stripUserSecrets({ id: 'user', senha: 'password', mfaSecret: 'secret', mfaRecoveryCodes: 'codes',
    empresasProprietarias: [{ id: 'company', certificadoA1: 'pfx', senhaCertificado: 'pfx-password' }],
  });
  const serialized = JSON.stringify(safe);
  for (const secret of ['password', 'secret', 'codes', 'pfx-password', '"pfx"']) assert.equal(serialized.includes(secret), false);
  assert.equal(safe.empresasProprietarias[0].temCertificado, true);
});
