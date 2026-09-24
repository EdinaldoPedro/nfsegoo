const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { LEGAL_ARTIFACTS, calculateLegalArtifactHash, validateLegalGovernanceEvidence } = require('../scripts/legal-governance-readiness.cjs');

const template = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'legal-governance.example.json'), 'utf8'));
const options = {
  artifactHash: 'a'.repeat(64), termsVersion: 'terms-2026-09-24-v1', privacyVersion: 'privacy-2026-09-24-v1',
  now: new Date('2026-09-24T13:00:00.000Z'),
};
function validEvidence() { const value = structuredClone(template); value.applicationLegalSha256 = options.artifactHash; return value; }

test('aprova somente o conjunto jurídico completo e compatível com as versões públicas', () => {
  assert.deepEqual(validateLegalGovernanceEvidence(validEvidence(), options), { ok: true, issues: [] });
});

test('mudança no conteúdo implantado ou nas versões públicas invalida a aprovação', () => {
  const evidence = validEvidence();
  const result = validateLegalGovernanceEvidence(evidence, { ...options, artifactHash: 'b'.repeat(64), termsVersion: 'terms-outra-v2' });
  assert.ok(result.issues.includes('LEGAL_APPLICATION_HASH_MISMATCH'));
  assert.ok(result.issues.includes('LEGAL_TERMS_VERSION_MISMATCH'));
});

test('DPA, registro de tratamento e aprovações não podem ser substituídos por um booleano', () => {
  const evidence = validEvidence();
  evidence.documents = evidence.documents.filter(item => !['DATA_PROCESSING_AGREEMENT', 'PROCESSING_RECORD'].includes(item.type));
  evidence.approvals = evidence.approvals.filter(item => item.role !== 'LEGAL');
  const result = validateLegalGovernanceEvidence(evidence, options);
  assert.ok(result.issues.includes('LEGAL_DOCUMENT_DATA_PROCESSING_AGREEMENT_MISSING'));
  assert.ok(result.issues.includes('LEGAL_DOCUMENT_PROCESSING_RECORD_MISSING'));
  assert.ok(result.issues.includes('LEGAL_APPROVAL_LEGAL_MISSING'));
});

test('operadores mínimos exigem contrato e revisão, sem aceitar referência com segredo', () => {
  const evidence = validEvidence();
  evidence.subprocessors = evidence.subprocessors.filter(item => item.category !== 'EMAIL');
  evidence.subprocessors[0].contractRef = 'token=indevido';
  const result = validateLegalGovernanceEvidence(evidence, options);
  assert.ok(result.issues.includes('LEGAL_SUBPROCESSOR_EMAIL_MISSING'));
  assert.ok(result.issues.includes('LEGAL_SUBPROCESSOR_REFERENCE_INVALID'));
});

test('transferência internacional declarada exige países e salvaguardas documentadas', () => {
  const evidence = validEvidence();
  evidence.internationalTransfers = { occurs: true, countries: [], assessmentRef: 'privacy/assessment', safeguardsRef: null };
  assert.ok(validateLegalGovernanceEvidence(evidence, options).issues.includes('LEGAL_TRANSFER_SAFEGUARDS_MISSING'));
});

test('fingerprint jurídico é determinístico, tolera CRLF e muda com o conteúdo', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nfse-legal-'));
  try {
    for (const [index, relative] of LEGAL_ARTIFACTS.entries()) {
      const file = path.join(root, relative); fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, `documento ${index}\r\nlinha\r\n`);
    }
    const first = calculateLegalArtifactHash(root);
    for (const [index, relative] of LEGAL_ARTIFACTS.entries()) fs.writeFileSync(path.join(root, relative), `documento ${index}\nlinha\n`);
    assert.equal(calculateLegalArtifactHash(root).hash, first.hash);
    fs.appendFileSync(path.join(root, LEGAL_ARTIFACTS[0]), 'alterado\n');
    assert.notEqual(calculateLegalArtifactHash(root).hash, first.hash);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
