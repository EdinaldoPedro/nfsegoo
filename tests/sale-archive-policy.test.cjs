const { test } = require('node:test');
const assert = require('node:assert/strict');
const { emissionJobBlocksSaleArchive } = require('../app/services/saleArchiveService.ts');

function job(changes = {}) {
  return {
    status: 'ERRO_FINAL',
    transmissionStartedAt: new Date('2026-10-09T20:46:32.668Z'),
    signedXml: '<DPS/>',
    dpsId: 'DPS123',
    lastError: null,
    creditReservation: null,
    ...changes,
  };
}

test('arquivamento: rejeicao fiscal definitiva nao permanece como obrigacao incerta', () => {
  const lastError = JSON.stringify({
    details: [{ codigo: 'E0120', mensagem: 'IM do prestador não deve ser informada.' }],
    temporario: false,
    requiresReconciliation: false,
  });
  assert.equal(emissionJobBlocksSaleArchive(job({ lastError })), false);
});

test('arquivamento: marcador legado sem DPS preparada nao simula transmissao fiscal', () => {
  assert.equal(emissionJobBlocksSaleArchive(job({ signedXml: null, dpsId: null })), false);
});

test('arquivamento: resultado incerto, job ativo e credito reservado continuam bloqueados', () => {
  assert.equal(emissionJobBlocksSaleArchive(job()), true);
  assert.equal(emissionJobBlocksSaleArchive(job({ status: 'RECONCILIACAO_MANUAL' })), true);
  assert.equal(emissionJobBlocksSaleArchive(job({ signedXml: null, dpsId: null, creditReservation: { status: 'RESERVED' } })), true);
  assert.equal(emissionJobBlocksSaleArchive(job({ lastError: JSON.stringify({ details: [{ codigo: 'E0120' }], requiresReconciliation: true }) })), true);
});

test('arquivamento: falha local terminal sem marcador de transmissao pode ser descartada', () => {
  assert.equal(emissionJobBlocksSaleArchive(job({ transmissionStartedAt: null, signedXml: null, dpsId: null })), false);
});
