import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { prisma } from '../app/utils/prisma';
import { claimEmission } from '../app/services/emissionLeaseService';
import { processClaimedEmission } from '../app/services/durableEmissionWorker';
import { processNextEmissionDocument } from '../app/services/emissionDocumentWorker';
import { ensureFiscalSchemas } from '../app/services/emissor/validation/FiscalSchema';
import { claimFiscalNoteOperation, processFiscalNoteOperation } from '../app/services/fiscalNoteWorker';
import { cleanupEmailOutbox, processNextEmailDelivery } from '../app/services/emailOutboxService';
import { EmailService } from '../app/services/EmailService';
import { cleanupOperationalData } from '../app/services/operationalRetentionService';
import { inspectFiscalHomologationEvidence } from '../app/utils/fiscal-homologation-evidence';

let stopping = false;
const stop = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { stopping = true; stop.abort(); });
const workerId = `emission-${randomUUID()}`;
const configured = Number(process.env.EMISSION_WORKER_CONCURRENCY || 2);
if (!Number.isInteger(configured) || configured < 1 || configured > 8) throw new Error('EMISSION_WORKER_CONCURRENCY deve ser inteiro entre 1 e 8.');
const allowProduction = process.env.FISCAL_WORKER_ALLOW_PRODUCTION === 'true';

async function pause(ms: number) { await delay(ms, undefined, { signal: stop.signal }).catch(() => {}); }

async function emissionLoop() {
  while (!stopping) {
    try {
      const job = await claimEmission(workerId, undefined, allowProduction);
      if (job) await processClaimedEmission(job);
      else await pause(1_500);
    } catch { console.error('[emission-worker] Falha operacional; tarefas permanecem no banco.'); await pause(5_000); }
  }
}
async function documentLoop() {
  while (!stopping) {
    try { if (!await processNextEmissionDocument()) await pause(2_000); }
    catch { console.error('[emission-worker] Pós-processamento temporariamente indisponível.'); await pause(5_000); }
  }
}
async function fiscalNoteLoop() {
  while (!stopping) {
    try {
      const operation = await claimFiscalNoteOperation(allowProduction);
      if (operation) await processFiscalNoteOperation(operation);
      else await pause(1_500);
    } catch { console.error('[emission-worker] Operações de notas aguardam retomada segura.'); await pause(5_000); }
  }
}
async function emailLoop() {
  const email = new EmailService();
  let lastCleanup = 0;
  while (!stopping) {
    try {
      const processed = await processNextEmailDelivery((payload) => email.sendEmail(payload.to, payload.subject, payload.html, [], {
        ...payload.context, queueOnFailure: false,
      }));
      if (Date.now() - lastCleanup > 60 * 60 * 1000) { await cleanupEmailOutbox(); lastCleanup = Date.now(); }
      if (!processed) await pause(2_000);
    } catch { console.error('[emission-worker] Entrega de e-mail temporariamente indisponível.'); await pause(5_000); }
  }
}
async function healthLoop() {
  while (!stopping) {
    try {
      await prisma.$executeRaw`
        INSERT INTO "WorkerHeartbeat" ("id", "updatedAt", "productionEnabled") VALUES (${workerId}, clock_timestamp(), ${allowProduction})
        ON CONFLICT ("id") DO UPDATE SET "updatedAt" = clock_timestamp(), "productionEnabled" = EXCLUDED."productionEnabled"
      `;
      // Only operational heartbeats older than seven days, not audit/fiscal records.
      await prisma.$executeRaw`DELETE FROM "WorkerHeartbeat" WHERE "updatedAt" < clock_timestamp() - interval '7 days'`;
    } catch { console.error('[emission-worker] Sem conexão com o banco.'); }
    await pause(15_000);
  }
}
async function retentionLoop() {
  while (!stopping) {
    try { await cleanupOperationalData(); }
    catch { console.error('[emission-worker] Limpeza de dados operacionais será tentada novamente.'); }
    await pause(60 * 60 * 1000);
  }
}

async function main() {
  if (allowProduction && (process.env.NODE_ENV === 'production' || process.env.FISCAL_HOMOLOGATION_ENFORCEMENT === 'true')) {
    const evidence = inspectFiscalHomologationEvidence({
      rootDir: process.cwd(),
      evidenceFile: process.env.FISCAL_HOMOLOGATION_EVIDENCE_FILE,
    });
    if (!evidence.ok) throw new Error('Homologação fiscal ausente, vencida ou incompatível com esta versão.');
  }
  // Do not claim jobs or advertise a healthy worker with missing fiscal assets.
  await ensureFiscalSchemas();
  console.info(`[emission-worker] Iniciado. Concorrência: ${configured}. Envio de produção: ${allowProduction ? 'habilitado' : 'desabilitado'}.`);
  try { await Promise.all([healthLoop(), retentionLoop(), documentLoop(), fiscalNoteLoop(), emailLoop(), ...Array.from({ length: configured }, () => emissionLoop())]); }
  finally { await prisma.$disconnect(); }
}
void main().catch(() => { console.error('[emission-worker] Encerramento inesperado.'); process.exitCode = 1; });
