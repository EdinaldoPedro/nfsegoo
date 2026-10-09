const path = require('node:path');
const {
  calculateFiscalArtifactHash, fiscalHomologationDetail, fiscalHomologationWaiverDetail,
  inspectFiscalHomologationEvidence, inspectFiscalHomologationWaiver,
} = require('../app/utils/fiscal-homologation-evidence.ts');

const rootDir = path.join(__dirname, '..');
if (process.argv.includes('--fingerprint')) {
  console.log(calculateFiscalArtifactHash(rootDir).hash);
  process.exit(0);
}

const result = inspectFiscalHomologationEvidence({
  rootDir,
  evidenceFile: process.env.FISCAL_HOMOLOGATION_EVIDENCE_FILE,
});
if (result.ok) {
  console.log(fiscalHomologationDetail(result));
  console.log('FISCAL_HOMOLOGATION_OK');
  process.exit(0);
}

const waiver = inspectFiscalHomologationWaiver({
  artifactHash: result.artifactHash,
  configuredArtifactHash: process.env.FISCAL_HOMOLOGATION_WAIVER_ARTIFACT_HASH,
  mode: process.env.FISCAL_HOMOLOGATION_WAIVER_MODE,
  issuedAt: process.env.FISCAL_HOMOLOGATION_WAIVER_ISSUED_AT,
  approvedBy: process.env.FISCAL_HOMOLOGATION_WAIVER_APPROVED_BY,
  reason: process.env.FISCAL_HOMOLOGATION_WAIVER_REASON,
});
console.log(waiver.ok ? fiscalHomologationWaiverDetail(waiver) : fiscalHomologationDetail(result));
console.log(waiver.ok ? 'FISCAL_HOMOLOGATION_WAIVER_ACTIVE' : 'FISCAL_HOMOLOGATION_BLOCKED');
process.exitCode = waiver.ok ? 0 : 1;
