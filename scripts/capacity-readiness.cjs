// Validates capacity evidence produced in an isolated staging environment.
// It does not generate traffic or accept a report from a different release.
const fs = require('node:fs');
const path = require('node:path');
const { inspectReleaseManifest } = require('./release-artifact.cjs');

const REQUIRED_SCENARIOS = [
  'AUTHENTICATED_READS', 'EMISSION_ENQUEUE_HOMOLOGATION', 'DOCUMENT_GENERATION',
  'REPORTS', 'QUEUE_RECOVERY', 'TENANT_ISOLATION',
];
const REQUIRED_FAILURE_TESTS = ['WEB_RESTART', 'EMISSION_WORKER_RESTART', 'DOCUMENT_WORKER_RESTART', 'CONSULTATION_WORKER_RESTART'];

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

function validateCapacityEvidence(evidence, options) {
  const issues = [];
  const now = options.now || new Date();
  const top = ['schemaVersion', 'status', 'environment', 'releaseId', 'testedAt', 'approvedAt', 'expiresAt', 'profile', 'workload', 'results', 'failureTests', 'approvals', 'evidenceRef'];
  if (!exactKeys(evidence, top, 'CAPACITY_UNKNOWN_FIELD', issues)) return { ok: false, issues: ['CAPACITY_EVIDENCE_INVALID'] };
  if (evidence.schemaVersion !== 1) issues.push('CAPACITY_SCHEMA_VERSION_INVALID');
  if (evidence.status !== 'APPROVED') issues.push('CAPACITY_NOT_APPROVED');
  if (evidence.environment !== 'STAGING_ISOLATED') issues.push('CAPACITY_ENVIRONMENT_INVALID');
  if (!options.expectedReleaseId || evidence.releaseId !== options.expectedReleaseId) issues.push('CAPACITY_RELEASE_MISMATCH');
  if (![evidence.testedAt, evidence.approvedAt, evidence.expiresAt].every(validDate)) issues.push('CAPACITY_DATES_INVALID');
  else {
    const tested = new Date(evidence.testedAt).getTime();
    const approved = new Date(evidence.approvedAt).getTime();
    const expires = new Date(evidence.expiresAt).getTime();
    if (tested > approved || approved > now.getTime() || expires <= now.getTime() || expires - tested > 90 * 86_400_000) issues.push('CAPACITY_EVIDENCE_EXPIRED_OR_INVALID');
  }
  if (!validRef(evidence.evidenceRef)) issues.push('CAPACITY_EVIDENCE_REFERENCE_INVALID');

  const profile = evidence.profile;
  if (!exactKeys(profile, ['webReplicas', 'emissionWorkers', 'documentWorkers', 'consultationWorkers', 'databaseTierRef', 'connectionBudget', 'companies', 'notes'], 'CAPACITY_PROFILE_UNKNOWN_FIELD', issues)) issues.push('CAPACITY_PROFILE_INVALID');
  else {
    for (const field of ['webReplicas', 'emissionWorkers', 'documentWorkers', 'consultationWorkers']) {
      if (!Number.isSafeInteger(profile[field]) || profile[field] < 1) issues.push(`CAPACITY_${field.replace(/[A-Z]/g, letter => `_${letter}`).toUpperCase()}_INVALID`);
    }
    if (!validRef(profile.databaseTierRef) || !Number.isSafeInteger(profile.connectionBudget) || profile.connectionBudget < 10) issues.push('CAPACITY_DATABASE_PROFILE_INVALID');
    if (!Number.isSafeInteger(profile.companies) || profile.companies < 25 || !Number.isSafeInteger(profile.notes) || profile.notes < 1000) issues.push('CAPACITY_DATASET_TOO_SMALL');
  }

  const workload = evidence.workload;
  if (!exactKeys(workload, ['durationMinutes', 'peakConcurrentUsers', 'totalRequests', 'syntheticDataOnly', 'productionFiscalTransmissions', 'scenarios'], 'CAPACITY_WORKLOAD_UNKNOWN_FIELD', issues)) issues.push('CAPACITY_WORKLOAD_INVALID');
  else {
    if (!finite(workload.durationMinutes, 30, 1440) || !Number.isSafeInteger(workload.peakConcurrentUsers) || workload.peakConcurrentUsers < 20
      || !Number.isSafeInteger(workload.totalRequests) || workload.totalRequests < 5000) issues.push('CAPACITY_WORKLOAD_TOO_SMALL');
    if (workload.syntheticDataOnly !== true || workload.productionFiscalTransmissions !== 0) issues.push('CAPACITY_UNSAFE_FISCAL_WORKLOAD');
    const scenarios = Array.isArray(workload.scenarios) ? new Set(workload.scenarios) : new Set();
    for (const scenario of REQUIRED_SCENARIOS) if (!scenarios.has(scenario)) issues.push(`CAPACITY_SCENARIO_${scenario}_MISSING`);
    if ([...scenarios].some(scenario => !REQUIRED_SCENARIOS.includes(scenario))) issues.push('CAPACITY_SCENARIO_UNKNOWN');
  }

  const results = evidence.results;
  const resultKeys = ['httpErrorRatePercent', 'httpP95Ms', 'httpP99Ms', 'readinessAvailabilityPercent', 'maxCpuPercent', 'maxMemoryPercent', 'maxDatabaseConnectionsPercent', 'emissionQueueP95Seconds', 'documentQueueP95Seconds', 'consultationQueueP95Seconds', 'crossTenantLeaks'];
  if (!exactKeys(results, resultKeys, 'CAPACITY_RESULTS_UNKNOWN_FIELD', issues)) issues.push('CAPACITY_RESULTS_INVALID');
  else {
    if (!finite(results.httpErrorRatePercent, 0, 1)) issues.push('CAPACITY_HTTP_ERROR_RATE_EXCEEDED');
    if (!finite(results.httpP95Ms, 0, 1500) || !finite(results.httpP99Ms, 0, 3000)) issues.push('CAPACITY_HTTP_LATENCY_EXCEEDED');
    if (!finite(results.readinessAvailabilityPercent, 99.5, 100)) issues.push('CAPACITY_AVAILABILITY_TOO_LOW');
    for (const field of ['maxCpuPercent', 'maxMemoryPercent', 'maxDatabaseConnectionsPercent']) if (!finite(results[field], 0, 80)) issues.push(`CAPACITY_${field.replace(/[A-Z]/g, letter => `_${letter}`).toUpperCase()}_EXCEEDED`);
    for (const field of ['emissionQueueP95Seconds', 'documentQueueP95Seconds', 'consultationQueueP95Seconds']) if (!finite(results[field], 0, 60)) issues.push(`CAPACITY_${field.replace(/[A-Z]/g, letter => `_${letter}`).toUpperCase()}_EXCEEDED`);
    if (results.crossTenantLeaks !== 0) issues.push('CAPACITY_TENANT_ISOLATION_FAILED');
  }

  const failureTests = Array.isArray(evidence.failureTests) ? new Set(evidence.failureTests) : new Set();
  for (const failure of REQUIRED_FAILURE_TESTS) if (!failureTests.has(failure)) issues.push(`CAPACITY_FAILURE_TEST_${failure}_MISSING`);
  if ([...failureTests].some(failure => !REQUIRED_FAILURE_TESTS.includes(failure))) issues.push('CAPACITY_FAILURE_TEST_UNKNOWN');

  if (!Array.isArray(evidence.approvals)) issues.push('CAPACITY_APPROVALS_INVALID');
  else {
    const roles = new Set();
    for (const approval of evidence.approvals) {
      if (!exactKeys(approval, ['role', 'approverRef', 'evidenceRef'], 'CAPACITY_APPROVAL_UNKNOWN_FIELD', issues)) continue;
      if (!['TECHNICAL', 'OPERATIONS'].includes(approval.role) || roles.has(approval.role)) issues.push('CAPACITY_APPROVAL_ROLE_INVALID');
      roles.add(approval.role);
      if (!validRef(approval.approverRef) || !validRef(approval.evidenceRef)) issues.push('CAPACITY_APPROVAL_REFERENCE_INVALID');
    }
    for (const role of ['TECHNICAL', 'OPERATIONS']) if (!roles.has(role)) issues.push(`CAPACITY_APPROVAL_${role}_MISSING`);
  }
  return { ok: issues.length === 0, issues: [...new Set(issues)] };
}

