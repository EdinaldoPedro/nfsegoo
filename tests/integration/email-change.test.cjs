const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const bcrypt = require('bcryptjs');

test('PostgreSQL: troca de e-mail é confirmada pelo titular e revoga acessos', { skip: process.env.ALLOW_TEST_DATABASE_WRITES !== 'true' }, async t => {
  require('./require-test-database.cjs')();
  const { prisma } = require('../../app/utils/prisma.ts');
  const { stageEmailChange, confirmEmailChange, discardStagedEmailChange } = require('../../app/services/emailChangeService.ts');
  const prefix = 'qa-email-' + randomUUID(), password = 'Senha!123', users = [];
  try {
    const hash = await bcrypt.hash(password, 4);
    for (let index = 0; index < 3; index++) users.push(await prisma.user.create({ data: {
      nome: prefix, email: `${prefix}-${index}@qa.test`, senha: hash, role: 'COMUM',
    } }));
    const sessions = [];
    for (const user of users.slice(0, 2)) sessions.push(await prisma.authSession.create({ data: { userId: user.id, sessionVersion: 0, expiresAt: new Date(Date.now() + 3600000) } }));
    const impersonation = await prisma.impersonationSession.create({ data: { tokenHash: randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', ''),
      actorUserId: users[1].id, targetUserId: users[0].id, reason: 'Fixture controlada de troca de e-mail', expiresAt: new Date(Date.now() + 3600000) } });
    let staged;
    await t.test('senha e endereço pendente são verificados; código não fica legível', async () => {
      await assert.rejects(stageEmailChange(users[0].id, 0, `${prefix}-new@qa.test`, 'errada'), { status: 403 });
      staged = await stageEmailChange(users[0].id, 0, `${prefix}-new@qa.test`, password);
      const row = await prisma.user.findUniqueOrThrow({ where: { id: users[0].id } });
      assert.notEqual(row.verificationCode, staged.code); assert.match(row.verificationCode, /^[a-f0-9]{64}$/);
      await assert.rejects(stageEmailChange(users[1].id, 0, staged.email, password), { status: 409 });
      await assert.rejects(confirmEmailChange(users[0].id, 0, '000000'), { status: 400 });
    });
    await t.test('confirmação concorrente consome uma vez e encerra sessões/impersonação', async () => {
      const results = await Promise.allSettled([confirmEmailChange(users[0].id, 0, staged.code), confirmEmailChange(users[0].id, 0, staged.code)]);
      assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
      const row = await prisma.user.findUniqueOrThrow({ where: { id: users[0].id } });
      assert.equal(row.email, staged.email); assert.equal(row.tempEmail, null); assert.equal(row.verificationCode, null); assert.equal(row.sessionVersion, 1);
      assert.ok((await prisma.authSession.findUniqueOrThrow({ where: { id: sessions[0].id } })).revokedAt);
      assert.ok((await prisma.impersonationSession.findUniqueOrThrow({ where: { id: impersonation.id } })).revokedAt);
      const log = await prisma.systemLog.findFirstOrThrow({ where: { userId: users[0].id, action: 'ACCOUNT_EMAIL_CHANGED' } });
      assert.equal(JSON.stringify(log).includes(staged.email), false); assert.equal(JSON.stringify(log).includes(staged.code), false);
    });
    await t.test('falha de entrega limpa somente a tentativa ainda correspondente', async () => {
      const retry = await stageEmailChange(users[1].id, 0, `${prefix}-discard@qa.test`, password);
      await stageEmailChange(users[1].id, 0, `${prefix}-newer@qa.test`, password);
      await discardStagedEmailChange(users[1].id, retry.email, retry.storedHash);
      assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: users[1].id } })).tempEmail, `${prefix}-newer@qa.test`);
    });
  } finally {
    const ids = users.map(user => user.id);
    await prisma.systemLog.deleteMany({ where: { userId: { in: ids } } });
    await prisma.impersonationSession.deleteMany({ where: { OR: [{ actorUserId: { in: ids } }, { targetUserId: { in: ids } }] } });
    await prisma.authSession.deleteMany({ where: { userId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
  }
});
