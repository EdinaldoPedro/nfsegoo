import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import { prisma } from '../app/utils/prisma';
import { processNextEmissionDocument } from '../app/services/emissionDocumentWorker';
import { ensureFiscalSchemas } from '../app/services/emissor/validation/FiscalSchema';

let stopping = false;
const stop = new AbortController();
const workerId = `document-${randomUUID()}`;
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { stopping = true; stop.abort(); });

async function pause(ms: number) { await delay(ms, undefined, { signal: stop.signal }).catch(() => {}); }

async function healthLoop() {
  while (!stopping) {
    try {
      await prisma.$executeRaw`
        INSERT INTO "WorkerHeartbeat" ("id", "updatedAt", "productionEnabled") VALUES (${workerId}, clock_timestamp(), false)
        ON CONFLICT ("id") DO UPDATE SET "updatedAt" = clock_timestamp()
      `;
      await prisma.$executeRaw`DELETE FROM "WorkerHeartbeat" WHERE "id" LIKE 'document-%' AND "updatedAt" < clock_timestamp() - interval '7 days'`;
    } catch { console.error('[document-worker] Sem conexão com o banco para registrar heartbeat.'); }
    await pause(15_000);
  }
}

async function documentLoop() {
  while (!stopping) {
    try { if (!await processNextEmissionDocument()) await pause(2_000); }
    catch { console.error('[document-worker] Pós-processamento temporariamente indisponível.'); await pause(5_000); }
  }
}

async function main() {
  await ensureFiscalSchemas();
  console.info('[document-worker] Iniciado. Este processo apenas gera documentos locais; não transmite notas nem envia e-mails.');
  try {
    await Promise.all([healthLoop(), documentLoop()]);
  } finally { await prisma.$disconnect(); }
}

void main().catch(() => { console.error('[document-worker] Encerramento inesperado.'); process.exitCode = 1; });
