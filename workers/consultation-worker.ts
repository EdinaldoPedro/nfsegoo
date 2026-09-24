import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { prisma } from '../app/utils/prisma';
import { claimFiscalNoteOperation, processFiscalNoteOperation } from '../app/services/fiscalNoteWorker';
import { ensureFiscalSchemas } from '../app/services/emissor/validation/FiscalSchema';

let stopping = false;
const stop = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { stopping = true; stop.abort(); });
const workerId = `consultation-${randomUUID()}`;
async function pause(ms: number) { await delay(ms, undefined, { signal: stop.signal }).catch(() => {}); }

async function consultations() {
  while (!stopping) {
    try {
      // The SQL claim is restricted to CONSULTAR. No fiscal POST, emission,
      // cancellation or email outbox is reachable from this worker loop.
      const operation = await claimFiscalNoteOperation(false, undefined, true);
      if (operation) await processFiscalNoteOperation(operation);
      else await pause(2_000);
    } catch { console.error('[consultation-worker] Consulta indisponível; operação preservada para nova tentativa.'); await pause(5_000); }
  }
}

async function heartbeat() {
  while (!stopping) {
    try {
      await prisma.$executeRaw`
        INSERT INTO "WorkerHeartbeat" ("id", "updatedAt", "productionEnabled") VALUES (${workerId}, clock_timestamp(), false)
        ON CONFLICT ("id") DO UPDATE SET "updatedAt" = clock_timestamp(), "productionEnabled" = false
      `;
    } catch { console.error('[consultation-worker] Heartbeat indisponível.'); }
    await pause(15_000);
  }
}

async function main() {
  await ensureFiscalSchemas();
  console.info('[consultation-worker] Iniciado. Somente consultas GET de notas; nenhum envio, cancelamento ou e-mail.');
  try { await Promise.all([consultations(), heartbeat()]); }
  finally { await prisma.$disconnect(); }
}

void main().catch(() => { console.error('[consultation-worker] Encerramento inesperado.'); process.exitCode = 1; });
