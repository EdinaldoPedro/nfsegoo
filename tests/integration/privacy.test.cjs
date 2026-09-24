const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const bcrypt = require('bcryptjs');

function cnpj() {
  let value = 'LG' + randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase();
  for (let pass = 0; pass < 2; pass++) {
    let sum = 0, weight = 2;
    for (let i = value.length - 1; i >= 0; i--) { sum += (value.charCodeAt(i) - 48) * weight; weight = weight === 9 ? 2 : weight + 1; }
    value += String(sum % 11 < 2 ? 0 : 11 - sum % 11);
  }
  return value;
}

test('LGPD PostgreSQL: protocolo, exportação, prazo e anonimização com bloqueios', { skip: process.env.ALLOW_TEST_DATABASE_WRITES !== 'true' }, async t => {
  require('./require-test-database.cjs')();
  const { prisma } = require('../../app/utils/prisma.ts');
  const { createPrivacyRequest, privacyAccountExport, privacyOverview, resolvePrivacyRequest } = require('../../app/services/privacyService.ts');
  const password = 'Privacidade@123'; const prefix = `qa-privacy-${randomUUID()}`;
  let subject, admin, company;
  try {
    const hash = await bcrypt.hash(password, 4);
    subject = await prisma.user.create({ data: { email: `${prefix}@example.invalid`, nome: 'Titular LGPD QA', cpf: '12345678909', senha: hash, role: 'COMUM', telefone: '11999999999' } });
    admin = await prisma.user.create({ data: { email: `${prefix}-admin@example.invalid`, nome: 'Admin LGPD QA', senha: hash, role: 'ADMIN' } });
    await prisma.legalAcceptance.create({ data: { userId: subject.id, termsVersion: 'qa-terms', privacyVersion: 'qa-privacy', acceptedAt: new Date(), source: 'QA' } });
    await prisma.authSession.create({ data: { userId: subject.id, sessionVersion: 0, ipAddress: '192.0.2.10', userAgent: 'QA browser', expiresAt: new Date(Date.now() + 3600_000) } });

    await t.test('senha errada não protocola; repetição idêntica reutiliza pedido aberto', async () => {
      await assert.rejects(createPrivacyRequest(subject.id, { type: 'ACESSO', password: 'errada' }), { status: 403 });
      const first = await createPrivacyRequest(subject.id, { type: 'ACESSO', description: 'Quero confirmar todos os dados associados à minha conta.', password });
      const second = await createPrivacyRequest(subject.id, { type: 'ACESSO', description: 'Outro texto que não deve duplicar o protocolo.', password });
      assert.equal(first.created, true); assert.equal(second.created, false); assert.equal(second.request.id, first.request.id);
      const days = (first.request.dueAt.getTime() - first.request.createdAt.getTime()) / 86400000;
      assert.ok(days > 14.99 && days <= 15.01);
      const overview = await privacyOverview(subject.id);
      assert.equal(overview.treatmentExists, true); assert.equal(overview.counts.activeSessions, 1); assert.equal(overview.requests.length, 1);
    });

    await t.test('exportação própria inclui consentimento e não inclui senha, MFA ou binários', async () => {
      const exported = await privacyAccountExport(subject.id, password);
      assert.equal(exported.data.account.email, subject.email);
      assert.equal(exported.data.acceptances.length, 1);
      const json = JSON.stringify(exported);
      for (const secret of [hash, 'senha', 'mfaSecret', 'anexoBase64']) assert.equal(json.includes(secret), false);
      await assert.rejects(privacyAccountExport(subject.id, 'errada'), { status: 403 });
    });

    await t.test('eliminação não ultrapassa vínculo societário/fiscal pendente', async () => {
      company = await prisma.empresa.create({ data: { documento: cnpj(), razaoSocial: 'Empresa bloqueadora LGPD', proprietarioUserId: subject.id, donoFaturamentoId: subject.id } });
      await prisma.user.update({ where: { id: subject.id }, data: { empresaId: company.id } });
      const created = await createPrivacyRequest(subject.id, { type: 'ELIMINACAO', description: 'Solicito eliminação e análise das obrigações de conservação.', password });
      await assert.rejects(resolvePrivacyRequest(admin.id, { id: created.request.id, action: 'ANONIMIZAR', version: created.request.version,
        resolutionSummary: 'Anonimização aprovada após análise dos vínculos.', legalBasis: 'LGPD artigos 16 e 18.', password, justification: 'QA' }), { status: 409 });
      assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: subject.id } })).privacyErasedAt, null);
      await prisma.user.update({ where: { id: subject.id }, data: { empresaId: null } });
      await prisma.empresa.delete({ where: { id: company.id } }); company = null;
    });

    await t.test('sem bloqueadores, anonimização revoga acesso e preserva protocolo/auditoria', async () => {
      const request = await prisma.privacyRequest.findFirstOrThrow({ where: { userId: subject.id, type: 'ELIMINACAO' } });
      const result = await resolvePrivacyRequest(admin.id, { id: request.id, action: 'ANONIMIZAR', version: request.version,
        resolutionSummary: 'Identificadores diretos removidos e acessos revogados.', legalBasis: 'Atendimento do direito após verificação de retenções.', password, justification: 'QA' });
      assert.equal(result.status, 'CONCLUIDA');
      const erased = await prisma.user.findUniqueOrThrow({ where: { id: subject.id } });
      assert.ok(erased.privacyErasedAt instanceof Date); assert.equal(erased.cpf, null); assert.equal(erased.telefone, null);
      assert.match(erased.email, /^erased-[a-f0-9]{32}@anon\.invalid$/); assert.equal(erased.nome, 'Titular anonimizado');
      assert.equal(await prisma.authSession.count({ where: { userId: subject.id } }), 0);
      assert.equal(await prisma.privacyRequest.count({ where: { userId: subject.id } }), 2);
      assert.equal(await prisma.systemLog.count({ where: { action: 'PRIVACY_REQUEST_ANONIMIZAR', userId: admin.id } }), 1);
      await assert.rejects(privacyOverview(subject.id), { status: 404 });
    });
  } finally {
    if (company) { await prisma.user.updateMany({ where: { id: subject?.id }, data: { empresaId: null } }); await prisma.empresa.deleteMany({ where: { id: company.id } }); }
    const ids = [subject?.id, admin?.id].filter(Boolean);
    if (ids.length) {
      await prisma.systemLog.deleteMany({ where: { userId: { in: ids } } });
      await prisma.authSession.deleteMany({ where: { userId: { in: ids } } });
      await prisma.legalAcceptance.deleteMany({ where: { userId: { in: ids } } });
      await prisma.privacyRequest.deleteMany({ where: { OR: [{ userId: { in: ids } }, { resolvedById: { in: ids } }] } });
      await prisma.user.deleteMany({ where: { id: { in: ids } } });
    }
  }
});
