// Validates the decision to move from a controlled pilot to public registration.
// It does not infer business approval from application counters alone.
const fs = require('node:fs');
const path = require('node:path');
const { inspectReleaseManifest } = require('./release-artifact.cjs');

const REQUIRED_APPROVAL_ROLES = ['PRODUCT_OWNER', 'TECHNICAL', 'OPERATIONS'];

function exactKeys(value, allowed, issue, issues) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (Object.keys(value).some(key => !allowed.includes(key))) issues.push(issue);
  return true;
}
function validDate(value) { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(new Date(value).getTime()); }
function validRef(value) {
  return typeof value === 'string' && value.length >= 3 && value.length <= 240
    && !/[\r\n?=&]/.test(value) && !/(password|senha|token|secret|segredo)/i.test(value);
}
function finite(value, minimum, maximum) { return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum; }

function validatePublicLaunchEvidence(evidence, options) {
  const issues = [];
  const now = options.now || new Date();
  const top = ['schemaVersion', 'status', 'releaseId', 'pilotStartedAt', 'pilotEndedAt', 'approvedAt', 'expiresAt', 'sample', 'metrics', 'approvals', 'evidenceRef'];
  if (!exactKeys(evidence, top, 'PUBLIC_LAUNCH_UNKNOWN_FIELD', issues)) return { ok: false, issues: ['PUBLIC_LAUNCH_EVIDENCE_INVALID'] };
  if (evidence.schemaVersion !== 1) issues.push('PUBLIC_LAUNCH_SCHEMA_VERSION_INVALID');
  if (evidence.status !== 'APPROVED') issues.push('PUBLIC_LAUNCH_NOT_APPROVED');
  if (!options.expectedReleaseId || evidence.releaseId !== options.expectedReleaseId) issues.push('PUBLIC_LAUNCH_RELEASE_MISMATCH');
  if (![evidence.pilotStartedAt, evidence.pilotEndedAt, evidence.approvedAt, evidence.expiresAt].every(validDate)) issues.push('PUBLIC_LAUNCH_DATES_INVALID');
  else {
    const started = new Date(evidence.pilotStartedAt).getTime();
    const ended = new Date(evidence.pilotEndedAt).getTime();
    const approved = new Date(evidence.approvedAt).getTime();
    const expires = new Date(evidence.expiresAt).getTime();
    const duration = ended - started;
    if (duration < 14 * 86_400_000 || duration > 90 * 86_400_000) issues.push('PUBLIC_LAUNCH_PILOT_DURATION_INVALID');
    if (ended > approved || approved > now.getTime() || expires <= now.getTime() || expires - approved > 30 * 86_400_000) issues.push('PUBLIC_LAUNCH_EVIDENCE_EXPIRED_OR_INVALID');
  }
  if (!validRef(evidence.evidenceRef)) issues.push('PUBLIC_LAUNCH_EVIDENCE_REFERENCE_INVALID');

  const sample = evidence.sample;
  if (!exactKeys(sample, ['activeCompanies', 'customersWithCompletedFlow', 'successfulProductionEmissions', 'supportInteractionsReviewed'], 'PUBLIC_LAUNCH_SAMPLE_UNKNOWN_FIELD', issues)) issues.push('PUBLIC_LAUNCH_SAMPLE_INVALID');
  else if (!Number.isSafeInteger(sample.activeCompanies) || sample.activeCompanies < 3
    || !Number.isSafeInteger(sample.customersWithCompletedFlow) || sample.customersWithCompletedFlow < 3
    || sample.customersWithCompletedFlow > sample.activeCompanies
    || !Number.isSafeInteger(sample.successfulProductionEmissions) || sample.successfulProductionEmissions < 10
    || !Number.isSafeInteger(sample.supportInteractionsReviewed) || sample.supportInteractionsReviewed < 1) issues.push('PUBLIC_LAUNCH_SAMPLE_TOO_SMALL');

  const metrics = evidence.metrics;
  const metricKeys = ['availabilityPercent', 'httpErrorRatePercent', 'crossTenantIncidents', 'duplicateEmissionIncidents', 'documentLossIncidents', 'unresolvedSeverityOneOrTwo', 'openManualReconciliations', 'highPrioritySupportBacklog', 'supportMedianFirstResponseHours', 'fiscalFailuresReviewed'];
  if (!exactKeys(metrics, metricKeys, 'PUBLIC_LAUNCH_METRICS_UNKNOWN_FIELD', issues)) issues.push('PUBLIC_LAUNCH_METRICS_INVALID');
  else {
    if (!finite(metrics.availabilityPercent, 99.5, 100)) issues.push('PUBLIC_LAUNCH_AVAILABILITY_TOO_LOW');
    if (!finite(metrics.httpErrorRatePercent, 0, 1)) issues.push('PUBLIC_LAUNCH_ERROR_RATE_TOO_HIGH');
    for (const field of ['crossTenantIncidents', 'duplicateEmissionIncidents', 'documentLossIncidents', 'unresolvedSeverityOneOrTwo', 'openManualReconciliations', 'highPrioritySupportBacklog']) {
      if (metrics[field] !== 0) issues.push(`PUBLIC_LAUNCH_${field.replace(/[A-Z]/g, letter => `_${letter}`).toUpperCase()}_OPEN`);
    }
    if (!finite(metrics.supportMedianFirstResponseHours, 0, 24)) issues.push('PUBLIC_LAUNCH_SUPPORT_RESPONSE_TOO_SLOW');
    if (metrics.fiscalFailuresReviewed !== true) issues.push('PUBLIC_LAUNCH_FISCAL_REVIEW_INCOMPLETE');
  }

  if (!Array.isArray(evidence.approvals)) issues.push('PUBLIC_LAUNCH_APPROVALS_INVALID');
  else {
    const roles = new Set();
    const approvers = new Set();
    for (const approval of evidence.approvals) {
      if (!exactKeys(approval, ['role', 'approverRef', 'evidenceRef'], 'PUBLIC_LAUNCH_APPROVAL_UNKNOWN_FIELD', issues)) continue;
      if (!REQUIRED_APPROVAL_ROLES.includes(approval.role) || roles.has(approval.role)) issues.push('PUBLIC_LAUNCH_APPROVAL_ROLE_INVALID');
      roles.add(approval.role);
      if (!validRef(approval.approverRef) || !validRef(approval.evidenceRef)) issues.push('PUBLIC_LAUNCH_APPROVAL_REFERENCE_INVALID');
      if (approvers.has(approval.approverRef)) issues.push('PUBLIC_LAUNCH_APPROVERS_NOT_SEGREGATED');
      approvers.add(approval.approverRef);
    }
    for (const role of REQUIRED_APPROVAL_ROLES) if (!roles.has(role)) issues.push(`PUBLIC_LAUNCH_APPROVAL_${role}_MISSING`);
  }
  return { ok: issues.length === 0, issues: [...new Set(issues)] };
}

