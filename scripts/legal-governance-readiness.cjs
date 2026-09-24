// Validates legal/LGPD launch evidence against the exact application content.
// Evidence stores references and hashes only; never contracts, credentials or personal data.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const LEGAL_ARTIFACTS = [
  'app/legal-content.ts',
  'app/termos-de-uso/page.tsx',
  'app/politica-de-privacidade/page.tsx',
  'app/politica-de-cookies/page.tsx',
  'app/services/legalAcceptanceService.ts',
  'app/services/privacyService.ts',
  'app/services/securityIncidentService.ts',
];
const REQUIRED_DOCUMENTS = [
  'TERMS', 'PRIVACY_NOTICE', 'COOKIE_NOTICE', 'DATA_PROCESSING_AGREEMENT',
  'PROCESSING_RECORD', 'RETENTION_SCHEDULE', 'PRIVACY_RIGHTS_PROCEDURE',
  'INCIDENT_RESPONSE_PLAN', 'SUBPROCESSOR_REGISTER',
];
const REQUIRED_APPROVALS = ['LEGAL', 'PRIVACY', 'SECURITY'];
const REQUIRED_PROCESSORS = ['HOSTING', 'DATABASE', 'EMAIL'];

function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function normalize(content) { return content.toString('utf8').replaceAll('\r\n', '\n'); }
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
function finalVersion(value) { return validRef(value) && !/(draft|rascunho|exemplo|definir)/i.test(value); }

function calculateLegalArtifactHash(rootDir) {
  const hash = crypto.createHash('sha256');
  for (const relative of LEGAL_ARTIFACTS) {
    const absolute = path.join(rootDir, relative);
    const content = normalize(fs.readFileSync(absolute));
    hash.update(relative).update('\0').update(content).update('\0');
  }
  return { hash: hash.digest('hex'), files: LEGAL_ARTIFACTS.length };
}

function validateLegalGovernanceEvidence(evidence, options) {
  const issues = [];
  const now = options.now || new Date();
  const top = ['schemaVersion', 'status', 'environment', 'approvedAt', 'reviewDueAt', 'applicationLegalSha256', 'documents', 'approvals', 'subprocessors', 'internationalTransfers', 'responsibilities'];
  if (!exactKeys(evidence, top, 'LEGAL_UNKNOWN_FIELD', issues)) return { ok: false, issues: ['LEGAL_EVIDENCE_INVALID'] };
  if (evidence.schemaVersion !== 1) issues.push('LEGAL_SCHEMA_VERSION_INVALID');
  if (evidence.status !== 'APPROVED') issues.push('LEGAL_NOT_APPROVED');
  if (evidence.environment !== 'PRODUCTION') issues.push('LEGAL_ENVIRONMENT_INVALID');
  if (!validDate(evidence.approvedAt) || !validDate(evidence.reviewDueAt)) issues.push('LEGAL_APPROVAL_DATES_INVALID');
  else {
    const approved = new Date(evidence.approvedAt).getTime();
    const review = new Date(evidence.reviewDueAt).getTime();
    if (approved > now.getTime() || review <= now.getTime() || review - approved > 365 * 86_400_000) issues.push('LEGAL_APPROVAL_EXPIRED_OR_INVALID');
  }
  if (!/^[a-f0-9]{64}$/.test(String(evidence.applicationLegalSha256 || '')) || evidence.applicationLegalSha256 !== options.artifactHash) {
    issues.push('LEGAL_APPLICATION_HASH_MISMATCH');
  }

  if (!Array.isArray(evidence.documents)) issues.push('LEGAL_DOCUMENTS_INVALID');
  else {
    const seen = new Set();
    for (const document of evidence.documents) {
      if (!exactKeys(document, ['type', 'version', 'artifactRef'], 'LEGAL_DOCUMENT_UNKNOWN_FIELD', issues)) continue;
      if (!REQUIRED_DOCUMENTS.includes(document.type) || seen.has(document.type)) issues.push('LEGAL_DOCUMENT_TYPE_INVALID');
      seen.add(document.type);
      if (!finalVersion(document.version) || !validRef(document.artifactRef)) issues.push('LEGAL_DOCUMENT_REFERENCE_INVALID');
      if (document.type === 'TERMS' && document.version !== options.termsVersion) issues.push('LEGAL_TERMS_VERSION_MISMATCH');
      if (document.type === 'PRIVACY_NOTICE' && document.version !== options.privacyVersion) issues.push('LEGAL_PRIVACY_VERSION_MISMATCH');
    }
    for (const type of REQUIRED_DOCUMENTS) if (!seen.has(type)) issues.push(`LEGAL_DOCUMENT_${type}_MISSING`);
  }

  if (!Array.isArray(evidence.approvals)) issues.push('LEGAL_APPROVALS_INVALID');
  else {
    const seen = new Set();
    for (const approval of evidence.approvals) {
      if (!exactKeys(approval, ['role', 'approverRef', 'approvedAt', 'evidenceRef'], 'LEGAL_APPROVAL_UNKNOWN_FIELD', issues)) continue;
      if (!REQUIRED_APPROVALS.includes(approval.role) || seen.has(approval.role)) issues.push('LEGAL_APPROVAL_ROLE_INVALID');
      seen.add(approval.role);
      if (!validRef(approval.approverRef) || !validRef(approval.evidenceRef) || !validDate(approval.approvedAt)
        || new Date(approval.approvedAt).getTime() > now.getTime()) issues.push('LEGAL_APPROVAL_REFERENCE_INVALID');
    }
    for (const role of REQUIRED_APPROVALS) if (!seen.has(role)) issues.push(`LEGAL_APPROVAL_${role}_MISSING`);
  }

  if (!Array.isArray(evidence.subprocessors)) issues.push('LEGAL_SUBPROCESSORS_INVALID');
  else {
    const categories = new Set();
    for (const processor of evidence.subprocessors) {
      if (!exactKeys(processor, ['category', 'providerRef', 'countryCode', 'purposeRef', 'contractRef', 'securityReviewRef'], 'LEGAL_SUBPROCESSOR_UNKNOWN_FIELD', issues)) continue;
      if (typeof processor.category !== 'string' || !/^[A-Z_]{3,40}$/.test(processor.category) || categories.has(processor.category)) issues.push('LEGAL_SUBPROCESSOR_CATEGORY_INVALID');
      else categories.add(processor.category);
      if (![processor.providerRef, processor.purposeRef, processor.contractRef, processor.securityReviewRef].every(validRef)
        || !/^[A-Z]{2}$/.test(String(processor.countryCode || ''))) issues.push('LEGAL_SUBPROCESSOR_REFERENCE_INVALID');
    }
    for (const category of REQUIRED_PROCESSORS) if (!categories.has(category)) issues.push(`LEGAL_SUBPROCESSOR_${category}_MISSING`);
  }

  const transfers = evidence.internationalTransfers;
  if (!exactKeys(transfers, ['occurs', 'countries', 'assessmentRef', 'safeguardsRef'], 'LEGAL_TRANSFERS_UNKNOWN_FIELD', issues)) issues.push('LEGAL_TRANSFERS_INVALID');
  else {
    const countries = Array.isArray(transfers.countries) ? transfers.countries : [];
    if (typeof transfers.occurs !== 'boolean' || countries.some(country => !/^[A-Z]{2}$/.test(country))) issues.push('LEGAL_TRANSFERS_INVALID');
    if (!validRef(transfers.assessmentRef)) issues.push('LEGAL_TRANSFER_ASSESSMENT_MISSING');
    if (transfers.occurs && (!countries.length || !validRef(transfers.safeguardsRef))) issues.push('LEGAL_TRANSFER_SAFEGUARDS_MISSING');
    if (!transfers.occurs && (countries.length || transfers.safeguardsRef !== null)) issues.push('LEGAL_TRANSFER_DECLARATION_INCONSISTENT');
  }

  const responsibilities = evidence.responsibilities;
  if (!exactKeys(responsibilities, ['legalOwner', 'privacyOwner', 'securityOwner', 'rightsQueueRef', 'incidentQueueRef'], 'LEGAL_RESPONSIBILITIES_UNKNOWN_FIELD', issues)
    || !responsibilities || !Object.values(responsibilities).every(validRef)) issues.push('LEGAL_RESPONSIBILITIES_INVALID');
  return { ok: issues.length === 0, issues: [...new Set(issues)] };
}

