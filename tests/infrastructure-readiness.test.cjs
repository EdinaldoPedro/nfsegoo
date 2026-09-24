const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { validateInfrastructureEvidence } = require('../scripts/infrastructure-readiness.cjs');

const template = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'infrastructure.example.json'), 'utf8'));
const now = new Date('2026-09-24T13:00:00.000Z');

test('aceita topologia aprovada com responsáveis e restauração comprovada', () => {
  assert.deepEqual(validateInfrastructureEvidence(structuredClone(template), now), { ok: true, issues: [] });
});

test('recusa banco público, TLS fraco e ausência de worker fiscal', () => {
  const evidence = structuredClone(template);
  evidence.architecture.databasePubliclyAccessible = true;
  evidence.architecture.databaseTlsVerifyFull = false;
  evidence.architecture.workerServices = ['EMISSION', 'DOCUMENT'];
  const result = validateInfrastructureEvidence(evidence, now);
  assert.ok(result.issues.includes('INFRASTRUCTURE_DATABASE_MUST_BE_PRIVATE'));
  assert.ok(result.issues.includes('INFRASTRUCTURE_DATABASE_TLS_VERIFY_FULL_REQUIRED'));
  assert.ok(result.issues.includes('INFRASTRUCTURE_WORKER_CONSULTATION_MISSING'));
});

test('recusa restauração vencida ou que não recuperou documentos e chave', () => {
  const evidence = structuredClone(template);
  evidence.recovery.restoreTestedAt = '2026-01-01T00:00:00.000Z';
  evidence.recovery.xmlPdfRestored = false;
  evidence.recovery.encryptionKeyRestored = false;
  const result = validateInfrastructureEvidence(evidence, now);
  assert.ok(result.issues.includes('INFRASTRUCTURE_RESTORE_TEST_EXPIRED'));
  assert.ok(result.issues.includes('INFRASTRUCTURE_RECOVERY_XML_PDF_RESTORED_REQUIRED'));
  assert.ok(result.issues.includes('INFRASTRUCTURE_RECOVERY_ENCRYPTION_KEY_RESTORED_REQUIRED'));
});

test('recusa responsabilidade ausente, campos extras e referências com segredo', () => {
  const evidence = structuredClone(template);
  evidence.responsibilities = evidence.responsibilities.filter(item => item.role !== 'INCIDENT_RESPONSE');
  evidence.responsibilities[0].escalationRef = 'token=nao-pode';
  evidence.architecture.credential = 'indevido';
  const result = validateInfrastructureEvidence(evidence, now);
  assert.ok(result.issues.includes('INFRASTRUCTURE_RESPONSIBILITY_INCIDENT_RESPONSE_MISSING'));
  assert.ok(result.issues.includes('INFRASTRUCTURE_RESPONSIBILITY_CONTACT_INVALID'));
  assert.ok(result.issues.includes('INFRASTRUCTURE_ARCHITECTURE_UNKNOWN_FIELD'));
});
