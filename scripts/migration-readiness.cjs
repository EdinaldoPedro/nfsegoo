const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function checksum(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function readLocalMigrationInventory(migrationsDirectory) {
  const issues = [];
  if (!fs.existsSync(migrationsDirectory)) {
    return { migrations: [], issues: [{ code: 'MIGRATIONS_DIRECTORY_MISSING', migration: null }] };
  }
  const migrations = [];
  for (const entry of fs.readdirSync(migrationsDirectory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    const sqlPath = path.join(migrationsDirectory, entry.name, 'migration.sql');
    if (!fs.existsSync(sqlPath) || !fs.statSync(sqlPath).isFile()) {
      issues.push({ code: 'LOCAL_MIGRATION_SQL_MISSING', migration: entry.name });
      continue;
    }
    const content = fs.readFileSync(sqlPath);
    const canonicalContent = Buffer.from(content.toString('utf8').replace(/\r\n/g, '\n'));
    const crlfContent = Buffer.from(canonicalContent.toString('utf8').replace(/\n/g, '\r\n'));
    const acceptedChecksums = [...new Set([checksum(content), checksum(canonicalContent), checksum(crlfContent)])];
    migrations.push({ name: entry.name, checksum: checksum(canonicalContent), acceptedChecksums });
  }
  if (!migrations.length) issues.push({ code: 'LOCAL_MIGRATIONS_EMPTY', migration: null });
  return { migrations, issues };
}

function compareMigrationInventory(localInventory, databaseRows) {
  const issues = [...localInventory.issues];
  const localByName = new Map(localInventory.migrations.map(item => [item.name, item]));
  const databaseByName = new Map();
  for (const row of databaseRows || []) {
    const name = String(row.name || row.migration_name || '');
    if (!name) continue;
    const rows = databaseByName.get(name) || [];
    rows.push({
      name,
      checksum: String(row.checksum || ''),
      finished: row.finished === true || row.finished_at != null,
      rolledBack: row.rolledBack === true || row.rolled_back === true || row.rolled_back_at != null,
      startedAt: row.startedAt || row.started_at || null,
    });
    databaseByName.set(name, rows);
  }

  for (const migration of localInventory.migrations) {
    const attempts = databaseByName.get(migration.name) || [];
    const unfinished = attempts.filter(row => !row.finished && !row.rolledBack);
    if (unfinished.length) issues.push({ code: 'MIGRATION_FAILED_OR_INCOMPLETE', migration: migration.name });
    const successful = attempts.filter(row => row.finished && !row.rolledBack);
    if (!successful.length) {
      issues.push({ code: attempts.some(row => row.rolledBack) ? 'MIGRATION_ROLLED_BACK_NOT_REAPPLIED' : 'MIGRATION_NOT_APPLIED', migration: migration.name });
      continue;
    }
    const latest = successful.sort((a, b) => String(a.startedAt || '').localeCompare(String(b.startedAt || ''))).at(-1);
    const acceptedChecksums = migration.acceptedChecksums || [migration.checksum];
    if (!latest.checksum || !acceptedChecksums.includes(latest.checksum)) {
      issues.push({ code: 'MIGRATION_CHECKSUM_MISMATCH', migration: migration.name });
    }
  }

  for (const [name, attempts] of databaseByName) {
    if (localByName.has(name)) continue;
    if (attempts.some(row => row.finished && !row.rolledBack)) {
      issues.push({ code: 'DATABASE_MIGRATION_NOT_IN_CODE', migration: name });
    }
    if (attempts.some(row => !row.finished && !row.rolledBack)) {
      issues.push({ code: 'UNKNOWN_MIGRATION_FAILED_OR_INCOMPLETE', migration: name });
    }
  }

  const uniqueIssues = [...new Map(issues.map(issue => [`${issue.code}:${issue.migration || ''}`, issue])).values()];
  return {
    ok: uniqueIssues.length === 0,
    issues: uniqueIssues,
    localCount: localInventory.migrations.length,
    appliedCount: localInventory.migrations.filter(item => {
      const attempts = databaseByName.get(item.name) || [];
      const acceptedChecksums = item.acceptedChecksums || [item.checksum];
      return attempts.some(row => row.finished && !row.rolledBack && acceptedChecksums.includes(row.checksum));
    }).length,
  };
}

function migrationReadinessDetail(result) {
  if (result.ok) return `${result.appliedCount}/${result.localCount} migrações locais aplicadas e íntegras`;
  const summary = result.issues.slice(0, 5).map(issue => `${issue.code}${issue.migration ? `:${issue.migration}` : ''}`).join(', ');
  return `${result.appliedCount}/${result.localCount} migrações íntegras; ${result.issues.length} divergência(s): ${summary}${result.issues.length > 5 ? ', ...' : ''}`;
}

function readExpectedPrismaStructure(dmmf) {
  return (dmmf?.datamodel?.models || []).map(model => ({
    table: model.dbName || model.name,
    columns: model.fields
      .filter(field => field.kind !== 'object')
      .map(field => field.dbName || field.name)
      .sort(),
  })).sort((a, b) => a.table.localeCompare(b.table));
}

function compareDatabaseStructure(expectedModels, databaseColumns) {
  const actual = new Map();
  for (const row of databaseColumns || []) {
    const table = String(row.tableName || row.table_name || '');
    const column = String(row.columnName || row.column_name || '');
    if (!table || !column) continue;
    const columns = actual.get(table) || new Set();
    columns.add(column);
    actual.set(table, columns);
  }

  const issues = [];
  for (const model of expectedModels || []) {
    const columns = actual.get(model.table);
    if (!columns) {
      issues.push({ code: 'EXPECTED_TABLE_MISSING', object: model.table });
      continue;
    }
    for (const column of model.columns) {
      if (!columns.has(column)) issues.push({ code: 'EXPECTED_COLUMN_MISSING', object: `${model.table}.${column}` });
    }
  }
  return { ok: issues.length === 0, issues, expectedTableCount: expectedModels.length };
}

function databaseStructureDetail(result) {
  if (result.ok) return `${result.expectedTableCount} tabela(s) do modelo Prisma presentes com suas colunas`;
  const summary = result.issues.slice(0, 5).map(issue => `${issue.code}:${issue.object}`).join(', ');
  return `${result.issues.length} divergência(s) estrutural(is): ${summary}${result.issues.length > 5 ? ', ...' : ''}`;
}

module.exports = {
  checksum,
  readLocalMigrationInventory,
  compareMigrationInventory,
  migrationReadinessDetail,
  readExpectedPrismaStructure,
  compareDatabaseStructure,
  databaseStructureDetail,
};
