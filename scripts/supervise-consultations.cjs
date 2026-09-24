'use strict';

const { spawn, spawnSync } = require('node:child_process');
const { existsSync } = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const workerFile = path.join(root, 'dist', 'worker', 'workers', 'consultation-worker.js');
const registerFile = path.join(root, 'scripts', 'register-worker.cjs');
const local = process.argv.slice(2).includes('--local');
let stopping = false;
let child = null;
let restartTimer = null;
let failures = 0;

function restartDelayMs(count) { return Math.min(30_000, 1_000 * 2 ** Math.min(Math.max(count - 1, 0), 5)); }

function start() {
  if (stopping) return;
  const args = [...(local ? ['--env-file=.env'] : []), '-r', registerFile, workerFile];
  const started = Date.now();
  child = spawn(process.execPath, args, { cwd: root, env: process.env, stdio: 'inherit', windowsHide: true });
  child.once('error', error => {
    console.error('[consultation-supervisor] Falha ao iniciar o processo:', error.message);
  });
  child.once('exit', (code, signal) => {
    child = null;
    if (stopping) return;
    failures = Date.now() - started > 60_000 ? 1 : failures + 1;
    const delay = restartDelayMs(failures);
    console.error(`[consultation-supervisor] Worker encerrou (${signal ?? code ?? 'desconhecido'}). Reinício em ${delay / 1000}s.`);
    restartTimer = setTimeout(start, delay);
  });
}

function shutdown() {
  if (stopping) return;
  stopping = true;
  if (restartTimer) clearTimeout(restartTimer);
  if (child) child.kill('SIGTERM');
}

function main() {
  if (local) {
    if (!existsSync(path.join(root, '.env'))) throw new Error('Arquivo .env local ausente.');
    console.info('[consultation-supervisor] Compilando worker de consultas; o build do site não será executado.');
    const compiler = path.join(root, 'node_modules', 'typescript', 'bin', 'tsc');
    const result = spawnSync(process.execPath, [compiler, '-p', 'tsconfig.worker.json'], { cwd: root, env: process.env, stdio: 'inherit', windowsHide: true });
    if (result.status !== 0) throw new Error('Compilação do worker falhou. Nenhuma consulta foi iniciada.');
  }
  if (!existsSync(workerFile)) throw new Error('Worker compilado ausente. Execute npm run worker:compile antes de iniciar o serviço.');
  console.info(`[consultation-supervisor] Supervisão iniciada (${local ? 'local' : 'serviço'}). Somente consultas fiscais GET; sem emissão ou cancelamento.`);
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  start();
}

if (require.main === module) {
  try { main(); }
  catch (error) { console.error('[consultation-supervisor]', error.message); process.exitCode = 1; }
}

module.exports = { restartDelayMs };
