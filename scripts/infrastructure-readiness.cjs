// Validates the approved production topology and recovery evidence. It never
// connects to providers and deliberately accepts references, not credentials.
const fs = require('node:fs');
const path = require('node:path');

const REQUIRED_RESPONSIBILITIES = [
  'APPLICATION', 'DATABASE', 'BACKUP_RESTORE', 'SECURITY_SECRETS',
  'OBSERVABILITY', 'INCIDENT_RESPONSE',
];

function exactKeys(value, allowed, issue, issues) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (Object.keys(value).some(key => !allowed.includes(key))) issues.push(issue);
  return true;
}

function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)
    && Number.isFinite(new Date(value).getTime());
}

function validReference(value) {
  return typeof value === 'string' && value.length >= 3 && value.length <= 200
    && !/[\r\n?=&]/.test(value) && !/(password|senha|token|secret|segredo)/i.test(value);
}

function validateInfrastructureEvidence(evidence, now = new Date()) {
  const issues = [];
  const top = ['schemaVersion', 'status', 'environment', 'approvedAt', 'reviewDueAt', 'architecture', 'recovery', 'responsibilities'];
  if (!exactKeys(evidence, top, 'INFRASTRUCTURE_UNKNOWN_FIELD', issues)) {
    return { ok: false, issues: ['INFRASTRUCTURE_EVIDENCE_INVALID'] };
  }
  if (evidence.schemaVersion !== 1) issues.push('INFRASTRUCTURE_SCHEMA_VERSION_INVALID');
  if (evidence.status !== 'APPROVED') issues.push('INFRASTRUCTURE_NOT_APPROVED');
  if (evidence.environment !== 'PRODUCTION') issues.push('INFRASTRUCTURE_ENVIRONMENT_INVALID');
  if (!validDate(evidence.approvedAt) || !validDate(evidence.reviewDueAt)) {
    issues.push('INFRASTRUCTURE_APPROVAL_DATES_INVALID');
  } else {
    const approved = new Date(evidence.approvedAt).getTime();
    const review = new Date(evidence.reviewDueAt).getTime();
    const current = now.getTime();
    if (approved > current || review <= current || review - approved > 180 * 86_400_000) {
      issues.push('INFRASTRUCTURE_APPROVAL_EXPIRED_OR_INVALID');
    }
  }

  const architectureKeys = [
    'webReplicas', 'singleReplicaRiskAccepted', 'workerServices', 'managedPostgres',
    'postgresMajor', 'databasePubliclyAccessible', 'databaseTlsVerifyFull',
    'encryptionAtRest', 'connectionBudgetDocumented', 'secretsVault',
    'secretsVersioned', 'httpsOnly', 'externalHealthMonitoring', 'centralizedLogs',
    'logRetentionDays',
  ];
  const architecture = evidence.architecture;
  if (!exactKeys(architecture, architectureKeys, 'INFRASTRUCTURE_ARCHITECTURE_UNKNOWN_FIELD', issues)) {
    issues.push('INFRASTRUCTURE_ARCHITECTURE_INVALID');
  } else {
    if (!Number.isSafeInteger(architecture.webReplicas) || architecture.webReplicas < 1) issues.push('INFRASTRUCTURE_WEB_REPLICAS_INVALID');
    if (architecture.webReplicas === 1 && architecture.singleReplicaRiskAccepted !== true) issues.push('INFRASTRUCTURE_SINGLE_REPLICA_RISK_NOT_ACCEPTED');
    const workers = Array.isArray(architecture.workerServices) ? [...new Set(architecture.workerServices)] : [];
    for (const required of ['EMISSION', 'DOCUMENT', 'CONSULTATION']) {
      if (!workers.includes(required)) issues.push(`INFRASTRUCTURE_WORKER_${required}_MISSING`);
    }
    if (workers.some(item => !['EMISSION', 'DOCUMENT', 'CONSULTATION'].includes(item))) issues.push('INFRASTRUCTURE_WORKER_UNKNOWN');
    if (architecture.managedPostgres !== true || !Number.isSafeInteger(architecture.postgresMajor) || architecture.postgresMajor < 16) issues.push('INFRASTRUCTURE_DATABASE_UNSUPPORTED');
    for (const field of ['databaseTlsVerifyFull', 'encryptionAtRest', 'connectionBudgetDocumented', 'secretsVault', 'secretsVersioned', 'httpsOnly', 'externalHealthMonitoring', 'centralizedLogs']) {
      if (architecture[field] !== true) issues.push(`INFRASTRUCTURE_${field.replace(/[A-Z]/g, letter => `_${letter}`).toUpperCase()}_REQUIRED`);
    }
    if (architecture.databasePubliclyAccessible !== false) issues.push('INFRASTRUCTURE_DATABASE_MUST_BE_PRIVATE');
    if (!Number.isSafeInteger(architecture.logRetentionDays) || architecture.logRetentionDays < 30) issues.push('INFRASTRUCTURE_LOG_RETENTION_TOO_SHORT');
  }

  const recoveryKeys = [
    'automaticBackups', 'pointInTimeRecovery', 'retentionDays', 'crossFailureDomainCopy',
    'rpoHours', 'rtoHours', 'restoreTestedAt', 'evidenceRef', 'xmlPdfRestored',
    'encryptionKeyRestored', 'fiscalTransmissionDisabledDuringTest',
  ];
  const recovery = evidence.recovery;
  if (!exactKeys(recovery, recoveryKeys, 'INFRASTRUCTURE_RECOVERY_UNKNOWN_FIELD', issues)) {
    issues.push('INFRASTRUCTURE_RECOVERY_INVALID');
  } else {
    for (const field of ['automaticBackups', 'pointInTimeRecovery', 'crossFailureDomainCopy', 'xmlPdfRestored', 'encryptionKeyRestored', 'fiscalTransmissionDisabledDuringTest']) {
      if (recovery[field] !== true) issues.push(`INFRASTRUCTURE_RECOVERY_${field.replace(/[A-Z]/g, letter => `_${letter}`).toUpperCase()}_REQUIRED`);
    }
    if (!Number.isSafeInteger(recovery.retentionDays) || recovery.retentionDays < 7) issues.push('INFRASTRUCTURE_BACKUP_RETENTION_TOO_SHORT');
    if (typeof recovery.rpoHours !== 'number' || recovery.rpoHours <= 0 || recovery.rpoHours > 24) issues.push('INFRASTRUCTURE_RPO_INVALID');
    if (typeof recovery.rtoHours !== 'number' || recovery.rtoHours <= 0 || recovery.rtoHours > 8) issues.push('INFRASTRUCTURE_RTO_INVALID');
    if (!validDate(recovery.restoreTestedAt)) issues.push('INFRASTRUCTURE_RESTORE_DATE_INVALID');
    else {
      const age = now.getTime() - new Date(recovery.restoreTestedAt).getTime();
      if (age < 0 || age > 120 * 86_400_000) issues.push('INFRASTRUCTURE_RESTORE_TEST_EXPIRED');
    }
    if (!validReference(recovery.evidenceRef)) issues.push('INFRASTRUCTURE_RESTORE_REFERENCE_INVALID');
  }

  if (!Array.isArray(evidence.responsibilities)) issues.push('INFRASTRUCTURE_RESPONSIBILITIES_INVALID');
  else {
    const seen = new Set();
    for (const responsibility of evidence.responsibilities) {
      if (!exactKeys(responsibility, ['role', 'owner', 'escalationRef'], 'INFRASTRUCTURE_RESPONSIBILITY_UNKNOWN_FIELD', issues)) continue;
      if (!REQUIRED_RESPONSIBILITIES.includes(responsibility.role) || seen.has(responsibility.role)) issues.push('INFRASTRUCTURE_RESPONSIBILITY_ROLE_INVALID');
      seen.add(responsibility.role);
      if (!validReference(responsibility.owner) || !validReference(responsibility.escalationRef)) issues.push('INFRASTRUCTURE_RESPONSIBILITY_CONTACT_INVALID');
    }
    for (const role of REQUIRED_RESPONSIBILITIES) if (!seen.has(role)) issues.push(`INFRASTRUCTURE_RESPONSIBILITY_${role}_MISSING`);
  }
  return { ok: issues.length === 0, issues: [...new Set(issues)] };
}

