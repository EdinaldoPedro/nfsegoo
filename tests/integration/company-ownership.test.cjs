const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const bcrypt = require('bcryptjs');

test('PostgreSQL: transferencia de titularidade exige consentimento e preserva historia', { skip: process.env.ALLOW_TEST_DATABASE_WRITES !== 'true' }, async t => {
  require('./require-test-database.cjs')();
  const { prisma } = require('../../app/utils/prisma.ts');
  const { createOwnershipRequest: create, decideOwnershipRequest: decide, listOwnershipRequests: list } = require('../../app/services/companyOwnershipService.ts');
  const { hasEmpresaAccess } = require('../../app/utils/access-control.ts');
  const prefix = 'qa-ownership-' + randomUUID(), password = 'qa-' + randomUUID(), users = [], companyIds = [], ticketIds = [];
  let plan;
  const actor = user => ({ id: user.id, sessionVersion: user.sessionVersion, sessionId: user.sessionId });
  try {
    const hash = await bcrypt.hash(password, 4), now = new Date();
    for (const role of ['ADMIN', 'MASTER', 'COMUM', 'COMUM', 'CONTADOR', 'SUPORTE']) {
      const user = await prisma.user.create({ data: { nome: prefix, email: `${prefix}-${users.length}@qa.test`, senha: hash, role,
        sessionVersion: 0, limiteEmpresas: 20, ...(role === 'ADMIN' || role === 'MASTER' ? { mfaSecret: 'QA', mfaEnabledAt: now } : {}) } });
      const session = await prisma.authSession.create({ data: { userId: user.id, sessionVersion: 0, expiresAt: new Date(Date.now() + 3600000),
        ...(role === 'ADMIN' || role === 'MASTER' ? { mfaVerifiedAt: now } : {}) } });
      users.push({ ...user, sessionId: session.id });
    }
    const [admin, master, oldOwner, recipient, accountant, support] = users;
    plan = await prisma.plan.create({ data: { slug: prefix, name: prefix, tipo: 'PLANO', features: '[]', priceMonthly: 1, priceYearly: 12, maxClientes: 20, maxNotasMensal: 20 } });
    await prisma.planHistory.create({ data: { userId: recipient.id, planId: plan.id, dataInicio: new Date(Date.now() - 86400000),
      cicloInicio: new Date(Date.now() - 86400000), dataFim: new Date(Date.now() + 86400000), tipoContratado: 'PLANO',
      nomeContratado: prefix, limiteNotasContratado: 20, limiteClientesContratado: 20 } });
    const company = await prisma.empresa.create({ data: { documento: '11222333000181', razaoSocial: prefix, ambiente: 'PRODUCAO',
      proprietarioUserId: oldOwner.id, donoFaturamentoId: oldOwner.id, contadorCustodianteId: accountant.id,
      statusPropriedade: 'PROPRIETARIA', certificadoA1: 'QA-PFX', senhaCertificado: 'QA-SECRET', certificadoVencimento: new Date(Date.now() + 86400000) } });
    companyIds.push(company.id);
    await prisma.user.update({ where: { id: oldOwner.id }, data: { empresaId: company.id } });
    await prisma.userCliente.create({ data: { userId: support.id, empresaId: company.id, apelido: prefix } });
    await prisma.contadorVinculo.create({ data: { contadorId: accountant.id, empresaId: company.id, status: 'APROVADO' } });
    const customer = await prisma.cliente.create({ data: { empresaId: company.id, tipo: 'PF', documento: '12345678909', nome: prefix } });
    await prisma.vinculoCarteira.create({ data: { empresaId: company.id, clienteId: customer.id } });
    const note = await prisma.notaFiscal.create({ data: { empresaId: company.id, clienteId: customer.id, ambiente: 'PRODUCAO', valor: 10,
      descricao: prefix, status: 'AUTORIZADA', prestadorCnpj: company.documento, tomadorCnpj: customer.documento, xmlAutorizadoBase64: 'PFFBPg==' } });
    const ticket = await prisma.ticket.create({ data: { assunto: prefix, descricao: prefix, solicitanteId: recipient.id } }); ticketIds.push(ticket.id);
    const evidence = await prisma.ticketMensagem.create({ data: { ticketId: ticket.id, usuarioId: admin.id, interno: true, mensagem: 'Representação e autorização conferidas manualmente no atendimento.' } });
    const review = await prisma.ticketMensagem.create({ data: { ticketId: ticket.id, usuarioId: admin.id, interno: true, mensagem: 'Consentimentos, capacidade e ausência de operações conferidos.' } });
    const creation = { requestId: randomUUID(), empresaId: company.id, proposedOwnerId: recipient.id, caseTicketId: ticket.id,
      evidenceMessageId: evidence.id, password, justification: 'Transferência solicitada e verificada no chamado.', confirmedCnpj: company.documento, evidenceVerified: true };

    await t.test('abertura é idempotente, não concede acesso e só aparece aos participantes', async () => {
      const made = await create(actor(admin), creation);
      assert.equal(made.created, true); assert.equal(made.request.mode, 'TRANSFER');
      assert.equal((await create(actor(admin), creation)).created, false);
      assert.equal(await hasEmpresaAccess(recipient, company.id), false);
      assert.equal((await list(actor(recipient), new URLSearchParams())).data.length, 1);
      assert.equal((await list(actor(accountant), new URLSearchParams())).data.length, 0);
      await assert.rejects(create(actor(support), { ...creation, requestId: randomUUID() }), { status: 403 });
      await assert.rejects(create(actor(admin), { ...creation, requestId: randomUUID(), proposedOwnerId: accountant.id }), { status: 409 });
    });
    await t.test('hash, senha e todos os consentimentos são obrigatórios', async () => {
      const row = (await list(actor(oldOwner), new URLSearchParams())).data[0];
      await assert.rejects(decide(actor(oldOwner), { action: 'ACCEPT', requestId: row.id, termsHash: '0'.repeat(64), confirmedCnpj: company.documento, password, acknowledged: true }), { status: 409 });
      await assert.rejects(decide(actor(oldOwner), { action: 'ACCEPT', requestId: row.id, termsHash: row.termsHash, confirmedCnpj: company.documento, password: 'wrong', acknowledged: true }), { status: 403 });
      await decide(actor(oldOwner), { action: 'ACCEPT', requestId: row.id, termsHash: row.termsHash, confirmedCnpj: company.documento, password, acknowledged: true });
      await assert.rejects(decide(actor(admin), { action: 'FINALIZE', requestId: row.id, termsHash: row.termsHash, confirmedCnpj: company.documento,
        password, acknowledged: true, justification: 'Revisão administrativa final.', reviewEvidenceMessageId: review.id, evidenceVerified: true }), { status: 409 });
      await decide(actor(recipient), { action: 'ACCEPT', requestId: row.id, termsHash: row.termsHash, confirmedCnpj: company.documento, password, acknowledged: true });
    });
    await t.test('conclusão atômica revoga acesso sem apagar vínculo e preserva documento fiscal', async () => {
      const row = (await list(actor(admin), new URLSearchParams())).data[0];
      const result = await decide(actor(admin), { action: 'FINALIZE', requestId: row.id, termsHash: row.termsHash, confirmedCnpj: company.documento,
        password, acknowledged: true, justification: 'Revisão administrativa final concluída.', reviewEvidenceMessageId: review.id, evidenceVerified: true });
      assert.equal(result.request.status, 'COMPLETED');
      const saved = await prisma.empresa.findUniqueOrThrow({ where: { id: company.id } });
      assert.equal(saved.proprietarioUserId, recipient.id); assert.equal(saved.donoFaturamentoId, recipient.id);
      assert.equal(saved.contadorCustodianteId, null); assert.equal(saved.ambiente, 'HOMOLOGACAO');
      assert.equal(saved.certificadoA1, null); assert.equal(saved.senhaCertificado, null); assert.equal(saved.cadastroCompleto, false);
      const historical = await prisma.userCliente.findUniqueOrThrow({ where: { userId_empresaId: { userId: support.id, empresaId: company.id } } });
      assert.ok(historical.revokedAt); assert.equal(await hasEmpresaAccess(support, company.id), false);
      assert.equal((await prisma.contadorVinculo.findUniqueOrThrow({ where: { contadorId_empresaId: { contadorId: accountant.id, empresaId: company.id } } })).status, 'DESVINCULADO');
      assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: oldOwner.id } })).empresaId, null);
      assert.equal(await hasEmpresaAccess(oldOwner, company.id), false); assert.equal(await hasEmpresaAccess(recipient, company.id), true);
      assert.equal((await prisma.notaFiscal.findUniqueOrThrow({ where: { id: note.id } })).xmlAutorizadoBase64, 'PFFBPg==');
      assert.equal((await decide(actor(admin), { action: 'FINALIZE', requestId: row.id, termsHash: row.termsHash, confirmedCnpj: company.documento,
        password, acknowledged: true, justification: 'Repetição segura da operação.', reviewEvidenceMessageId: review.id, evidenceVerified: true })).changed, false);
      assert.equal(await prisma.systemLog.count({ where: { action: 'OWNERSHIP_REQUEST_COMPLETED', empresaId: company.id } }), 1);
    });
    await t.test('recuperação órfã exige outro MASTER e aguarda toda operação fiscal', async () => {
      const orphan = await prisma.empresa.create({ data: { documento: '11444777000161', razaoSocial: prefix, ambiente: 'HOMOLOGACAO' } });
      companyIds.push(orphan.id);
      const ticket = await prisma.ticket.create({ data: { assunto: prefix, descricao: prefix, solicitanteId: recipient.id } }); ticketIds.push(ticket.id);
      const evidence = await prisma.ticketMensagem.create({ data: { ticketId: ticket.id, usuarioId: admin.id, interno: true, mensagem: 'Ausência de responsável e representação conferidas manualmente.' } });
      const review = await prisma.ticketMensagem.create({ data: { ticketId: ticket.id, usuarioId: master.id, interno: true, mensagem: 'Revisão independente conferida por segundo MASTER.' } });
      const made = await create(actor(admin), { requestId: randomUUID(), empresaId: orphan.id, proposedOwnerId: recipient.id,
        caseTicketId: ticket.id, evidenceMessageId: evidence.id, password, justification: 'Recuperação de cadastro efetivamente órfão.',
        confirmedCnpj: orphan.documento, evidenceVerified: true });
      assert.equal(made.request.mode, 'RECOVERY');
      await decide(actor(recipient), { action: 'ACCEPT', requestId: made.request.id, termsHash: made.request.termsHash,
        confirmedCnpj: orphan.documento, password, acknowledged: true });
      const final = { action: 'FINALIZE', requestId: made.request.id, termsHash: made.request.termsHash, confirmedCnpj: orphan.documento,
        password, acknowledged: true, justification: 'Revisão independente da recuperação concluída.', reviewEvidenceMessageId: review.id, evidenceVerified: true };
      await assert.rejects(decide(actor(admin), final), { status: 403 });
      const job = await prisma.emissaoJob.create({ data: { empresaId: orphan.id, clienteId: customer.id, actorUserId: recipient.id,
        payloadJson: '{}', status: 'PENDENTE', idempotencyKey: randomUUID(), ambiente: 'HOMOLOGACAO' } });
      await assert.rejects(decide(actor(master), final), { status: 409 });
      await prisma.emissaoJob.update({ where: { id: job.id }, data: { status: 'ERRO_FINAL', finishedAt: new Date() } });
      assert.equal((await decide(actor(master), final)).request.status, 'COMPLETED');
      await prisma.emissaoJob.delete({ where: { id: job.id } });
    });
  } finally {
    const userIds = users.map(row => row.id);
    await prisma.user.updateMany({ where: { id: { in: userIds } }, data: { empresaId: null } });
    await prisma.companyOwnershipRequest.deleteMany({ where: { empresaId: { in: companyIds } } });
    await prisma.appNotification.deleteMany({ where: { recipientId: { in: userIds } } });
    await prisma.systemLog.deleteMany({ where: { OR: [{ userId: { in: userIds } }, { empresaId: { in: companyIds } }] } });
    await prisma.notaFiscal.deleteMany({ where: { empresaId: { in: companyIds } } });
    await prisma.vinculoCarteira.deleteMany({ where: { empresaId: { in: companyIds } } });
    await prisma.cliente.deleteMany({ where: { empresaId: { in: companyIds } } });
    await prisma.userCliente.deleteMany({ where: { empresaId: { in: companyIds } } });
    await prisma.contadorVinculo.deleteMany({ where: { empresaId: { in: companyIds } } });
    await prisma.empresa.deleteMany({ where: { id: { in: companyIds } } });
    await prisma.ticketMensagem.deleteMany({ where: { ticketId: { in: ticketIds } } });
    await prisma.ticket.deleteMany({ where: { id: { in: ticketIds } } });
    await prisma.planHistory.deleteMany({ where: { userId: { in: userIds } } });
    if (plan) await prisma.plan.delete({ where: { id: plan.id } });
    await prisma.authSession.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  }
});