function inspectLegalGovernanceEvidence(options) {
  if (!path.isAbsolute(options.evidenceFile || '')) return { ok: false, issues: ['LEGAL_EVIDENCE_PATH_NOT_ABSOLUTE'] };
  try {
    const stat = fs.lstatSync(options.evidenceFile);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 2 || stat.size > 128 * 1024) return { ok: false, issues: ['LEGAL_EVIDENCE_FILE_INVALID'] };
    const artifact = calculateLegalArtifactHash(options.rootDir);
    return validateLegalGovernanceEvidence(JSON.parse(fs.readFileSync(options.evidenceFile, 'utf8')), {
      artifactHash: artifact.hash, termsVersion: options.termsVersion, privacyVersion: options.privacyVersion, now: options.now,
    });
  } catch { return { ok: false, issues: ['LEGAL_EVIDENCE_UNREADABLE_OR_ARTIFACT_MISSING'] }; }
}

function legalGovernanceDetail(result) {
  return result.ok ? 'documentos, operadores, aprovações e procedimentos jurídicos compatíveis com o release'
    : `${result.issues.length} divergência(s) jurídica(s): ${result.issues.slice(0, 5).join(', ')}${result.issues.length > 5 ? ', ...' : ''}`;
}

if (require.main === module) {
  const rootDir = path.join(__dirname, '..');
  if (process.argv.includes('--fingerprint')) {
    try { console.log(calculateLegalArtifactHash(rootDir).hash); }
    catch { console.error('LEGAL_FINGERPRINT_BLOCKED'); process.exitCode = 1; }
  } else {
    const result = inspectLegalGovernanceEvidence({ rootDir, evidenceFile: process.env.LEGAL_GOVERNANCE_EVIDENCE_FILE,
      termsVersion: process.env.NEXT_PUBLIC_TERMS_VERSION, privacyVersion: process.env.NEXT_PUBLIC_PRIVACY_VERSION });
    console.log(legalGovernanceDetail(result));
    console.log(result.ok ? 'LEGAL_GOVERNANCE_OK' : 'LEGAL_GOVERNANCE_BLOCKED');
    process.exitCode = result.ok ? 0 : 1;
  }
}

module.exports = { LEGAL_ARTIFACTS, REQUIRED_DOCUMENTS, calculateLegalArtifactHash,
  validateLegalGovernanceEvidence, inspectLegalGovernanceEvidence, legalGovernanceDetail };
