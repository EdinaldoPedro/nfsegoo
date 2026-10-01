const { test } = require('node:test');
const assert = require('node:assert/strict');
const { classifyPortalRejection, emissionFailureState, retryDelayMs, isConfirmedDpsAbsence } = require('../app/utils/emission-outcome.ts');

test('emissao: somente rejeicao fiscal estruturada e definitiva pode liberar credito', () => {
  assert.equal(classifyPortalRejection(400, [{ Codigo: 'E0180', Descricao: 'Inscricao municipal ausente' }]), 'PORTAL_REJECTION');
  assert.equal(classifyPortalRejection(422, [{ codigo: 'E0184' }]), 'PORTAL_REJECTION');
  for (const status of [200, 202, 301, 401, 403, 404, 408, 409, 425, 429, 500, 502, 503, 504]) {
    assert.equal(classifyPortalRejection(status, [{ Codigo: 'E0180' }]), 'UNKNOWN');
  }
});
test('emissao: duplicidade, timeout, erro generico e resposta vazia requerem conciliacao', () => {
  for (const value of [null, [], {}, [{ codigo: 'API_ERR' }], [{ Codigo: 'E0171' }], [{ codigo: 'E0041' }],
    [{ Codigo: 'E0008' }], [{ Codigo: 'E0999' }], [{ Codigo: 'E9999' }], [{ Codigo: 'E0100', Descricao: 'DPS ja utilizada' }]]) {
    assert.equal(classifyPortalRejection(400, value), 'UNKNOWN');
  }
});
test('emissao: somente esgotamento depois da fronteira fiscal exige conciliacao manual', () => {
  assert.deepEqual(emissionFailureState({ transmitted: true, definitive: false, attempts: 5, maxAttempts: 5 }),
    { status: 'RECONCILIACAO_MANUAL', releaseCredit: false, retry: false });
  assert.deepEqual(emissionFailureState({ transmitted: false, definitive: false, attempts: 5, maxAttempts: 5 }),
    { status: 'ERRO_FINAL', releaseCredit: true, retry: false });
  for (const transmitted of [true, false]) assert.deepEqual(
    emissionFailureState({ transmitted, definitive: false, attempts: 2, maxAttempts: 5 }),
    { status: 'ERRO_TEMPORARIO', releaseCredit: false, retry: true },
  );
  assert.equal(emissionFailureState({ transmitted: true, definitive: true, attempts: 1, maxAttempts: 5 }).releaseCredit, true);
});
test('emissao: backoff e limitado a quinze minutos e nao depende de temporizador HTTP', () => {
  assert.equal(retryDelayMs(1), 15000);
  assert.equal(retryDelayMs(2), 30000);
  assert.equal(retryDelayMs(100), 900000);
});
test('retransmissao: somente 404 explicito da consulta da DPS confirma ausencia', () => {
  assert.equal(isConfirmedDpsAbsence({ sucesso: false, erros: [{ portalDiagnostic: {
    stage: 'DPS_LOOKUP', category: 'DPS_NOT_FOUND', httpStatus: 404,
  } }] }), true);
  for (const result of [
    { sucesso: true },
    { sucesso: false },
    { sucesso: false, erros: [{ portalDiagnostic: { stage: 'DPS_LOOKUP', category: 'PORTAL_INSTABILITY', httpStatus: 503 } }] },
    { sucesso: false, erros: [{ portalDiagnostic: { stage: 'NFSE_DOWNLOAD', category: 'DPS_NOT_FOUND', httpStatus: 404 } }] },
    { sucesso: false, erros: [{ portalDiagnostic: { stage: 'DPS_LOOKUP', category: 'DPS_NOT_FOUND', httpStatus: 200 } }] },
  ]) assert.equal(isConfirmedDpsAbsence(result), false);
});