function inspectInfrastructureEvidence(options) {
  const evidenceFile = options.evidenceFile || '';
  if (!path.isAbsolute(evidenceFile)) return { ok: false, issues: ['INFRASTRUCTURE_EVIDENCE_PATH_NOT_ABSOLUTE'] };
  try {
    const stat = fs.lstatSync(evidenceFile);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 2 || stat.size > 64 * 1024) {
      return { ok: false, issues: ['INFRASTRUCTURE_EVIDENCE_FILE_INVALID'] };
    }
    return validateInfrastructureEvidence(JSON.parse(fs.readFileSync(evidenceFile, 'utf8')), options.now);
  } catch {
    return { ok: false, issues: ['INFRASTRUCTURE_EVIDENCE_UNREADABLE'] };
  }
}

function infrastructureReadinessDetail(result) {
  return result.ok ? 'topologia, responsáveis e recuperação aprovados'
    : `${result.issues.length} divergência(s) de infraestrutura: ${result.issues.slice(0, 5).join(', ')}${result.issues.length > 5 ? ', ...' : ''}`;
}

if (require.main === module) {
  const result = inspectInfrastructureEvidence({ evidenceFile: process.env.INFRASTRUCTURE_EVIDENCE_FILE });
  console.log(infrastructureReadinessDetail(result));
  console.log(result.ok ? 'INFRASTRUCTURE_OK' : 'INFRASTRUCTURE_BLOCKED');
  process.exitCode = result.ok ? 0 : 1;
}

module.exports = {
  REQUIRED_RESPONSIBILITIES, validateInfrastructureEvidence, inspectInfrastructureEvidence,
  infrastructureReadinessDetail,
};
