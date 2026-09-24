const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fiscalOperationLabel, isFiscalOperationActive, isFiscalOperationPolling, isFiscalOperationDelayed } = require('../app/utils/fiscal-operation-state.ts');
test('interface fiscal: pendente, incerto e erro final nunca sao anunciados como cancelamento confirmado', () => {
  for (const status of ['PENDENTE', 'PROCESSANDO', 'ERRO_TEMPORARIO', 'RECONCILIACAO_MANUAL', 'ERRO_FINAL']) {
    const op = { id: 'fixture', tipo: 'CANCELAR', status, resultStatus: null };
    assert.notEqual(fiscalOperationLabel(op), 'Cancelamento confirmado');
    assert.equal(isFiscalOperationActive(op), status !== 'ERRO_FINAL');
    assert.equal(isFiscalOperationPolling(op), ['PENDENTE', 'PROCESSANDO', 'ERRO_TEMPORARIO'].includes(status));
  }
  assert.equal(fiscalOperationLabel({ tipo: 'CONSULTAR', status: 'CONCLUIDA', resultStatus: 'AUTORIZADA' }), 'Consulta concluída');
  assert.equal(fiscalOperationLabel({ tipo: 'CANCELAR', status: 'CONCLUIDA', resultStatus: 'CANCELADA' }), 'Cancelamento confirmado');
});

test('consulta fiscal distingue fila, processador ausente, atraso e conciliação', () => {
  const now = Date.parse('2026-09-16T12:00:00.000Z');
  const recent = { tipo: 'CONSULTAR', status: 'PENDENTE', createdAt: new Date(now - 60_000) };
  const old = { ...recent, createdAt: new Date(now - 6 * 60_000) };
  assert.equal(fiscalOperationLabel(recent, { workerOnline: true, now }), 'Aguardando consulta ao portal');
  assert.equal(fiscalOperationLabel(recent, { workerOnline: false, now }), 'Aguardando processador fiscal');
  assert.equal(isFiscalOperationDelayed(recent, now), false);
  assert.equal(isFiscalOperationDelayed(old, now), true);
  assert.equal(fiscalOperationLabel(old, { workerOnline: false, now }), 'Consulta atrasada — processador indisponível');
  assert.equal(fiscalOperationLabel({ ...recent, status: 'PROCESSANDO' }, { now }), 'Consultando o portal fiscal');
  assert.equal(fiscalOperationLabel({ ...recent, status: 'ERRO_TEMPORARIO', nextAttemptAt: new Date(now + 60_000) }, { now }), 'Consulta não confirmada — nova tentativa agendada');
  assert.equal(fiscalOperationLabel({ ...recent, status: 'ERRO_TEMPORARIO', nextAttemptAt: new Date(now - 6 * 60_000) }, { now }), 'Nova tentativa atrasada — suporte acompanhar');
  assert.equal(fiscalOperationLabel({ ...recent, status: 'RECONCILIACAO_MANUAL' }, { now }), 'Resultado não confirmado — solicitar conciliação');
  assert.equal(isFiscalOperationDelayed({ ...old, tipo: 'CANCELAR' }, now), false);
});
