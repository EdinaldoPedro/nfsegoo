// Validates the human acceptance record for the exact release and test plan.
// It never executes cases or turns missing evidence into an approval.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { inspectReleaseManifest } = require('./release-artifact.cjs');

const REQUIRED_APPROVAL_ROLES = ['PRODUCT_OWNER', 'TECHNICAL', 'OPERATIONS'];

function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function normalizePlan(value) { return value.replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '').trimEnd() + '\n'; }
function validDate(value) { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(new Date(value).getTime()); }
function validRef(value) {
  return typeof value === 'string' && value.length >= 3 && value.length <= 240
    && !/[\r\n?=&]/.test(value) && !/(password|senha|token|secret|segredo)/i.test(value);
}
function exactKeys(value, allowed, issue, issues) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (Object.keys(value).some(key => !allowed.includes(key))) issues.push(issue);
  return true;
}

function parseManualTestPlan(content) {
  const normalized = normalizePlan(content);
  const ids = [...normalized.matchAll(/^\|\s*([A-Z]{1,4}\d{2})\s*\|/gm)].map(match => match[1]);
  const counts = new Map();
  for (const id of ids) counts.set(id, (counts.get(id) || 0) + 1);
  return { fingerprint: sha256(normalized), caseIds: ids, duplicates: [...counts].filter(([, count]) => count > 1).map(([id]) => id) };
}

function validateManualAcceptanceEvidence(evidence, options) {
  const issues = [];
  const now = options.now || new Date();
  const top = ['schemaVersion', 'status', 'environment', 'releaseId', 'planFingerprint', 'executedAt', 'approvedAt', 'expiresAt', 'caseResults', 'approvals', 'evidenceRef'];
  if (!exactKeys(evidence, top, 'ACCEPTANCE_UNKNOWN_FIELD', issues)) return { ok: false, issues: ['ACCEPTANCE_EVIDENCE_INVALID'] };
  if (evidence.schemaVersion !== 1) issues.push('ACCEPTANCE_SCHEMA_VERSION_INVALID');
  if (evidence.status !== 'APPROVED') issues.push('ACCEPTANCE_NOT_APPROVED');
  if (evidence.environment !== 'STAGING_RELEASE_CANDIDATE') issues.push('ACCEPTANCE_ENVIRONMENT_INVALID');
  if (!options.expectedReleaseId || evidence.releaseId !== options.expectedReleaseId) issues.push('ACCEPTANCE_RELEASE_MISMATCH');
  if (!options.expectedPlanFingerprint || evidence.planFingerprint !== options.expectedPlanFingerprint) issues.push('ACCEPTANCE_PLAN_MISMATCH');
  if (!validRef(evidence.evidenceRef)) issues.push('ACCEPTANCE_EVIDENCE_REFERENCE_INVALID');
  if (![evidence.executedAt, evidence.approvedAt, evidence.expiresAt].every(validDate)) issues.push('ACCEPTANCE_DATES_INVALID');
  else {
    const executed = new Date(evidence.executedAt).getTime();
    const approved = new Date(evidence.approvedAt).getTime();
    const expires = new Date(evidence.expiresAt).getTime();
    if (executed > approved || approved > now.getTime() || expires <= now.getTime() || expires - executed > 30 * 86_400_000) issues.push('ACCEPTANCE_EVIDENCE_EXPIRED_OR_INVALID');
  }

  const required = new Set(options.requiredCaseIds || []);
  if (required.size === 0 || required.size !== (options.requiredCaseIds || []).length) issues.push('ACCEPTANCE_PLAN_CASES_INVALID');
  if (!Array.isArray(evidence.caseResults)) issues.push('ACCEPTANCE_CASE_RESULTS_INVALID');
  else {
    const received = new Set();
    for (const result of evidence.caseResults) {
      if (!exactKeys(result, ['id', 'status', 'executedByRef', 'evidenceRef'], 'ACCEPTANCE_CASE_UNKNOWN_FIELD', issues)) continue;
      if (!required.has(result.id)) issues.push('ACCEPTANCE_CASE_UNKNOWN');
      if (received.has(result.id)) issues.push('ACCEPTANCE_CASE_DUPLICATED');
      received.add(result.id);
      if (result.status !== 'PASSED') issues.push(`ACCEPTANCE_CASE_${result.id || 'INVALID'}_NOT_PASSED`);
      if (!validRef(result.executedByRef) || !validRef(result.evidenceRef)) issues.push('ACCEPTANCE_CASE_REFERENCE_INVALID');
    }
    for (const id of required) if (!received.has(id)) issues.push(`ACCEPTANCE_CASE_${id}_MISSING`);
  }

  if (!Array.isArray(evidence.approvals)) issues.push('ACCEPTANCE_APPROVALS_INVALID');
  else {
    const roles = new Set();
    const approvers = new Set();
    for (const approval of evidence.approvals) {
      if (!exactKeys(approval, ['role', 'approverRef', 'evidenceRef'], 'ACCEPTANCE_APPROVAL_UNKNOWN_FIELD', issues)) continue;
      if (!REQUIRED_APPROVAL_ROLES.includes(approval.role) || roles.has(approval.role)) issues.push('ACCEPTANCE_APPROVAL_ROLE_INVALID');
      roles.add(approval.role);
      if (!validRef(approval.approverRef) || !validRef(approval.evidenceRef)) issues.push('ACCEPTANCE_APPROVAL_REFERENCE_INVALID');
      if (approvers.has(approval.approverRef)) issues.push('ACCEPTANCE_APPROVERS_NOT_SEGREGATED');
      approvers.add(approval.approverRef);
    }
    for (const role of REQUIRED_APPROVAL_ROLES) if (!roles.has(role)) issues.push(`ACCEPTANCE_APPROVAL_${role}_MISSING`);
  }
  return { ok: issues.length === 0, issues: [...new Set(issues)] };
}

