const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const bcrypt = require('bcryptjs');

test('PostgreSQL: avisos globais são versionados, auditados e não replicam anexos', { skip: process.env.ALLOW_TEST_DATABASE_WRITES !== 'true' }, async (t) => {
  require('./require-test-database.cjs')();
  const { prisma } = require('../../app/utils/prisma.ts');
  const { archiveNotice, parseNoticeArchive, parseNoticeMutation, saveNotice } = require('../../app/services/globalNoticeService.ts');
  const prefix = `qa-notice-${randomUUID()}`;
  const ids = [];
  let actor;
  const base = overrides => parseNoticeMutation({ expectedVersion: null, titulo: `${prefix}-título`,
    mensagem: `${prefix}-mensagem`, tipo: 'WARNING', status: 'ATIVO', publico: 'CLIENTES',
    iniciaEm: null, terminaEm: null, linkLabel: null, linkHref: null, anexoNome: null, anexoBase64: null,
    removerAnexo: false, notificarApp: true, adminPassword: 'não usado no serviço',
    justification: 'Teste integrado de avisos globais', ...overrides }, overrides?.id ? 'update' : 'create');

  try {
    actor = await prisma.user.create({ data: { email: `${prefix}@example.invalid`, nome: 'Avisos QA',
      senha: await bcrypt.hash('Avisos@Senha1', 10), role: 'MASTER' } });
    const pngBytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);
    const created = await saveNotice(actor.id, base({ anexoNome: 'aviso.png',
      anexoBase64: `data:image/png;base64,${pngBytes.toString('base64')}` }));
    ids.push(created.id);

    await t.test('resposta e auditoria omitem conteúdo sensível e binário', async () => {
      assert.equal(created.version, 0);
      assert.equal(created.hasAttachment, true);
      assert.equal(Object.hasOwn(created, 'anexoBase64'), false);
      const row = await prisma.globalNotice.findUniqueOrThrow({ where: { id: created.id } });
      assert.match(row.anexoBase64, /^data:image\/png;base64,/);
      const log = await prisma.systemLog.findFirstOrThrow({ where: { userId: actor.id, action: 'GLOBAL_NOTICE_CREATED' } });
      assert.doesNotMatch(log.details || '', new RegExp(`${prefix}|base64`, 'i'));
    });

    await t.test('duas edições na mesma versão geram um vencedor e um conflito', async () => {
      const mutations = ['a', 'b'].map(suffix => base({ id: created.id, expectedVersion: created.version,
        titulo: `${prefix}-${suffix}`, anexoNome: 'aviso.png' }));
      const results = await Promise.allSettled(mutations.map(mutation => saveNotice(actor.id, mutation)));
      assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
      assert.equal(results.filter(result => result.status === 'rejected' && result.reason?.status === 409).length, 1);
      const row = await prisma.globalNotice.findUniqueOrThrow({ where: { id: created.id } });
      assert.equal(row.version, 1);
      assert.ok([`${prefix}-a`, `${prefix}-b`].includes(row.titulo));
    });

    await t.test('arquivamento é atômico, versionado e auditado', async () => {
      const current = await prisma.globalNotice.findUniqueOrThrow({ where: { id: created.id } });
      const archived = await archiveNotice(actor.id, parseNoticeArchive({ id: created.id, expectedVersion: current.version,
        adminPassword: 'não usado no serviço', justification: 'Encerramento do comunicado em QA' }));
      assert.equal(archived.status, 'ARQUIVADO');
      assert.equal(archived.version, current.version + 1);
      assert.ok(archived.arquivadoEm);
      assert.equal(await prisma.systemLog.count({ where: { userId: actor.id, action: 'GLOBAL_NOTICE_ARCHIVED' } }), 1);
    });
  } finally {
    if (actor) {
      await prisma.appNotification.deleteMany({ where: { recipientId: actor.id } });
      await prisma.systemLog.deleteMany({ where: { userId: actor.id } });
    }
    if (ids.length) await prisma.globalNotice.deleteMany({ where: { id: { in: ids } } });
    if (actor) await prisma.user.delete({ where: { id: actor.id } });
  }
});
