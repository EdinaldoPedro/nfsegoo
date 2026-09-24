import { withApiGuard } from '@/app/utils/api-route';
import { prisma } from '@/app/utils/prisma';
import { compareRuntimeMigrations, readRuntimeMigrationNames } from '@/app/utils/runtime-migration-readiness';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const GET = withApiGuard(async function GET() {
  try {
    const requireWorker = process.env.READINESS_REQUIRE_WORKER === 'true' || process.env.NODE_ENV === 'production';
    const requireProductionWorker = process.env.READINESS_REQUIRE_PRODUCTION_WORKER === 'true';
    const requireConsultationWorker = process.env.READINESS_REQUIRE_CONSULTATION_WORKER === 'true' || process.env.NODE_ENV === 'production';
    const requireDocumentWorker = process.env.READINESS_REQUIRE_DOCUMENT_WORKER === 'true' || process.env.NODE_ENV === 'production';
    const [database, migrationRows, worker, expectedMigrations] = await Promise.all([
      prisma.$queryRaw<Array<{ ok: number }>>`SELECT 1 AS ok`,
      prisma.$queryRaw<Array<{ name: string; finished: boolean; rolledBack: boolean }>>`SELECT migration_name AS name,
        finished_at IS NOT NULL AS finished, rolled_back_at IS NOT NULL AS "rolledBack" FROM "_prisma_migrations"`,
      prisma.$queryRaw<Array<{ emission: boolean; production: boolean; consultation: boolean; document: boolean }>>`SELECT
        EXISTS (SELECT 1 FROM "WorkerHeartbeat" WHERE "id" LIKE 'emission-%' AND "updatedAt" > clock_timestamp() - interval '45 seconds') AS emission,
        EXISTS (SELECT 1 FROM "WorkerHeartbeat" WHERE "id" LIKE 'emission-%' AND "updatedAt" > clock_timestamp() - interval '45 seconds' AND "productionEnabled" = true) AS production,
        EXISTS (SELECT 1 FROM "WorkerHeartbeat" WHERE "id" LIKE 'consultation-%' AND "updatedAt" > clock_timestamp() - interval '45 seconds') AS consultation,
        EXISTS (SELECT 1 FROM "WorkerHeartbeat" WHERE "id" LIKE 'document-%' AND "updatedAt" > clock_timestamp() - interval '45 seconds') AS document`,
      readRuntimeMigrationNames(),
    ]);
    const migrations = compareRuntimeMigrations(expectedMigrations, migrationRows);
    const checks = {
      database: database[0]?.ok === 1,
      schema: migrations.ok,
      worker: !requireWorker || worker[0]?.emission === true,
      productionWorker: !requireProductionWorker || worker[0]?.production === true,
      consultationWorker: !requireConsultationWorker || worker[0]?.consultation === true,
      documentWorker: !requireDocumentWorker || worker[0]?.document === true,
    };
    const ready = Object.values(checks).every(Boolean);
    return Response.json({ status: ready ? 'ready' : 'not_ready', checks }, { status: ready ? 200 : 503,
      headers: { 'Cache-Control': 'no-store', ...(ready ? {} : { 'Retry-After': '15' }) } });
  } catch {
    return Response.json({ status: 'not_ready', checks: { database: false } }, { status: 503,
      headers: { 'Cache-Control': 'no-store', 'Retry-After': '15' } });
  }
});
