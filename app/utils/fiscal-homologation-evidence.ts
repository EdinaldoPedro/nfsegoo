import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const REQUIRED_FISCAL_HOMOLOGATION_SCENARIOS = [
  'EMISSAO_PJ',
  'EMISSAO_PF',
  'CONSULTA_AUTORIZADA',
  'REJEICAO_FISCAL',
  'CANCELAMENTO',
  'XML_PDF',
  'RETOMADA_SEM_DUPLICIDADE',
  'REGIME_MEI',
  'REGIME_SIMPLES',
  'REGIME_LUCRO_PRESUMIDO',
] as const;

const DEFAULT_ARTIFACT_PATHS = [
  'app/api/notas',
  'app/services/emissor',
  'app/services/dpsSequenceStore.ts',
  'app/services/durableEmissionWorker.ts',
  'app/services/emissaoJobService.ts',
  'app/services/emissionLeaseService.ts',
  'app/services/fiscalNoteService.ts',
  'app/services/fiscalNoteWorker.ts',
  'app/services/pdf/DanfseGenerator.ts',
  'app/services/pdf/NfsePortalDownloader.ts',
  'app/utils/cnpj.ts',
  'app/utils/dps-identity.ts',
  'app/utils/emission-confirmation.ts',
  'app/utils/emission-intent.ts',
  'app/utils/emission-outcome.ts',
  'app/utils/fiscal-identifiers.ts',
  'app/utils/fiscal-homologation-evidence.ts',
  'app/utils/fiscal-operation-state.ts',
  'app/utils/regime-tributario.ts',
  'resources/fiscal',
  'workers/emission-worker.ts',
] as const;

type EvidenceIssue = { code: string; field?: string };
export type FiscalHomologationResult = {
  ok: boolean;
  issues: EvidenceIssue[];
  artifactHash: string;
  approvedAt?: string;
  expiresAt?: string;
};

function collectFiles(rootDir: string, relativeEntry: string, output: string[]) {
  const absolute = path.resolve(rootDir, relativeEntry);
  if (!absolute.startsWith(path.resolve(rootDir) + path.sep) || !fs.existsSync(absolute)) return;
  const stat = fs.lstatSync(absolute);
  if (stat.isSymbolicLink()) return;
  if (stat.isFile()) {
    if (/\.test\./i.test(absolute) || !/\.(?:ts|json|xsd|pem)$/i.test(absolute)) return;
    output.push(path.relative(rootDir, absolute).replaceAll(path.sep, '/')); return;
  }
  if (!stat.isDirectory()) return;
  for (const child of fs.readdirSync(absolute).sort()) collectFiles(rootDir, path.join(relativeEntry, child), output);
}

export function calculateFiscalArtifactHash(rootDir: string, artifactPaths: readonly string[] = DEFAULT_ARTIFACT_PATHS) {
  const files: string[] = [];
  for (const entry of artifactPaths) collectFiles(rootDir, entry, files);
  const hash = crypto.createHash('sha256');
  for (const relative of [...new Set(files)].sort()) {
    const content = fs.readFileSync(path.resolve(rootDir, relative)).toString('utf8').replace(/\r\n/g, '\n');
    hash.update(relative).update('\0').update(content).update('\0');
  }
  return { hash: hash.digest('hex'), files };
}

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[]) {
  return Object.keys(value).every(key => allowed.includes(key));
}

function text(value: unknown, minimum = 1, maximum = 200) {
  return typeof value === 'string' && value.trim() === value && value.length >= minimum && value.length <= maximum &&
    ![...value].some(character => character.charCodeAt(0) < 32);
}

