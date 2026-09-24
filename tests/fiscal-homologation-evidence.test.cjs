const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  calculateFiscalArtifactHash, inspectFiscalHomologationEvidence,
  REQUIRED_FISCAL_HOMOLOGATION_SCENARIOS, validateFiscalHomologationManifest,
} = require('../app/utils/fiscal-homologation-evidence.ts');

const now = new Date('2026-09-24T12:00:00.000Z');

function approvedManifest(artifactHash) {
  return {
    schemaVersion: 1,
    status: 'APPROVED',
    portal: 'NFS_E_PADRAO_NACIONAL',
    environment: 'HOMOLOGACAO',
    fiscalArtifactHash: artifactHash,
    reportSha256: crypto.createHash('sha256').update('relatorio').digest('hex'),
    approvedAt: '2026-09-24T11:00:00.000Z',
    expiresAt: '2027-03-20T11:00:00.000Z',
    approvers: [
      { role: 'TECNICO', name: 'Responsavel Tecnico', approvalRef: 'TICKET-TEC-001' },
      { role: 'FISCAL', name: 'Responsavel Fiscal', approvalRef: 'PARECER-FIS-001' },
    ],
    scenarios: REQUIRED_FISCAL_HOMOLOGATION_SCENARIOS.map((id, index) => ({
      id, status: 'PASSED', executedAt: `2026-09-24T10:${String(index).padStart(2, '0')}:00.000Z`, evidenceRef: `EVIDENCIA-${index + 100}`,
    })),
  };
}

test('evidencia aprovada exige todos os cenarios e duas aprovacoes segregadas', () => {
  const result = validateFiscalHomologationManifest(approvedManifest('a'.repeat(64)), 'a'.repeat(64), now);
  assert.equal(result.ok, true);
  assert.equal(result.issues.length, 0);
});

test('evidencia vencida, codigo fiscal alterado e cenario ausente bloqueiam producao', () => {
  const manifest = approvedManifest('a'.repeat(64));
  manifest.expiresAt = '2026-09-23T11:00:00.000Z';
  manifest.scenarios.pop();
  const result = validateFiscalHomologationManifest(manifest, 'b'.repeat(64), now);
  assert.ok(result.issues.some(issue => issue.code === 'FISCAL_ARTIFACT_HASH_MISMATCH'));
  assert.ok(result.issues.some(issue => issue.code === 'EVIDENCE_EXPIRED_OR_TOO_LONG'));
  assert.ok(result.issues.some(issue => issue.code === 'MISSING_SCENARIO'));
});

test('a mesma referencia nao pode aprovar as funcoes tecnica e fiscal', () => {
  const manifest = approvedManifest('a'.repeat(64));
  manifest.approvers[1].approvalRef = manifest.approvers[0].approvalRef;
  const result = validateFiscalHomologationManifest(manifest, 'a'.repeat(64), now);
  assert.ok(result.issues.some(issue => issue.code === 'APPROVALS_NOT_SEGREGATED'));
});

test('a mesma pessoa nao pode ocupar as duas aprovacoes', () => {
  const manifest = approvedManifest('a'.repeat(64));
  manifest.approvers[1].name = manifest.approvers[0].name;
  const result = validateFiscalHomologationManifest(manifest, 'a'.repeat(64), now);
  assert.ok(result.issues.some(issue => issue.code === 'APPROVERS_NOT_DISTINCT'));
});

test('fingerprint fiscal e deterministico, ignora CRLF e muda com o comportamento', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nfse-fiscal-artifact-'));
  try {
    fs.mkdirSync(path.join(root, 'fiscal'));
    const file = path.join(root, 'fiscal', 'engine.ts');
    fs.writeFileSync(file, 'export const value = 1;\r\n');
    const first = calculateFiscalArtifactHash(root, ['fiscal']).hash;
    fs.writeFileSync(file, 'export const value = 1;\n');
    assert.equal(calculateFiscalArtifactHash(root, ['fiscal']).hash, first);
    fs.writeFileSync(file, 'export const value = 2;\n');
    assert.notEqual(calculateFiscalArtifactHash(root, ['fiscal']).hash, first);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('arquivo precisa ser absoluto, legivel e corresponder ao codigo atual', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nfse-fiscal-evidence-'));
  try {
    fs.mkdirSync(path.join(root, 'fiscal'));
    fs.writeFileSync(path.join(root, 'fiscal', 'engine.ts'), 'export {};\n');
    const hash = calculateFiscalArtifactHash(root, ['fiscal']).hash;
    const evidenceFile = path.join(root, 'evidence.json');
    fs.writeFileSync(evidenceFile, JSON.stringify(approvedManifest(hash)));
    assert.equal(inspectFiscalHomologationEvidence({ rootDir: root, evidenceFile, now, artifactPaths: ['fiscal'] }).ok, true);
    assert.equal(inspectFiscalHomologationEvidence({ rootDir: root, evidenceFile: 'evidence.json', now, artifactPaths: ['fiscal'] }).issues[0].code, 'EVIDENCE_FILE_MUST_BE_ABSOLUTE');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('diretorio de release sem os artefatos fiscais nunca pode ser aprovado', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nfse-fiscal-empty-'));
  try {
    const evidenceFile = path.join(root, 'evidence.json');
    fs.writeFileSync(evidenceFile, JSON.stringify(approvedManifest('a'.repeat(64))));
    const result = inspectFiscalHomologationEvidence({ rootDir: root, evidenceFile, now, artifactPaths: ['ausente'] });
    assert.deepEqual(result.issues, [{ code: 'FISCAL_ARTIFACT_SET_EMPTY' }]);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
