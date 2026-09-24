const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { validateCapacityEvidence } = require('../scripts/capacity-readiness.cjs');

const template = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'capacity-evidence.example.json'), 'utf8'));
const options = { expectedReleaseId: template.releaseId, now: new Date('2026-09-24T15:00:00.000Z') };

test('aprova baseline pequeno, mas mensurado, para piloto comercial', () => {
  assert.deepEqual(validateCapacityEvidence(structuredClone(template), options), { ok: true, issues: [] });
});

test('evidência de outro release ou vencida não acompanha o deploy', () => {
  const evidence = structuredClone(template);
  const result = validateCapacityEvidence(evidence, { expectedReleaseId: 'outro-release', now: new Date('2027-01-01T00:00:00.000Z') });
  assert.ok(result.issues.includes('CAPACITY_RELEASE_MISMATCH'));
  assert.ok(result.issues.includes('CAPACITY_EVIDENCE_EXPIRED_OR_INVALID'));
});

test('ensaio curto, dataset vazio ou transmissão fiscal real são recusados', () => {
  const evidence = structuredClone(template);
  evidence.profile.notes = 114;
  evidence.workload.durationMinutes = 5;
  evidence.workload.peakConcurrentUsers = 2;
  evidence.workload.productionFiscalTransmissions = 1;
  const result = validateCapacityEvidence(evidence, options);
  assert.ok(result.issues.includes('CAPACITY_DATASET_TOO_SMALL'));
  assert.ok(result.issues.includes('CAPACITY_WORKLOAD_TOO_SMALL'));
  assert.ok(result.issues.includes('CAPACITY_UNSAFE_FISCAL_WORKLOAD'));
});

test('latência, erro, saturação e isolamento acima do limite bloqueiam', () => {
  const evidence = structuredClone(template);
  evidence.results.httpErrorRatePercent = 1.1;
  evidence.results.httpP95Ms = 1501;
  evidence.results.maxDatabaseConnectionsPercent = 81;
  evidence.results.crossTenantLeaks = 1;
  const result = validateCapacityEvidence(evidence, options);
  assert.ok(result.issues.includes('CAPACITY_HTTP_ERROR_RATE_EXCEEDED'));
  assert.ok(result.issues.includes('CAPACITY_HTTP_LATENCY_EXCEEDED'));
  assert.ok(result.issues.includes('CAPACITY_MAX_DATABASE_CONNECTIONS_PERCENT_EXCEEDED'));
  assert.ok(result.issues.includes('CAPACITY_TENANT_ISOLATION_FAILED'));
});

test('todos os cenários, reinícios e aprovações são obrigatórios', () => {
  const evidence = structuredClone(template);
  evidence.workload.scenarios = evidence.workload.scenarios.filter(item => item !== 'QUEUE_RECOVERY');
  evidence.failureTests = evidence.failureTests.filter(item => item !== 'EMISSION_WORKER_RESTART');
  evidence.approvals = evidence.approvals.filter(item => item.role !== 'OPERATIONS');
  const result = validateCapacityEvidence(evidence, options);
  assert.ok(result.issues.includes('CAPACITY_SCENARIO_QUEUE_RECOVERY_MISSING'));
  assert.ok(result.issues.includes('CAPACITY_FAILURE_TEST_EMISSION_WORKER_RESTART_MISSING'));
  assert.ok(result.issues.includes('CAPACITY_APPROVAL_OPERATIONS_MISSING'));
});
