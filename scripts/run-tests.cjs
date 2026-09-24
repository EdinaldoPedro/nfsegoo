const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const integration = process.argv[2] === 'integration';
function discover(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === 'integration' && !integration ? [] : discover(file);
    return /\.test\.(cjs|mjs)$/.test(entry.name) ? [file] : [];
  });
}
const files = integration ? discover(path.join(root, 'tests', 'integration')) : [
  ...discover(path.join(root, 'tests')),
  path.join(root, 'app/services/emissor/fiscal/FiscalMath.test.mjs'),
  path.join(root, 'app/services/pdf/DanfseGenerator.test.cjs'),
];
if (!files.length) { console.error('Nenhum teste encontrado.'); process.exit(1); }
// Integration files share one deliberately isolated PostgreSQL database. Run the
// files serially while preserving each file's own concurrency tests; otherwise a
// growing suite can exhaust Prisma's transaction-pool wait before the assertion
// under test even starts.
const args = ['-r', path.join(__dirname, 'register-typescript-tests.cjs'), '--test',
  ...(integration ? ['--test-concurrency=1'] : []), ...files];
const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit', env: process.env });
process.exit(result.status ?? 1);