function inspectManualAcceptanceEvidence(options) {
  if (!path.isAbsolute(options.evidenceFile || '') || !path.isAbsolute(options.planFile || '')) return { ok: false, issues: ['ACCEPTANCE_PATH_NOT_ABSOLUTE'] };
  try {
    const evidenceStat = fs.lstatSync(options.evidenceFile);
    const planStat = fs.lstatSync(options.planFile);
    if (!evidenceStat.isFile() || evidenceStat.isSymbolicLink() || evidenceStat.size < 2 || evidenceStat.size > 2 * 1024 * 1024
      || !planStat.isFile() || planStat.isSymbolicLink() || planStat.size < 2 || planStat.size > 1024 * 1024) return { ok: false, issues: ['ACCEPTANCE_FILE_INVALID'] };
    const plan = parseManualTestPlan(fs.readFileSync(options.planFile, 'utf8'));
    if (plan.caseIds.length === 0 || plan.duplicates.length > 0) return { ok: false, issues: ['ACCEPTANCE_PLAN_CASES_INVALID'] };
    return validateManualAcceptanceEvidence(JSON.parse(fs.readFileSync(options.evidenceFile, 'utf8')), {
      ...options, expectedPlanFingerprint: plan.fingerprint, requiredCaseIds: plan.caseIds,
    });
  } catch { return { ok: false, issues: ['ACCEPTANCE_EVIDENCE_UNREADABLE'] }; }
}

function manualAcceptanceDetail(result) {
  return result.ok ? 'aceite manual completo, segregado e vinculado ao release e roteiro atuais'
    : `${result.issues.length} divergência(s) de aceite: ${result.issues.slice(0, 5).join(', ')}${result.issues.length > 5 ? ', ...' : ''}`;
}

if (require.main === module) {
  const rootDir = path.join(__dirname, '..');
  const release = inspectReleaseManifest({ rootDir, manifestFile: process.env.RELEASE_MANIFEST_FILE });
  const result = inspectManualAcceptanceEvidence({
    evidenceFile: process.env.MANUAL_ACCEPTANCE_EVIDENCE_FILE,
    planFile: path.join(rootDir, 'docs', 'TESTES-MANUAIS.md'), expectedReleaseId: release.releaseId,
  });
  console.log(manualAcceptanceDetail(result));
  console.log(result.ok && release.ok ? 'ACCEPTANCE_OK' : 'ACCEPTANCE_BLOCKED');
  process.exitCode = result.ok && release.ok ? 0 : 1;
}

module.exports = { REQUIRED_APPROVAL_ROLES, parseManualTestPlan, validateManualAcceptanceEvidence, inspectManualAcceptanceEvidence, manualAcceptanceDetail };
