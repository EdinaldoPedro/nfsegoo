const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const bcrypt = require('bcryptjs');

test('PostgreSQL: reaceite jurídico é autenticado, mínimo e idempotente', { skip: process.env.ALLOW_TEST_DATABASE_WRITES !== 'true' }, async () => {
  require('./require-test-database.cjs')();
  const { prisma } = require('../../app/utils/prisma.ts');
  const { privacyVersion, termsVersion } = require('../../app/legal-content.ts');
  const { acceptCurrentLegalDocuments, currentLegalAcceptance } = require('../../app/services/legalAcceptanceService.ts');
  const password = 'AceiteJuridico@123';
  let user;
  try {
    user = await prisma.user.create({ data: {
      email: `qa-legal-${randomUUID()}@example.invalid`, nome: 'Titular aceite QA', role: 'COMUM', senha: await bcrypt.hash(password, 4),
    } });
    assert.deepEqual(await currentLegalAcceptance(user.id), { required: true, acceptedAt: null, termsVersion, privacyVersion });
    const request = new Request('https://qa.example.invalid/api/legal/acceptance', {
      method: 'POST', headers: { 'user-agent': 'Navegador QA com identificador que não pode ser persistido em claro', 'x-real-ip': '192.0.2.44' },
    });
    const payload = { accepted: true, termsVersion, privacyVersion, password };
    await assert.rejects(acceptCurrentLegalDocuments(user.id, request, { ...payload, password: 'senha-incorreta' }), { status: 403 });
    const results = await Promise.all(Array.from({ length: 4 }, () => acceptCurrentLegalDocuments(user.id, request, payload)));
    assert.equal(results.every(result => result.required === false), true);

    const acceptances = await prisma.legalAcceptance.findMany({ where: { userId: user.id } });
    assert.equal(acceptances.length, 1);
    assert.equal(acceptances[0].termsVersion, termsVersion);
    assert.equal(acceptances[0].privacyVersion, privacyVersion);
    assert.match(acceptances[0].ipAddressHash, /^[a-f0-9]{64}$/);
    assert.match(acceptances[0].userAgentHash, /^[a-f0-9]{64}$/);
    assert.equal(JSON.stringify(acceptances).includes('192.0.2.44'), false);
    assert.equal(JSON.stringify(acceptances).includes('Navegador QA'), false);
    assert.equal(await prisma.systemLog.count({ where: { userId: user.id, action: 'LEGAL_DOCUMENTS_ACCEPTED' } }), 1);
    assert.equal((await currentLegalAcceptance(user.id)).required, false);
  } finally {
    if (user) {
      await prisma.systemLog.deleteMany({ where: { userId: user.id } });
      await prisma.legalAcceptance.deleteMany({ where: { userId: user.id } });
      await prisma.user.deleteMany({ where: { id: user.id } });
    }
  }
});
