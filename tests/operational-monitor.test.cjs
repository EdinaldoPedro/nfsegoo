const { test } = require('node:test');
const assert = require('node:assert/strict');
const { evaluateOperationalSnapshot } = require('../scripts/operational-monitor.cjs');

function healthy() {
  return {
    http: { live: true, ready: true }, databaseOk: true,
    worker: { emission: true, production: true, document: true, consultation: true },
    emission: { waitingTooLong: 0, retryOverdue: 0, processingExpired: 0, manual: 0 },
    document: { waitingTooLong: 0, retryOverdue: 0, processingExpired: 0, manual: 0 },
    consultation: { waitingTooLong: 0, retryOverdue: 0, processingExpired: 0, manual: 0 },
    emailTerminal: 0, certificates: { expired: 0, within7Days: 0, within30Days: 0 },
    privacyOverdue: 0, incidentOverdue: 0,
  };
}

test('operação saudável não gera alerta', () => {
  const result = evaluateOperationalSnapshot(healthy());
  assert.equal(result.status, 'OK');
  assert.equal(result.severity, 0);
  assert.ok(result.checks.every(item => item.status === 'OK'));
});

test('indisponibilidade e fila travada são críticas sem expor itens', () => {
  const snapshot = healthy();
  snapshot.http.ready = false;
  snapshot.worker.emission = false;
  snapshot.emission.processingExpired = 2;
  const result = evaluateOperationalSnapshot(snapshot);
  assert.equal(result.status, 'CRITICAL');
  assert.equal(result.severity, 2);
  assert.deepEqual(result.checks.find(item => item.id === 'emission_queue'), {
    id: 'emission_queue', status: 'CRITICAL', value: 2, runbook: 'queues/emission',
  });
});

test('conciliação manual, falha terminal de e-mail e vencimento em 30 dias geram aviso', () => {
  const snapshot = healthy();
  snapshot.consultation.manual = 1;
  snapshot.emailTerminal = 3;
  snapshot.certificates.within30Days = 2;
  const result = evaluateOperationalSnapshot(snapshot);
  assert.equal(result.status, 'WARN');
  assert.equal(result.severity, 1);
});

test('certificado em sete dias e prazos legais vencidos são críticos', () => {
  const snapshot = healthy();
  snapshot.certificates.within7Days = 1;
  snapshot.certificates.within30Days = 1;
  snapshot.privacyOverdue = 1;
  snapshot.incidentOverdue = 1;
  const result = evaluateOperationalSnapshot(snapshot);
  assert.equal(result.status, 'CRITICAL');
  assert.equal(result.checks.find(item => item.id === 'certificate_30_days').status, 'OK');
});

test('banco indisponível interrompe avaliações derivadas e falha fechado', () => {
  const snapshot = healthy();
  snapshot.databaseOk = false;
  const result = evaluateOperationalSnapshot(snapshot);
  assert.equal(result.status, 'CRITICAL');
  assert.deepEqual(result.checks.map(item => item.id), ['http_live', 'http_ready', 'database']);
});
