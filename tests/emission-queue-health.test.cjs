const { test } = require('node:test');
const assert = require('node:assert/strict');
const { emissionHealthSummary } = require('../app/services/emissionQueueHealth.ts');

const base = { workerOnline: true, productionWorkerOnline: false, active: 0, productionActive: 0,
  waitingTooLong: 0, retryOverdue: 0, processingExpired: 0, manual: 0 };

test('worker de documentos nao mascara ausencia de emissor com fila ativa', () => {
  assert.equal(emissionHealthSummary({ ...base, workerOnline: false, active: 1 }).needsAttention, true);
  assert.equal(emissionHealthSummary({ ...base, workerOnline: false }).needsAttention, false);
});

test('producao exige worker habilitado e atrasos exigem acompanhamento', () => {
  assert.equal(emissionHealthSummary({ ...base, productionActive: 1 }).needsAttention, true);
  assert.equal(emissionHealthSummary({ ...base, waitingTooLong: 1 }).needsAttention, true);
  assert.equal(emissionHealthSummary({ ...base, manual: 1 }).needsAttention, true);
  assert.equal(emissionHealthSummary(base).needsAttention, false);
});
