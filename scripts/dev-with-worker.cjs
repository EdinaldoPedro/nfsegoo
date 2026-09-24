'use strict';

// Explicit local workflow: run web and the homologation worker together.
// Never enable new production transmissions from this convenience command.
const { spawn, spawnSync } = require('node:child_process');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const compile = spawnSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.worker.json'],
  { cwd: root, stdio: 'inherit' });
if (compile.error || compile.status !== 0) {
  console.error('[dev:full] O worker não compilou; o servidor web não será iniciado sem processador de emissões.');
  process.exit(compile.status || 1);
}

console.info('[dev:full] Iniciando Next e worker de homologação. Tarefas pendentes de homologação serão retomadas.');
const web = spawn(process.execPath, [path.join(root, 'node_modules/next/dist/bin/next'), 'dev'],
  { cwd: root, stdio: 'inherit', env: process.env });
const worker = spawn(process.execPath, ['--env-file=.env', '-r', path.join(root, 'scripts/register-worker.cjs'),
  path.join(root, 'dist/worker/workers/emission-worker.js')],
  { cwd: root, stdio: 'inherit', env: { ...process.env, FISCAL_WORKER_ALLOW_PRODUCTION: 'false' } });

let stopping = false;
function stopAll(code) {
  if (stopping) return;
  stopping = true;
  for (const child of [web, worker]) if (child.exitCode === null && !child.killed) child.kill('SIGTERM');
  const deadline = setTimeout(() => process.exit(code), 10_000);
  deadline.unref();
  Promise.all([web, worker].map(child => new Promise(resolve => {
    if (child.exitCode !== null) resolve(); else child.once('exit', resolve);
  }))).then(() => { clearTimeout(deadline); process.exit(code); });
}
for (const [name, child] of [['Next', web], ['worker', worker]]) {
  child.on('error', error => { console.error(`[dev:full] ${name} não iniciou: ${error.message}`); stopAll(1); });
  child.on('exit', (code, signal) => {
    if (!stopping) {
      console.error(`[dev:full] ${name} encerrou (${signal || code}). Encerrando o outro processo para não deixar a emissão sem worker.`);
      stopAll(code || 1);
    }
  });
}
process.on('SIGINT', () => stopAll(0));
process.on('SIGTERM', () => stopAll(0));
