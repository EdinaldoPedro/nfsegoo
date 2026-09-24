const { test } = require('node:test');
const assert = require('node:assert/strict');
const requireTestDatabase = require('./integration/require-test-database.cjs');

test('integracao: localhost nao basta; escrita exige nome isolado e opt-in', () => {
  const original = { url: process.env.DATABASE_URL, allow: process.env.ALLOW_TEST_DATABASE_WRITES };
  try {
    process.env.ALLOW_TEST_DATABASE_WRITES = 'true';
    for (const database of ['nfse_db', 'postgres', 'producao', 'nfsegoo_qa_fora_do_padrao']) {
      process.env.DATABASE_URL = `postgresql://qa:synthetic@localhost:5432/${database}`;
      assert.throws(requireTestDatabase);
    }
    process.env.DATABASE_URL = 'postgresql://qa:synthetic@localhost:5432/nfsegoo_qa_20260902_012345abcdef';
    assert.doesNotThrow(requireTestDatabase);
    process.env.ALLOW_TEST_DATABASE_WRITES = 'false';
    assert.throws(requireTestDatabase);
    process.env.ALLOW_TEST_DATABASE_WRITES = 'true';
    process.env.DATABASE_URL = 'postgresql://qa:synthetic@external.invalid:5432/nfsegoo_qa_20260902_012345abcdef';
    assert.throws(requireTestDatabase);
  } finally {
    if (original.url === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = original.url;
    if (original.allow === undefined) delete process.env.ALLOW_TEST_DATABASE_WRITES; else process.env.ALLOW_TEST_DATABASE_WRITES = original.allow;
  }
});