function inspectPublicLaunchEvidence(options) {
  if (!path.isAbsolute(options.evidenceFile || '')) return { ok: false, issues: ['PUBLIC_LAUNCH_EVIDENCE_PATH_NOT_ABSOLUTE'] };
  try {
    const stat = fs.lstatSync(options.evidenceFile);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 2 || stat.size > 256 * 1024) return { ok: false, issues: ['PUBLIC_LAUNCH_EVIDENCE_FILE_INVALID'] };
    return validatePublicLaunchEvidence(JSON.parse(fs.readFileSync(options.evidenceFile, 'utf8')), options);
  } catch { return { ok: false, issues: ['PUBLIC_LAUNCH_EVIDENCE_UNREADABLE'] }; }
}

function publicLaunchDetail(result) {
  return result.ok ? 'saída do piloto e abertura pública aprovadas para o release atual'
    : `${result.issues.length} divergência(s) para abertura pública: ${result.issues.slice(0, 5).join(', ')}${result.issues.length > 5 ? ', ...' : ''}`;
}

if (require.main === module) {
  const rootDir = path.join(__dirname, '..');
  const release = inspectReleaseManifest({ rootDir, manifestFile: process.env.RELEASE_MANIFEST_FILE });
  const result = inspectPublicLaunchEvidence({ evidenceFile: process.env.PUBLIC_LAUNCH_EVIDENCE_FILE, expectedReleaseId: release.releaseId });
  console.log(publicLaunchDetail(result));
  console.log(result.ok && release.ok ? 'PUBLIC_LAUNCH_OK' : 'PUBLIC_LAUNCH_BLOCKED');
  process.exitCode = result.ok && release.ok ? 0 : 1;
}

module.exports = { REQUIRED_APPROVAL_ROLES, validatePublicLaunchEvidence, inspectPublicLaunchEvidence, publicLaunchDetail };
