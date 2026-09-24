const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const bcrypt = require('bcryptjs');

test('PostgreSQL: configuração global é versionada, hierárquica e auditada', { skip: process.env.ALLOW_TEST_DATABASE_WRITES !== 'true' }, async (t) => {
  require('./require-test-database.cjs')();
  const { prisma } = require('../../app/utils/prisma.ts');
  const { parseSystemConfigMutation, publicSystemConfig, updateSystemConfig } = require('../../app/services/systemConfigService.ts');
  const prefix = `qa-config-${randomUUID()}`;
  const original = await prisma.configuracaoSistema.findUnique({ where: { id: 'config' } });
  let actor;
  try {
    actor = await prisma.user.create({ data: { email: `${prefix}@example.invalid`, nome: 'Config QA',
      senha: await bcrypt.hash('Config@Senha1', 10), role: 'MASTER' } });
    const base = await prisma.configuracaoSistema.upsert({ where: { id: 'config' }, create: { id: 'config' }, update: {} });

    await t.test('ADMIN não altera chaves fiscais globais', async () => {
      const mutation = parseSystemConfigMutation({ expectedVersion: base.version,
        ibsCbsPilotoAtivo: !base.ibsCbsPilotoAtivo, adminPassword: 'não usado no serviço', justification: 'Teste de hierarquia fiscal' });
      await assert.rejects(updateSystemConfig({ id: actor.id, role: 'ADMIN' }, mutation), error => error.status === 403);
    });

    await t.test('duas telas com a mesma versão geram uma alteração e um conflito', async () => {
      const before = await prisma.configuracaoSistema.findUniqueOrThrow({ where: { id: 'config' } });
      const make = suffix => parseSystemConfigMutation({ expectedVersion: before.version,
        manutencaoTitulo: `${prefix}-${suffix}`, adminPassword: 'não usado no serviço', justification: 'Teste de versão concorrente' });
      const results = await Promise.allSettled([
        updateSystemConfig({ id: actor.id, role: 'MASTER' }, make('a')),
        updateSystemConfig({ id: actor.id, role: 'MASTER' }, make('b')),
      ]);
      assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
      assert.equal(results.filter(result => result.status === 'rejected' && result.reason?.status === 409).length, 1);
      const logs = await prisma.systemLog.findMany({ where: { userId: actor.id, action: 'SYSTEM_CONFIGURATION_CHANGED' } });
      assert.equal(logs.length, 1);
      assert.doesNotMatch(logs[0].details || '', /password|Config@Senha1/i);
      const view = publicSystemConfig(await prisma.configuracaoSistema.findUniqueOrThrow({ where: { id: 'config' } }));
      assert.equal(view.version, before.version + 1);
    });
  } finally {
    if (actor) {
      await prisma.systemLog.deleteMany({ where: { userId: actor.id } });
      await prisma.user.delete({ where: { id: actor.id } });
    }
    if (original) {
      const { id, ...data } = original;
      await prisma.configuracaoSistema.upsert({ where: { id }, create: original, update: data });
    } else {
      await prisma.configuracaoSistema.deleteMany({ where: { id: 'config' } });
    }
  }
});
