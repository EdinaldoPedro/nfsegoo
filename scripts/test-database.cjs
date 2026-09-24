// Creates/reuses an isolated local QA database. Never migrates DATABASE_URL's
// original database and never runs a web build or a fiscal worker.
const { randomUUID } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { PrismaClient } = require('@prisma/client');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const qaPattern = /^nfsegoo_qa_[0-9]{8}_[a-f0-9]{12}$/;

async function main() {
  const source = new URL(process.env.DATABASE_URL || '');
  if (!['localhost', '127.0.0.1', '[::1]'].includes(source.hostname)) throw new Error('Apenas PostgreSQL local é permitido.');
  const args = process.argv.slice(2);
  const dockerBootstrap = args[0] === '--bootstrap-docker';
  if (dockerBootstrap) args.shift();
  if (args.length && (args.length !== 2 || args[0] !== '--reuse' || !qaPattern.test(args[1]))) throw new Error('Argumentos inválidos para banco de testes.');
  const database = args[1] || `nfsegoo_qa_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  if (decodeURIComponent(source.pathname.slice(1)) === database) throw new Error('Não é permitido usar o banco original como alvo.');
  const adminUrl = new URL(source); adminUrl.pathname = '/postgres';
  const admin = new PrismaClient({ datasources: { db: { url: adminUrl.toString() } }, log: [] });
  try {
    if (args[0] === '--reuse') {
      const exists = await admin.$queryRaw`SELECT datname FROM pg_database WHERE datname = ${database}`;
      if (exists.length !== 1) throw new Error('Banco de QA não encontrado.');
    } else {
      // Identifier is generated internally and checked against a fixed alphabet.
      if (!qaPattern.test(database)) throw new Error('Nome de QA inválido.');
      try { await admin.$executeRawUnsafe(`CREATE DATABASE "${database}" TEMPLATE template0`); }
      catch (error) {
        if (!dockerBootstrap || error?.meta?.code !== '42501') throw error;
        // Explicit local-container bootstrap; do not grant CREATEDB/superuser to
        // the application role. Ownership is limited to this NEW synthetic DB.
        const ports = spawnSync('docker', ['port', 'nfse-db', '5432/tcp'], { encoding: 'utf8' });
        if (ports.status !== 0 || !ports.stdout.split(/\r?\n/).some((line) => line.endsWith(':' + (source.port || '5432')))) throw new Error('Container não corresponde à porta local configurada.', { cause: error });
        const created = spawnSync('docker', ['exec', '--env', `NFSE_QA_DATABASE=${database}`, '--env', `NFSE_QA_OWNER=${decodeURIComponent(source.username)}`, 'nfse-db', 'sh', '-c',
          'exec createdb --username="${POSTGRES_USER:-postgres}" --owner="$NFSE_QA_OWNER" --template=template0 "$NFSE_QA_DATABASE"'], { stdio: 'inherit' });
        if (created.status !== 0) throw new Error('Não foi possível criar o banco isolado pelo container.', { cause: error });
      }
    }
  } finally { await admin.$disconnect(); }
  console.log(`Banco isolado de QA: ${database}. O banco original não será alterado.`);
  const target = new URL(source); target.pathname = '/' + database;
  const env = { ...process.env, DATABASE_URL: target.toString(), ALLOW_TEST_DATABASE_WRITES: 'true', FISCAL_WORKER_ALLOW_PRODUCTION: 'false' };
  for (const command of [ ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], ['scripts/run-tests.cjs', 'integration'] ]) {
    const result = spawnSync(process.execPath, command, { cwd: root, env, stdio: 'inherit' });
    if (result.status !== 0) {
      console.error(`Etapa de QA falhou. Banco preservado para diagnóstico: ${database}.`);
      process.exitCode = result.status || 1;
      return;
    }
  }
  console.log(`QA concluído; banco sintético preservado: ${database}. Não houve build ou transmissão fiscal.`);
}
main().catch((error) => { console.error('Falha ao preparar banco de QA:', error?.code || 'verifique acesso/argumentos', error?.meta?.code || ''); process.exitCode = 1; });
