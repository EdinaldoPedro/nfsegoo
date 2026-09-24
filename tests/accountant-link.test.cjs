const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateLinkDecision } = require('../app/services/accountantLinkService.ts');
const base = { action: 'LIBERAR_ACESSO', status: 'PENDENTE_CUSTODIANTE', archived: false,
  actorIsAdmin: false, actorIsOwner: false, actorIsCustodian: false, actorIsRequester: false };

test('vinculo nao aceita acao arbitraria como aprovacao ou transferencia', () => {
  for (const action of [undefined, '', 'LIBERAR', 'ADMIN', {}, true]) assert.throws(() => validateLinkDecision({ ...base, action, actorIsAdmin: true }), (e) => e.status === 400);
});
test('outro contador aprovado nao e custodiante nem dono e nao pode compartilhar dados', () => {
  for (const action of ['APROVAR', 'LIBERAR_ACESSO', 'TRANSFERIR_CUSTODIA', 'REJEITAR']) assert.throws(() => validateLinkDecision({ ...base, action }), (e) => e.status === 403);
});
test('contador nao autoaprova solicitacao por ser o solicitante', () => {
  assert.throws(() => validateLinkDecision({ ...base, actorIsRequester: true }), (e) => e.status === 403);
  assert.throws(() => validateLinkDecision({ ...base, actorIsRequester: true, actorIsCustodian: true }), (e) => e.status === 403);
});
test('dono, custodiante principal e administrador podem resolver custodia pendente', () => {
  for (const key of ['actorIsOwner', 'actorIsCustodian', 'actorIsAdmin']) assert.doesNotThrow(() => validateLinkDecision({ ...base, [key]: true }));
});
test('custodiante nao substitui consentimento do titular em pedido pendente do dono', () => {
  assert.throws(() => validateLinkDecision({ ...base, status: 'PENDENTE_DONO', actorIsCustodian: true }), (e) => e.status === 403);
  assert.doesNotThrow(() => validateLinkDecision({ ...base, status: 'PENDENTE_DONO', action: 'APROVAR', actorIsOwner: true }));
});
test('resolvidos ou arquivados nao voltam a aprovados; transferencia exige estado correto', () => {
  for (const status of ['APROVADO', 'REJEITADO', 'DESVINCULADO']) assert.throws(() => validateLinkDecision({ ...base, status, actorIsAdmin: true }), (e) => e.status === 409);
  assert.throws(() => validateLinkDecision({ ...base, archived: true, actorIsAdmin: true }), (e) => e.status === 409);
  assert.throws(() => validateLinkDecision({ ...base, status: 'PENDENTE_DONO', action: 'TRANSFERIR_CUSTODIA', actorIsOwner: true }), (e) => e.status === 409);
});
test('titular e contador podem revogar acesso sem depender do plano estar pago', () => {
  for (const key of ['actorIsOwner', 'actorIsCustodian', 'actorIsAdmin', 'actorIsRequester']) assert.doesNotThrow(() => validateLinkDecision({ ...base, action: 'REVOGAR', status: 'APROVADO', [key]: true }));
  assert.throws(() => validateLinkDecision({ ...base, action: 'REVOGAR', status: 'APROVADO' }), (e) => e.status === 403);
});
