const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const bcrypt = require('bcryptjs');

test('PostgreSQL: recuperação de senha é entregue, consumida uma vez e revoga acessos', { skip: process.env.ALLOW_TEST_DATABASE_WRITES !== 'true' }, async (t) => {
  require('./require-test-database.cjs')();
  const { prisma } = require('../../app/utils/prisma.ts');
  const { consumePasswordReset, markPasswordResetDelivered, markPasswordResetDeliveryFailed,
    stagePasswordReset } = require('../../app/services/passwordRecoveryService.ts');
  const prefix = `qa-reset-${randomUUID()}`;
  let user;
  try {
    user = await prisma.user.create({ data: { email: `${prefix}@example.invalid`, nome: 'Recuperação QA',
      senha: await bcrypt.hash('Atual@Senha1', 10), role: 'COMUM' } });
    await prisma.authSession.create({ data: { userId: user.id, sessionVersion: 0, expiresAt: new Date(Date.now() + 3600_000) } });
    await prisma.impersonationSession.create({ data: { tokenHash: `${prefix}-imp`, actorUserId: user.id, targetUserId: user.id,
      reason: 'Fixture de revogação concorrente', expiresAt: new Date(Date.now() + 3600_000) } });

    await t.test('conta inexistente não cria solicitação', async () => {
      assert.equal(await stagePasswordReset(`${prefix}-missing@example.invalid`), null);
      assert.equal(await prisma.passwordResetRequest.count({ where: { userId: user.id } }), 0);
    });

    await t.test('falha de entrega torna o link inutilizável e não armazena token aberto', async () => {
      const staged = await stagePasswordReset(user.email);
      const stored = await prisma.passwordResetRequest.findUnique({ where: { id: staged.requestId } });
      assert.equal(stored.tokenHash, staged.tokenHash);
      assert.notEqual(stored.tokenHash, staged.token);
      assert.equal(await markPasswordResetDeliveryFailed(staged.requestId, staged.tokenHash), true);
      await assert.rejects(consumePasswordReset(staged.token, 'Outra@Senha2'), /inválido|expirado/);
    });

    await t.test('senha atual não pode ser reutilizada', async () => {
      const staged = await stagePasswordReset(user.email);
      assert.equal(await markPasswordResetDelivered(staged.requestId, staged.tokenHash), true);
      await assert.rejects(consumePasswordReset(staged.token, 'Atual@Senha1'), /diferente/);
    });

    await t.test('confirmação concorrente vence uma vez e encerra sessões, impersonação e outros links', async () => {
      const [first, second] = await Promise.all([stagePasswordReset(user.email), stagePasswordReset(user.email)]);
      await Promise.all([markPasswordResetDelivered(first.requestId, first.tokenHash), markPasswordResetDelivered(second.requestId, second.tokenHash)]);
      const attempts = await Promise.allSettled([
        consumePasswordReset(first.token, 'Definitiva@Senha3'), consumePasswordReset(first.token, 'Definitiva@Senha3'),
      ]);
      assert.equal(attempts.filter(item => item.status === 'fulfilled').length, 1);
      assert.equal(attempts.filter(item => item.status === 'rejected').length, 1);
      const updated = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      assert.equal(await bcrypt.compare('Definitiva@Senha3', updated.senha), true);
      assert.equal(updated.sessionVersion, 1);
      assert.equal(updated.tempEmail, null);
      assert.equal(await prisma.authSession.count({ where: { userId: user.id, revokedAt: null } }), 0);
      assert.equal(await prisma.impersonationSession.count({ where: { OR: [{ actorUserId: user.id }, { targetUserId: user.id }], revokedAt: null } }), 0);
      assert.equal((await prisma.passwordResetRequest.findUniqueOrThrow({ where: { id: first.requestId } })).consumedAt instanceof Date, true);
      assert.equal((await prisma.passwordResetRequest.findUniqueOrThrow({ where: { id: second.requestId } })).revokedAt instanceof Date, true);
      await assert.rejects(consumePasswordReset(second.token, 'Terceira@Senha4'), /inválido|expirado/);
      const logs = await prisma.systemLog.findMany({ where: { userId: user.id, action: 'PASSWORD_RESET' } });
      assert.equal(logs.length, 1);
      assert.doesNotMatch(logs[0].details || '', /Definitiva|Senha3|token/i);
    });
  } finally {
    if (user) {
      await prisma.systemLog.deleteMany({ where: { userId: user.id } });
      await prisma.impersonationSession.deleteMany({ where: { OR: [{ actorUserId: user.id }, { targetUserId: user.id }] } });
      await prisma.authSession.deleteMany({ where: { userId: user.id } });
      await prisma.passwordResetRequest.deleteMany({ where: { userId: user.id } });
      await prisma.user.delete({ where: { id: user.id } });
    }
  }
});