function reference(value: unknown) {
  return text(value, 8, 200) && !/\s|:\/\/|[?#@]/.test(value as string);
}

function date(value: unknown) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function issue(issues: EvidenceIssue[], code: string, field?: string) { issues.push({ code, ...(field ? { field } : {}) }); }

export function validateFiscalHomologationManifest(
  manifest: unknown,
  artifactHash: string,
  now = new Date(),
): FiscalHomologationResult {
  const issues: EvidenceIssue[] = [];
  if (!object(manifest) || !exactKeys(manifest, [
    'schemaVersion', 'status', 'portal', 'environment', 'fiscalArtifactHash', 'reportSha256',
    'approvedAt', 'expiresAt', 'approvers', 'scenarios',
  ])) {
    return { ok: false, issues: [{ code: 'INVALID_MANIFEST_SHAPE' }], artifactHash };
  }

  if (manifest.schemaVersion !== 1) issue(issues, 'INVALID_SCHEMA_VERSION', 'schemaVersion');
  if (manifest.status !== 'APPROVED') issue(issues, 'EVIDENCE_NOT_APPROVED', 'status');
  if (manifest.portal !== 'NFS_E_PADRAO_NACIONAL') issue(issues, 'INVALID_PORTAL', 'portal');
  if (manifest.environment !== 'HOMOLOGACAO') issue(issues, 'INVALID_ENVIRONMENT', 'environment');
  if (!/^[a-f0-9]{64}$/.test(String(manifest.fiscalArtifactHash || '')) || manifest.fiscalArtifactHash !== artifactHash) {
    issue(issues, 'FISCAL_ARTIFACT_HASH_MISMATCH', 'fiscalArtifactHash');
  }
  if (!/^[a-f0-9]{64}$/.test(String(manifest.reportSha256 || ''))) issue(issues, 'INVALID_REPORT_HASH', 'reportSha256');

  const approvedAt = date(manifest.approvedAt);
  const expiresAt = date(manifest.expiresAt);
  const maximumAge = 180 * 24 * 60 * 60 * 1000;
  if (!approvedAt || approvedAt.getTime() > now.getTime() || now.getTime() - approvedAt.getTime() > maximumAge) {
    issue(issues, 'APPROVAL_DATE_INVALID_OR_STALE', 'approvedAt');
  }
  if (!expiresAt || expiresAt.getTime() <= now.getTime() || (approvedAt && expiresAt.getTime() - approvedAt.getTime() > maximumAge)) {
    issue(issues, 'EVIDENCE_EXPIRED_OR_TOO_LONG', 'expiresAt');
  }

  const approvers = Array.isArray(manifest.approvers) ? manifest.approvers : [];
  const roles = new Map<string, string>();
  const approverNames = new Set<string>();
  for (const [index, value] of approvers.entries()) {
    if (!object(value) || !exactKeys(value, ['role', 'name', 'approvalRef']) ||
        !['TECNICO', 'FISCAL'].includes(String(value.role)) || !text(value.name, 3, 120) || !reference(value.approvalRef)) {
      issue(issues, 'INVALID_APPROVER', `approvers.${index}`); continue;
    }
    if (roles.has(String(value.role))) issue(issues, 'DUPLICATE_APPROVER_ROLE', `approvers.${index}`);
    roles.set(String(value.role), String(value.approvalRef));
    approverNames.add(String(value.name).trim().toLocaleLowerCase('pt-BR'));
  }
  for (const role of ['TECNICO', 'FISCAL']) if (!roles.has(role)) issue(issues, 'MISSING_APPROVER_ROLE', role);
  if (roles.size === 2 && roles.get('TECNICO') === roles.get('FISCAL')) issue(issues, 'APPROVALS_NOT_SEGREGATED', 'approvers');
  if (roles.size === 2 && approverNames.size !== 2) issue(issues, 'APPROVERS_NOT_DISTINCT', 'approvers');

  const scenarios = Array.isArray(manifest.scenarios) ? manifest.scenarios : [];
  const byId = new Map<string, Record<string, unknown>>();
  for (const [index, value] of scenarios.entries()) {
    if (!object(value) || !exactKeys(value, ['id', 'status', 'executedAt', 'evidenceRef']) ||
        !text(value.id, 3, 80) || value.status !== 'PASSED' || !date(value.executedAt) || !reference(value.evidenceRef)) {
      issue(issues, 'INVALID_SCENARIO', `scenarios.${index}`); continue;
    }
    if (byId.has(String(value.id))) issue(issues, 'DUPLICATE_SCENARIO', String(value.id));
    byId.set(String(value.id), value);
    const executedAt = date(value.executedAt)!;
    if (executedAt.getTime() > now.getTime() || (approvedAt && executedAt.getTime() > approvedAt.getTime())) {
      issue(issues, 'SCENARIO_DATE_INVALID', String(value.id));
    }
  }
  for (const id of REQUIRED_FISCAL_HOMOLOGATION_SCENARIOS) if (!byId.has(id)) issue(issues, 'MISSING_SCENARIO', id);

  return {
    ok: issues.length === 0,
    issues,
    artifactHash,
    ...(approvedAt ? { approvedAt: approvedAt.toISOString() } : {}),
    ...(expiresAt ? { expiresAt: expiresAt.toISOString() } : {}),
  };
}

export function inspectFiscalHomologationEvidence(options: {
  rootDir: string;
  evidenceFile?: string;
  now?: Date;
  artifactPaths?: readonly string[];
}): FiscalHomologationResult {
  const artifact = calculateFiscalArtifactHash(options.rootDir, options.artifactPaths);
  if (!artifact.files.length) return { ok: false, issues: [{ code: 'FISCAL_ARTIFACT_SET_EMPTY' }], artifactHash: artifact.hash };
  const file = options.evidenceFile || '';
  if (!path.isAbsolute(file)) return { ok: false, issues: [{ code: 'EVIDENCE_FILE_MUST_BE_ABSOLUTE' }], artifactHash: artifact.hash };
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 2 || stat.size > 64 * 1024) {
      return { ok: false, issues: [{ code: 'EVIDENCE_FILE_INVALID' }], artifactHash: artifact.hash };
    }
    return validateFiscalHomologationManifest(JSON.parse(fs.readFileSync(file, 'utf8')), artifact.hash, options.now);
  } catch {
    return { ok: false, issues: [{ code: 'EVIDENCE_FILE_UNREADABLE' }], artifactHash: artifact.hash };
  }
}

export function fiscalHomologationDetail(result: FiscalHomologationResult) {
  if (result.ok) return `homologação fiscal aprovada até ${result.expiresAt}`;
  const summary = result.issues.slice(0, 5).map(item => `${item.code}${item.field ? `:${item.field}` : ''}`).join(', ');
  return `${result.issues.length} pendência(s) de homologação: ${summary}${result.issues.length > 5 ? ', ...' : ''}`;
}
