const { test } = require('node:test');
const assert = require('node:assert/strict');
const { compareRuntimeMigrations } = require('../app/utils/runtime-migration-readiness.ts');

test('readiness exige o inventário completo aplicado', () => {
  assert.deepEqual(compareRuntimeMigrations(['001_a', '002_b'], [
    { name: '001_a', finished: true, rolledBack: false },
    { name: '002_b', finished: true, rolledBack: false },
  ]), { ok: true, expected: 2, applied: 2, missing: 0, unknown: 0, unfinished: 0 });
});

test('readiness falha com migração ausente, desconhecida ou inacabada', () => {
  const result = compareRuntimeMigrations(['001_a', '002_b'], [
    { name: '001_a', finished: true, rolledBack: false },
    { name: '003_c', finished: true, rolledBack: false },
    { name: '004_d', finished: false, rolledBack: false },
  ]);
  assert.deepEqual(result, { ok: false, expected: 2, applied: 2, missing: 1, unknown: 1, unfinished: 1 });
});

test('migração revertida não conta como aplicada nem como falha ativa', () => {
  assert.deepEqual(compareRuntimeMigrations(['001_a'], [
    { name: '001_a', finished: false, rolledBack: true },
  ]), { ok: false, expected: 1, applied: 0, missing: 1, unknown: 0, unfinished: 0 });
});
