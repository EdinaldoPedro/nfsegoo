// Read-only inventory. Never prints connection credentials, fiscal XML or PII.
const { Prisma, PrismaClient } = require('@prisma/client');
const path = require('node:path');
const {
  compareDatabaseStructure, compareMigrationInventory, databaseStructureDetail,
  migrationReadinessDetail, readExpectedPrismaStructure, readLocalMigrationInventory,
} = require('./migration-readiness.cjs');
const prisma = new PrismaClient({ log: [] });
async function main() {
  const result = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    const database = await tx.$queryRaw`SELECT current_database() AS database, current_setting('TimeZone') AS timezone, current_setting('server_version') AS version`;
    const privileges = await tx.$queryRaw`SELECT rolcreatedb AS can_create_database, rolsuper AS superuser FROM pg_roles WHERE rolname = current_user`;
    const migrations = await tx.$queryRaw`SELECT migration_name AS name, checksum, started_at AS "startedAt", finished_at IS NOT NULL AS finished, rolled_back_at IS NOT NULL AS "rolledBack" FROM "_prisma_migrations" ORDER BY started_at`;
    const databaseColumns = await tx.$queryRaw`SELECT table_name AS "tableName", column_name AS "columnName" FROM information_schema.columns WHERE table_schema = current_schema()`;
    const jobs = await tx.$queryRaw`SELECT "status", COUNT(*)::int AS count FROM "EmissaoJob" GROUP BY "status" ORDER BY "status"`;
    const counts = await tx.$queryRaw`SELECT (SELECT COUNT(*)::int FROM "User") AS users, (SELECT COUNT(*)::int FROM "Empresa") AS companies, (SELECT COUNT(*)::int FROM "NotaFiscal") AS invoices, (SELECT COUNT(*)::int FROM "Venda") AS sales`;
    const local = readLocalMigrationInventory(path.join(__dirname, '..', 'prisma', 'migrations'));
    const migrationReadiness = compareMigrationInventory(local, migrations);
    const structureReadiness = compareDatabaseStructure(readExpectedPrismaStructure(Prisma.dmmf), databaseColumns);
    return {
      database,
      privileges,
      migrationReadiness: { ...migrationReadiness, detail: migrationReadinessDetail(migrationReadiness) },
      structureReadiness: { ...structureReadiness, detail: databaseStructureDetail(structureReadiness) },
      jobs,
      counts,
    };
  });
  console.log(JSON.stringify(result, null, 2));
}
main().catch(() => { console.error('Não foi possível concluir a inspeção somente leitura do banco.'); process.exitCode = 1; }).finally(() => prisma.$disconnect());
