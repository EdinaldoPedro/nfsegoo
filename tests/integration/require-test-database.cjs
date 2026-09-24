const assert = require('node:assert/strict');

module.exports = function requireTestDatabase() {
  assert.equal(process.env.ALLOW_TEST_DATABASE_WRITES, 'true', 'Escrita em testes exige opt-in explícito.');
  const url = new URL(process.env.DATABASE_URL || '');
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), 'Somente PostgreSQL local isolado.');
  assert.match(decodeURIComponent(url.pathname.slice(1)), /^nfsegoo_qa_[0-9]{8}_[a-f0-9]{12}$/, 'Testes exigem banco isolado criado por scripts/test-database.cjs, nunca nfse_db.');
  return url;
};
