const { test } = require('node:test');
const assert = require('node:assert/strict');
const { hasE0014Evidence } = require('../app/services/emissionConflictResolutionService.ts');
const { hasDefinitivePortalRejection, hasResolvedDpsIdentityConflict } = require('../app/services/emissaoJobService.ts');

test('conflito DPS: aceita somente evidencia estruturada do E0014', () => {
  assert.equal(hasE0014Evidence({ portalErrors: [{ codigo: 'E0014', mensagem: 'DPS já existe' }] }), true);
  assert.equal(hasE0014Evidence(JSON.stringify({ previousError: { details: [{ Codigo: 'E0014' }] } })), true);
  assert.equal(hasE0014Evidence({ portalErrors: [{ codigo: 'E0015' }] }), false);
  assert.equal(hasE0014Evidence('texto livre mencionando E0014'), false);
});

test('conflito DPS: somente resolução administrativa completa libera nova tentativa legada', () => {
  const resolution = {
    code: 'DPS_IDENTITY_CONFLICT',
    portalCode: 'E0014',
    resolution: {
      actorId: 'admin-1',
      justification: 'Conflito conferido no Portal Nacional',
      resolvedAt: '2026-10-09T12:00:00.000Z',
    },
  };
  assert.equal(hasResolvedDpsIdentityConflict(JSON.stringify(resolution)), true);
  assert.equal(hasResolvedDpsIdentityConflict(JSON.stringify({ ...resolution, portalCode: 'E0015' })), false);
  assert.equal(hasResolvedDpsIdentityConflict(JSON.stringify({ ...resolution, resolution: null })), false);
  assert.equal(hasResolvedDpsIdentityConflict(JSON.stringify({ ...resolution, resolution: { ...resolution.resolution, justification: 'curta' } })), false);
  assert.equal(hasResolvedDpsIdentityConflict('E0014 DPS_IDENTITY_CONFLICT'), false);
});

test('rejeicao fiscal definitiva permite corrigir venda legada sem liberar retorno incerto', () => {
  const rejected = JSON.stringify({
    motivo: 'Resposta do Portal Nacional requer correção.',
    details: [{ codigo: 'E0120', mensagem: 'IM do prestador não deve ser informada.' }],
    temporario: false,
    draftEligible: true,
  });
  assert.equal(hasDefinitivePortalRejection(rejected), true);
  assert.equal(hasDefinitivePortalRejection(JSON.stringify({
    details: [{ codigo: 'E0171', mensagem: 'DPS já existe.' }], temporario: false,
  })), false);
  assert.equal(hasDefinitivePortalRejection(JSON.stringify({
    details: [{ codigo: 'E0120' }], requiresReconciliation: true,
  })), false);
  assert.equal(hasDefinitivePortalRejection('erro textual sem evidência estruturada'), false);
});
