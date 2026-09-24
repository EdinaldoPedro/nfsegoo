const path = require('node:path');
const {
  calculateFiscalArtifactHash, fiscalHomologationDetail, inspectFiscalHomologationEvidence,
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
console.log(fiscalHomologationDetail(result));
console.log(result.ok ? 'FISCAL_HOMOLOGATION_OK' : 'FISCAL_HOMOLOGATION_BLOCKED');
process.exitCode = result.ok ? 0 : 1;
