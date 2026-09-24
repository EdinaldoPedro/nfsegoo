// Read-only deploy gate. It verifies migration history and the minimum Prisma structure.
const path = require('node:path');
const { Prisma, PrismaClient } = require('@prisma/client');
const {
  compareDatabaseStructure, compareMigrationInventory, databaseStructureDetail,
  migrationReadinessDetail, readExpectedPrismaStructure, readLocalMigrationInventory,
} = require('./migration-readiness.cjs');

const prisma = new PrismaClient({ log: [] });

async function main() {
  const state = await prisma.$transaction(async tx => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    const migrations = await tx.$queryRaw`SELECT migration_name AS name, checksum, started_at AS "startedAt",
      finished_at IS NOT NULL AS finished, rolled_back_at IS NOT NULL AS "rolledBack"
      FROM "_prisma_migrations" ORDER BY started_at`;
    const columns = await tx.$queryRaw`SELECT table_name AS "tableName", column_name AS "columnName"
      FROM information_schema.columns WHERE table_schema = current_schema()`;
    return { migrations, columns };
  });

  const local = readLocalMigrationInventory(path.join(__dirname, '..', 'prisma', 'migrations'));
  const migrations = compareMigrationInventory(local, state.migrations);
  const structure = compareDatabaseStructure(readExpectedPrismaStructure(Prisma.dmmf), state.columns);

  console.log(migrationReadinessDetail(migrations));
  console.log(databaseStructureDetail(structure));
  if (!migrations.ok || !structure.ok) {
    console.error('MIGRATION_GATE_BLOCKED: banco e versão da aplicação não estão sincronizados.');
    process.exitCode = 1;
    return;
  }
  console.log('MIGRATION_GATE_OK: histórico e estrutura mínima estão sincronizados.');
}

main()
  .catch(() => {
    console.error('MIGRATION_GATE_BLOCKED: não foi possível concluir a verificação somente leitura.');
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
