// Clean, single-command release build. Run only on a disposable release runner.
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { currentNpmVersion, pinnedToolchain, runNpm } = require('./release-artifact.cjs');

const root = path.join(__dirname, '..');
const toolchain = pinnedToolchain(root);
if (process.versions.node !== toolchain.node || currentNpmVersion(root) !== toolchain.npm) {
  console.error(`RELEASE_BUILD_BLOCKED: use Node ${toolchain.node} e npm ${toolchain.npm}.`);
  process.exit(1);
}
const git = spawnSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], { cwd: root, encoding: 'utf8', windowsHide: true });
if (git.status !== 0 || git.stdout.trim()) {
  console.error('RELEASE_BUILD_BLOCKED: faça commit de todo o código antes de construir.');
  process.exit(1);
}
for (const output of ['.next', path.join('dist', 'worker'), path.join('dist', 'release-manifest.json')]) {
  if (fs.existsSync(path.join(root, output))) {
    console.error(`RELEASE_BUILD_BLOCKED: saída anterior encontrada em ${output}; use um checkout descartável limpo.`);
    process.exit(1);
  }
}

const steps = [
  ['ci'],
  ['exec', '--', 'prisma', 'generate'],
  ['run', 'test:unit'],
  ['run', 'typecheck'],
  ['run', 'worker:typecheck'],
  ['run', 'lint'],
  ['run', 'build'],
  ['run', 'worker:compile'],
  ['run', 'release:manifest'],
];
for (const args of steps) {
  const result = runNpm(root, args, { stdio: 'inherit', env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' } });
  if (result.status !== 0) {
    console.error(`RELEASE_BUILD_BLOCKED: etapa npm ${args.join(' ')} falhou.`);
    process.exit(result.status || 1);
  }
}
console.log('RELEASE_BUILD_OK: artefatos web e worker foram gerados e selados juntos.');
