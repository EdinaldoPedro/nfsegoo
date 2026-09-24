const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  checksum, compareDatabaseStructure, compareMigrationInventory, databaseStructureDetail,
  migrationReadinessDetail, readExpectedPrismaStructure, readLocalMigrationInventory,
} = require('../scripts/migration-readiness.cjs');

const local = (...names) => ({ migrations: names.map(name => ({ name, checksum: checksum(Buffer.from(`-- ${name}\n`)) })), issues: [] });
const applied = item => ({ name: item.name, checksum: item.checksum, finished: true, rolledBack: false, startedAt: '2026-01-01T00:00:00Z' });

test('inventario local le todas as pastas e calcula checksum do migration.sql', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nfse-migrations-'));
  try {
    fs.mkdirSync(path.join(directory, '001_first'));
    fs.writeFileSync(path.join(directory, '001_first', 'migration.sql'), '-- first\n');
    fs.mkdirSync(path.join(directory, '002_broken'));
    const inventory = readLocalMigrationInventory(directory);
    assert.deepEqual(inventory.migrations, [{
      name: '001_first',
      checksum: checksum(Buffer.from('-- first\n')),
      acceptedChecksums: [checksum(Buffer.from('-- first\n')), checksum(Buffer.from('-- first\r\n'))],
    }]);
    assert.deepEqual(inventory.issues, [{ code: 'LOCAL_MIGRATION_SQL_MISSING', migration: '002_broken' }]);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('checksum aceita somente a variacao equivalente de quebra de linha', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nfse-migrations-eol-'));
  try {
    fs.mkdirSync(path.join(directory, '001_first'));
    fs.writeFileSync(path.join(directory, '001_first', 'migration.sql'), '-- first\r\nSELECT 1;\r\n');
    const inventory = readLocalMigrationInventory(directory);
    const lfChecksum = checksum(Buffer.from('-- first\nSELECT 1;\n'));
    const crlfChecksum = checksum(Buffer.from('-- first\r\nSELECT 1;\r\n'));
    assert.equal(inventory.migrations[0].checksum, lfChecksum);
    assert.deepEqual(inventory.migrations[0].acceptedChecksums, [crlfChecksum, lfChecksum]);
    assert.equal(compareMigrationInventory(inventory, [{
      name: '001_first', checksum: lfChecksum, finished: true, rolledBack: false,
    }]).ok, true);
    assert.equal(compareMigrationInventory(inventory, [{
      name: '001_first', checksum: checksum(Buffer.from('-- first\nSELECT 2;\n')), finished: true, rolledBack: false,
    }]).ok, false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('gate aprova somente quando todas as migracoes locais estao aplicadas com o mesmo checksum', () => {
  const inventory = local('001_first', '002_second');
  const result = compareMigrationInventory(inventory, inventory.migrations.map(applied));
  assert.equal(result.ok, true);
  assert.equal(result.appliedCount, 2);
  assert.match(migrationReadinessDetail(result), /2\/2/);
});

test('gate bloqueia migracao local ainda nao aplicada', () => {
  const inventory = local('001_first', '002_second');
  const result = compareMigrationInventory(inventory, [applied(inventory.migrations[0])]);
  assert.deepEqual(result.issues, [{ code: 'MIGRATION_NOT_APPLIED', migration: '002_second' }]);
});

test('gate bloqueia falha ativa, rollback sem reaplicacao e checksum divergente', () => {
  const inventory = local('001_first', '002_second', '003_third');
  const result = compareMigrationInventory(inventory, [
    { ...applied(inventory.migrations[0]), checksum: 'checksum-adulterado' },
    { name: '002_second', checksum: inventory.migrations[1].checksum, finished: false, rolledBack: false },
    { name: '003_third', checksum: inventory.migrations[2].checksum, finished: false, rolledBack: true },
  ]);
  assert.ok(result.issues.some(issue => issue.code === 'MIGRATION_CHECKSUM_MISMATCH' && issue.migration === '001_first'));
  assert.ok(result.issues.some(issue => issue.code === 'MIGRATION_FAILED_OR_INCOMPLETE' && issue.migration === '002_second'));
  assert.ok(result.issues.some(issue => issue.code === 'MIGRATION_ROLLED_BACK_NOT_REAPPLIED' && issue.migration === '003_third'));
});

test('rollback historico e aceito quando uma tentativa posterior foi concluida', () => {
  const inventory = local('001_first');
  const result = compareMigrationInventory(inventory, [
    { name: '001_first', checksum: inventory.migrations[0].checksum, finished: false, rolledBack: true, startedAt: '2026-01-01' },
    { ...applied(inventory.migrations[0]), startedAt: '2026-01-02' },
  ]);
  assert.equal(result.ok, true);
});

test('gate bloqueia migracao aplicada no banco que nao existe no codigo', () => {
  const inventory = local('001_first');
  const result = compareMigrationInventory(inventory, [
    applied(inventory.migrations[0]),
    { name: '999_unknown', checksum: 'abc', finished: true, rolledBack: false },
  ]);
  assert.deepEqual(result.issues, [{ code: 'DATABASE_MIGRATION_NOT_IN_CODE', migration: '999_unknown' }]);
});

test('estrutura esperada respeita nomes mapeados e ignora relacoes', () => {
  const expected = readExpectedPrismaStructure({ datamodel: { models: [{
    name: 'User', dbName: 'users', fields: [
      { name: 'id', dbName: 'user_id', kind: 'scalar' },
      { name: 'role', dbName: null, kind: 'enum' },
      { name: 'companies', dbName: null, kind: 'object' },
    ],
  }] } });
  assert.deepEqual(expected, [{ table: 'users', columns: ['role', 'user_id'] }]);
});

test('gate estrutural bloqueia tabela ou coluna ausente mesmo com historico de migracao valido', () => {
  const expected = [
    { table: 'Empresa', columns: ['id', 'razaoSocial'] },
    { table: 'Fatura', columns: ['id'] },
  ];
  const result = compareDatabaseStructure(expected, [
    { tableName: 'Empresa', columnName: 'id' },
  ]);
  assert.equal(result.ok, false);
  assert.deepEqual(result.issues, [
    { code: 'EXPECTED_COLUMN_MISSING', object: 'Empresa.razaoSocial' },
    { code: 'EXPECTED_TABLE_MISSING', object: 'Fatura' },
  ]);
  assert.match(databaseStructureDetail(result), /Fatura/);
});
