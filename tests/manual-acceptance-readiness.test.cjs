const assert = require('node:assert/strict');
const test = require('node:test');
const { parseManualTestPlan, validateManualAcceptanceEvidence } = require('../scripts/manual-acceptance-readiness.cjs');

const plan = parseManualTestPlan('| ID | Perfil | Ação | Resultado |\n| --- | --- | --- | --- |\n| A01 | Cliente | Entrar | OK |\n| X01 | Operação | Reiniciar | OK |\n');
function evidence() {
  return {
    schemaVersion: 1, status: 'APPROVED', environment: 'STAGING_RELEASE_CANDIDATE', releaseId: 'release-1',
    planFingerprint: plan.fingerprint, executedAt: '2026-09-20T10:00:00.000Z', approvedAt: '2026-09-20T12:00:00.000Z',
    expiresAt: '2026-10-10T12:00:00.000Z', evidenceRef: 'qa/release-1',
    caseResults: [
      { id: 'A01', status: 'PASSED', executedByRef: 'qa/cliente', evidenceRef: 'qa/A01' },
      { id: 'X01', status: 'PASSED', executedByRef: 'qa/operacao', evidenceRef: 'qa/X01' },
    ],
    approvals: [
      { role: 'PRODUCT_OWNER', approverRef: 'pessoa/produto', evidenceRef: 'aceite/produto' },
      { role: 'TECHNICAL', approverRef: 'pessoa/tecnico', evidenceRef: 'aceite/tecnico' },
      { role: 'OPERATIONS', approverRef: 'pessoa/operacao', evidenceRef: 'aceite/operacao' },
    ],
  };
}
const options = { expectedReleaseId: 'release-1', expectedPlanFingerprint: plan.fingerprint, requiredCaseIds: plan.caseIds, now: new Date('2026-09-24T10:00:00.000Z') };

test('aprova somente todos os casos do roteiro para o release exato', () => {
  assert.deepEqual(validateManualAcceptanceEvidence(evidence(), options), { ok: true, issues: [] });
});
test('mudança de release ou do roteiro invalida o aceite', () => {
  const value = evidence(); value.releaseId = 'release-2'; value.planFingerprint = '0'.repeat(64);
  const result = validateManualAcceptanceEvidence(value, options);
  assert.ok(result.issues.includes('ACCEPTANCE_RELEASE_MISMATCH'));
  assert.ok(result.issues.includes('ACCEPTANCE_PLAN_MISMATCH'));
});
test('caso faltante, falho, bloqueado ou desconhecido não é aprovado', () => {
  const value = evidence(); value.caseResults = [
    { id: 'A01', status: 'FAILED', executedByRef: 'qa/cliente', evidenceRef: 'qa/A01' },
    { id: 'Z99', status: 'PASSED', executedByRef: 'qa/outro', evidenceRef: 'qa/Z99' },
  ];
  const result = validateManualAcceptanceEvidence(value, options);
  assert.ok(result.issues.includes('ACCEPTANCE_CASE_A01_NOT_PASSED'));
  assert.ok(result.issues.includes('ACCEPTANCE_CASE_X01_MISSING'));
  assert.ok(result.issues.includes('ACCEPTANCE_CASE_UNKNOWN'));
});
test('aprovações são obrigatórias e segregadas', () => {
  const value = evidence(); value.approvals[1].approverRef = value.approvals[0].approverRef; value.approvals.pop();
  const result = validateManualAcceptanceEvidence(value, options);
  assert.ok(result.issues.includes('ACCEPTANCE_APPROVERS_NOT_SEGREGATED'));
  assert.ok(result.issues.includes('ACCEPTANCE_APPROVAL_OPERATIONS_MISSING'));
});
test('fingerprint tolera CRLF, mas detecta mudança no roteiro e IDs duplicados', () => {
  const crlf = parseManualTestPlan('| ID | Perfil |\r\n| --- | --- |\r\n| A01 | Cliente |\r\n');
  const lf = parseManualTestPlan('| ID | Perfil |\n| --- | --- |\n| A01 | Cliente |\n');
  assert.equal(crlf.fingerprint, lf.fingerprint);
  assert.notEqual(lf.fingerprint, parseManualTestPlan('| ID | Perfil |\n| --- | --- |\n| A01 | Contador |\n').fingerprint);
  assert.deepEqual(parseManualTestPlan('| A01 | Um |\n| A01 | Dois |\n').duplicates, ['A01']);
});
