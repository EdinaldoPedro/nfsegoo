'use strict';

// Read-only probe for a process monitor. Never transmits or modifies fiscal data.
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const [heartbeat, pending, retryOverdue, processingExpired, manual] = await Promise.all([
    prisma.$queryRaw`SELECT EXISTS (SELECT 1 FROM "WorkerHeartbeat" WHERE "id" LIKE 'emission-%'
      AND "updatedAt" > clock_timestamp() - interval '45 seconds') AS alive,
      EXISTS (SELECT 1 FROM "WorkerHeartbeat" WHERE "id" LIKE 'emission-%' AND "productionEnabled" = true
      AND "updatedAt" > clock_timestamp() - interval '45 seconds') AS production`,
    prisma.$queryRaw`SELECT COUNT(*)::int AS count FROM "EmissaoJob" WHERE "status" = 'PENDENTE'
      AND "createdAt" < clock_timestamp() - interval '5 minutes'
      AND ("nextAttemptAt" IS NULL OR "nextAttemptAt" <= clock_timestamp())`,
    prisma.$queryRaw`SELECT COUNT(*)::int AS count FROM "EmissaoJob" WHERE "status" = 'ERRO_TEMPORARIO'
      AND ("nextAttemptAt" IS NULL OR "nextAttemptAt" < clock_timestamp() - interval '5 minutes')`,
    prisma.$queryRaw`SELECT COUNT(*)::int AS count FROM "EmissaoJob" WHERE "status" = 'PROCESSANDO'
      AND ("leaseUntil" IS NULL OR "leaseUntil" < clock_timestamp() - interval '5 minutes')`,
    prisma.$queryRaw`SELECT COUNT(*)::int AS count FROM "EmissaoJob" WHERE "status" = 'RECONCILIACAO_MANUAL'`,
  ]);
  const result = { workerOnline: heartbeat[0]?.alive === true,
    productionWorkerOnline: heartbeat[0]?.production === true,
    waitingTooLong: pending[0]?.count || 0, retryOverdue: retryOverdue[0]?.count || 0,
    processingExpired: processingExpired[0]?.count || 0, manual: manual[0]?.count || 0 };
  const needsProduction = process.env.FISCAL_WORKER_ALLOW_PRODUCTION === 'true' || process.env.READINESS_REQUIRE_PRODUCTION_WORKER === 'true';
  const healthy = result.workerOnline && (!needsProduction || result.productionWorkerOnline)
    && !result.waitingTooLong && !result.retryOverdue && !result.processingExpired && !result.manual;
  console.log(JSON.stringify({ status: healthy ? 'ok' : 'alert', ...result }));
  if (!healthy) process.exitCode = 2;
}

main().catch(() => { console.error(JSON.stringify({ status: 'unknown', error: 'Falha ao consultar banco ou fila.' })); process.exitCode = 2; })
  .finally(() => prisma.$disconnect());
