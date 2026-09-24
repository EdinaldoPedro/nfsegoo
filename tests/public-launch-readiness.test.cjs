const assert = require('node:assert/strict');
const test = require('node:test');
const { validatePublicLaunchEvidence } = require('../scripts/public-launch-readiness.cjs');

function evidence() {
  return {
    schemaVersion: 1, status: 'APPROVED', releaseId: 'release-1',
    pilotStartedAt: '2026-09-01T10:00:00.000Z', pilotEndedAt: '2026-09-20T10:00:00.000Z',
    approvedAt: '2026-09-21T10:00:00.000Z', expiresAt: '2026-10-15T10:00:00.000Z', evidenceRef: 'piloto/relatorio-final',
    sample: { activeCompanies: 4, customersWithCompletedFlow: 3, successfulProductionEmissions: 20, supportInteractionsReviewed: 2 },
    metrics: { availabilityPercent: 99.8, httpErrorRatePercent: 0.3, crossTenantIncidents: 0, duplicateEmissionIncidents: 0,
      documentLossIncidents: 0, unresolvedSeverityOneOrTwo: 0, openManualReconciliations: 0, highPrioritySupportBacklog: 0,
      supportMedianFirstResponseHours: 4, fiscalFailuresReviewed: true },
    approvals: [
      { role: 'PRODUCT_OWNER', approverRef: 'pessoa/produto', evidenceRef: 'abertura/produto' },
      { role: 'TECHNICAL', approverRef: 'pessoa/tecnico', evidenceRef: 'abertura/tecnica' },
      { role: 'OPERATIONS', approverRef: 'pessoa/operacao', evidenceRef: 'abertura/operacao' },
    ],
  };
}
const options = { expectedReleaseId: 'release-1', now: new Date('2026-09-24T10:00:00.000Z') };

test('aprova abertura depois de piloto mínimo saudável', () => {
  assert.deepEqual(validatePublicLaunchEvidence(evidence(), options), { ok: true, issues: [] });
});
test('recusa piloto curto, amostra insuficiente e outro release', () => {
  const value = evidence(); value.releaseId = 'release-2'; value.pilotEndedAt = '2026-09-05T10:00:00.000Z'; value.sample.activeCompanies = 2;
  const result = validatePublicLaunchEvidence(value, options);
  assert.ok(result.issues.includes('PUBLIC_LAUNCH_RELEASE_MISMATCH'));
  assert.ok(result.issues.includes('PUBLIC_LAUNCH_PILOT_DURATION_INVALID'));
  assert.ok(result.issues.includes('PUBLIC_LAUNCH_SAMPLE_TOO_SMALL'));
});
test('qualquer incidente grave, perda, duplicidade ou conciliação aberta bloqueia', () => {
  const value = evidence(); value.metrics.crossTenantIncidents = 1; value.metrics.duplicateEmissionIncidents = 1;
  value.metrics.documentLossIncidents = 1; value.metrics.openManualReconciliations = 2;
  const result = validatePublicLaunchEvidence(value, options);
  assert.ok(result.issues.some(issue => issue.includes('CROSS_TENANT')));
  assert.ok(result.issues.some(issue => issue.includes('DUPLICATE_EMISSION')));
  assert.ok(result.issues.some(issue => issue.includes('DOCUMENT_LOSS')));
  assert.ok(result.issues.some(issue => issue.includes('MANUAL_RECONCILIATIONS')));
});
test('disponibilidade, erro, suporte e revisão fiscal têm limites explícitos', () => {
  const value = evidence(); value.metrics.availabilityPercent = 98; value.metrics.httpErrorRatePercent = 3;
  value.metrics.supportMedianFirstResponseHours = 30; value.metrics.fiscalFailuresReviewed = false;
  const result = validatePublicLaunchEvidence(value, options);
  assert.ok(result.issues.includes('PUBLIC_LAUNCH_AVAILABILITY_TOO_LOW'));
  assert.ok(result.issues.includes('PUBLIC_LAUNCH_ERROR_RATE_TOO_HIGH'));
  assert.ok(result.issues.includes('PUBLIC_LAUNCH_SUPPORT_RESPONSE_TOO_SLOW'));
  assert.ok(result.issues.includes('PUBLIC_LAUNCH_FISCAL_REVIEW_INCOMPLETE'));
});
test('aprovações precisam ser completas e segregadas', () => {
  const value = evidence(); value.approvals[1].approverRef = value.approvals[0].approverRef; value.approvals.pop();
  const result = validatePublicLaunchEvidence(value, options);
  assert.ok(result.issues.includes('PUBLIC_LAUNCH_APPROVERS_NOT_SEGREGATED'));
  assert.ok(result.issues.includes('PUBLIC_LAUNCH_APPROVAL_OPERATIONS_MISSING'));
});