function inspectCapacityEvidence(options) {
  if (!path.isAbsolute(options.evidenceFile || '')) return { ok: false, issues: ['CAPACITY_EVIDENCE_PATH_NOT_ABSOLUTE'] };
  try {
    const stat = fs.lstatSync(options.evidenceFile);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 2 || stat.size > 128 * 1024) return { ok: false, issues: ['CAPACITY_EVIDENCE_FILE_INVALID'] };
    return validateCapacityEvidence(JSON.parse(fs.readFileSync(options.evidenceFile, 'utf8')), options);
  } catch { return { ok: false, issues: ['CAPACITY_EVIDENCE_UNREADABLE'] }; }
}

function capacityReadinessDetail(result) {
  return result.ok ? 'capacidade, filas, isolamento e recuperação aprovados para o release'
    : `${result.issues.length} divergência(s) de capacidade: ${result.issues.slice(0, 5).join(', ')}${result.issues.length > 5 ? ', ...' : ''}`;
}

if (require.main === module) {
  const rootDir = path.join(__dirname, '..');
  const release = inspectReleaseManifest({ rootDir, manifestFile: process.env.RELEASE_MANIFEST_FILE });
  const result = inspectCapacityEvidence({ evidenceFile: process.env.CAPACITY_EVIDENCE_FILE, expectedReleaseId: release.releaseId });
  console.log(capacityReadinessDetail(result));
  console.log(result.ok && release.ok ? 'CAPACITY_OK' : 'CAPACITY_BLOCKED');
  process.exitCode = result.ok && release.ok ? 0 : 1;
}

module.exports = { REQUIRED_SCENARIOS, REQUIRED_FAILURE_TESTS, validateCapacityEvidence, inspectCapacityEvidence, capacityReadinessDetail };
