const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const bcrypt = require('bcryptjs');

test('manutencao administrativa PostgreSQL: escopo, versao, arquivo reversivel, cotas e auditoria atomica', { skip: process.env.ALLOW_TEST_DATABASE_WRITES !== 'true' }, async t => {
  require('./require-test-database.cjs')();
  const { prisma } = require('../../app/utils/prisma.ts');
  const { mutateAdminCompany: mutate, listAdminCompanies: list } = require('../../app/services/adminCompanyService.ts');
  const { criarEmissaoJob } = require('../../app/services/emissaoJobService.ts');
  const prefix = 'qa-admin-company-' + randomUUID();
  const password = 'synthetic-' + randomUUID(); const users = [], companies = [];
  let owner, admin, master, company, otherCompany, customer, otherCustomer, plan, history;
  const currentInput = async (record, action = 'UPDATE', data = { razaoSocial: 'Nome revisado em QA' }) => {
    const isCompany = companies.includes(record.id);
    const row = await (isCompany ? prisma.empresa : prisma.cliente).findUniqueOrThrow({ where: { id: record.id } });
    return { id: row.id, origem: isCompany ? 'PRESTADOR' : 'TOMADOR', empresaId: isCompany ? undefined : row.empresaId,
      expectedUpdatedAt: row.updatedAt.toISOString(), action, ...(action === 'UPDATE' ? { data } : {}), adminPassword: password,
      justification: 'Operação sintética autorizada para QA' };
  };
  const save = async (record, action, data, actor = admin) => mutate(actor.id, await currentInput(record, action, data));
  try {
    const hash = await bcrypt.hash(password, 4);
    for (const role of ['COMUM', 'ADMIN', 'MASTER', 'CONTADOR', 'SUPORTE', 'SUPORTE_TI', 'COMERCIAL']) users.push(await prisma.user.create({ data: {
      email: `${prefix}-${role}@example.invalid`, nome: 'Pessoa sintética QA', senha: hash, role, limiteEmpresas: 5,
    } }));
    [owner, admin, master] = users;
    plan = await prisma.plan.create({ data: { slug: prefix, name: prefix, tipo: 'PLANO', features: '[]', priceMonthly: 1, priceYearly: 12, maxClientes: 100, maxNotasMensal: 20 } });
    history = await prisma.planHistory.create({ data: { userId: owner.id, planId: plan.id, dataInicio: new Date(Date.now() - 86400000), cicloInicio: new Date(Date.now() - 86400000),
      dataFim: new Date(Date.now() + 10 * 86400000), tipoContratado: 'PLANO', nomeContratado: plan.name, limiteClientesContratado: 100, limiteNotasContratado: 20 } });
    for (let index = 0; index < 2; index++) {
      const row = await prisma.empresa.create({ data: { documento: prefix + index, razaoSocial: prefix + index,
        ambiente: 'HOMOLOGACAO', proprietarioUserId: owner.id, donoFaturamentoId: owner.id, regimeTributario: 'MEI',
        certificadoA1: 'QA-CERTIFICATE-NOT-REAL', senhaCertificado: 'QA-ENCRYPTED-PASSWORD', serieDPS: '900', ultimoDPS: 42,
        cep: '01001000', logradouro: 'Rua QA', numero: '10', bairro: 'Centro', cidade: 'São Paulo', uf: 'SP', codigoIbge: '3550308',
        atividades: { create: { codigo: '6201501', descricao: 'Atividade de QA', principal: true } } } });
      companies.push(row.id); if (!index) company = row; else otherCompany = row;
    }
    await prisma.user.update({ where: { id: owner.id }, data: { empresaId: company.id } });
    const customerData = { nome: prefix, documento: '12345678909', tipo: 'PF', cep: '01001000', logradouro: 'Rua QA', numero: '10', bairro: 'Centro', cidade: 'São Paulo', uf: 'SP', codigoIbge: '3550308', vinculos: { create: {} } };
    customer = await prisma.cliente.create({ data: { ...customerData, empresaId: company.id } });
    otherCustomer = await prisma.cliente.create({ data: { ...customerData, empresaId: otherCompany.id } });

    await t.test('listagem delimitada identifica tenant e nao retorna nem carrega segredos', async () => {
      const response = await list(new URLSearchParams({ type: 'PRESTADOR', search: prefix, limit: '1' }));
      assert.equal(response.data.length, 1); assert.equal(response.meta.total, 2); assert.equal(response.meta.totalPages, 2);
      const json = JSON.stringify(response);
      for (const secret of ['QA-CERTIFICATE-NOT-REAL', 'QA-ENCRYPTED-PASSWORD', 'certificadoA1', 'senhaCertificado', 'minhaCarteira']) assert.equal(json.includes(secret), false);
      const scoped = await list(new URLSearchParams({ type: 'TOMADOR', empresaId: company.id, search: prefix }));
      assert.equal(scoped.data.length, 1); assert.equal(scoped.data[0].id, customer.id); assert.equal(scoped.data[0].empresa.id, company.id);
      assert.equal((await list(new URLSearchParams({ type: 'TOMADOR', search: prefix }))).meta.total, 2);
    });
    await t.test('papel atual e senha atual sao conferidos antes de qualquer gravacao', async () => {
      const before = await prisma.empresa.findUniqueOrThrow({ where: { id: company.id } });
      for (const actor of users.filter(user => !['ADMIN', 'MASTER'].includes(user.role))) await assert.rejects(save(company, 'UPDATE', undefined, actor), { status: 403 });
      await assert.rejects(mutate(admin.id, { ...await currentInput(company), adminPassword: 'incorrect' }), { status: 403 });
      assert.deepEqual(await prisma.empresa.findUniqueOrThrow({ where: { id: company.id } }), before);
      await save(company, 'UPDATE', { razaoSocial: prefix + ' revisada', email: 'CONTATO@EXAMPLE.INVALID', complemento: 'Sala QA' }, master);
      const after = await prisma.empresa.findUniqueOrThrow({ where: { id: company.id } });
      assert.equal(after.email, 'contato@example.invalid'); assert.equal(after.complemento, 'Sala QA'); assert.equal(after.cadastroCompleto, true);
      for (const key of ['documento', 'ambiente', 'ultimoDPS', 'serieDPS', 'certificadoA1', 'senhaCertificado', 'proprietarioUserId']) assert.equal(after[key], before[key]);
    });
    await t.test('entrada indevida, versao vencida e tenant trocado nao deixam alteracoes parciais', async () => {
      const before = await prisma.cliente.findUniqueOrThrow({ where: { id: customer.id } });
      await assert.rejects(mutate(admin.id, { ...await currentInput(customer), empresaId: otherCompany.id }), { status: 404 });
      await assert.rejects(mutate(admin.id, { ...await currentInput(customer), expectedUpdatedAt: '2000-01-01T00:00:00.000Z' }), { status: 409 });
      for (const extra of [{ documento: '123' }, { empresaId: otherCompany.id }, { uf: 'XX' }, { cep: '123' }, { codigoIbge: '35503xx' }]) await assert.rejects(save(customer, 'UPDATE', extra), { status: 400 });
      assert.deepEqual(await prisma.cliente.findUniqueOrThrow({ where: { id: customer.id } }), before);
      await save(customer, 'UPDATE', { razaoSocial: prefix + ' corrigido', email: 'cliente@example.invalid' });
      assert.equal((await prisma.cliente.findUniqueOrThrow({ where: { id: otherCustomer.id } })).nome, otherCustomer.nome);
    });
    await t.test('cinco edicoes concorrentes da mesma versao geram uma gravacao e um log', async () => {
      const input = await currentInput(company);
      const before = await prisma.systemLog.count({ where: { empresaId: company.id, action: 'ADMIN_PRESTADOR_UPDATE' } });
      const results = await Promise.allSettled(Array.from({ length: 5 }, (_, i) => mutate(i % 2 ? master.id : admin.id, input)));
      assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
      assert.ok(results.filter(result => result.status === 'rejected').every(result => result.reason.status === 409));
      assert.equal(await prisma.systemLog.count({ where: { empresaId: company.id, action: 'ADMIN_PRESTADOR_UPDATE' } }), before + 1);
    });
    await t.test('falha de auditoria apos UPDATE e arquivo da carteira reverte ambos no PostgreSQL', async () => {
      const before = await prisma.cliente.findUniqueOrThrow({ where: { id: customer.id }, include: { vinculos: true } });
      const originalTransaction = prisma.$transaction.bind(prisma);
      prisma.$transaction = (work, options) => originalTransaction(tx => work(new Proxy(tx, { get(target, prop) {
        if (prop === 'systemLog') return { ...target.systemLog, create: async () => { throw new Error('QA_AUDIT_FAILURE'); } };
        return Reflect.get(target, prop);
      } })), options);
      try { await assert.rejects(save(customer, 'ARCHIVE'), /QA_AUDIT_FAILURE/); }
      finally { prisma.$transaction = originalTransaction; }
      assert.deepEqual(await prisma.cliente.findUniqueOrThrow({ where: { id: customer.id }, include: { vinculos: true } }), before);
    });
    await t.test('notas, vendas, jobs mesmo encerrados e rascunhos impedem ocultar empresa', async () => {
      const common = { empresaId: company.id, clienteId: customer.id };
      const records = [
        ['notaFiscal', { ...common, valor: 1, descricao: 'QA', prestadorCnpj: company.documento, tomadorCnpj: customer.documento, status: 'CANCELADA', ambiente: 'HOMOLOGACAO' }],
        ['venda', { ...common, valor: 1, descricao: 'QA', status: 'PENDENTE' }],
        ['emissaoJob', { ...common, actorUserId: owner.id, payloadJson: '{}', idempotencyKey: randomUUID(), status: 'ERRO_FINAL' }],
        ['notaRascunho', { empresaId: company.id, userId: owner.id, motivo: 'QA', motivoTipo: 'QA', payloadJson: '{}' }],
      ];
      for (const [model, data] of records) {
        const row = await prisma[model].create({ data });
        try { await assert.rejects(save(company, 'ARCHIVE'), { status: 409 }); assert.equal((await prisma.empresa.findUniqueOrThrow({ where: { id: company.id } })).arquivadoEm, null); }
        finally { await prisma[model].delete({ where: { id: row.id } }); }
      }
    });
    await t.test('arquivo/restauracao de empresa preservam propriedade e carteira; ambas as cotas sao verificadas', async () => {
      await save(company, 'ARCHIVE');
      let row = await prisma.empresa.findUniqueOrThrow({ where: { id: company.id } });
      assert.ok(row.arquivadoEm); assert.equal(row.proprietarioUserId, owner.id); assert.equal(row.donoFaturamentoId, owner.id);
      assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: owner.id } })).empresaId, company.id);
      assert.equal((await prisma.vinculoCarteira.findUniqueOrThrow({ where: { empresaId_clienteId: { empresaId: company.id, clienteId: customer.id } } })).arquivadoEm, null);
      await assert.rejects(save(customer, 'UPDATE'), { status: 409 });
      await prisma.user.update({ where: { id: owner.id }, data: { limiteEmpresas: 1 } });
      await assert.rejects(save(company, 'RESTORE'), { status: 409 });
      await prisma.user.update({ where: { id: owner.id }, data: { limiteEmpresas: 5 } });
      await prisma.planHistory.update({ where: { id: history.id }, data: { limiteClientesContratado: 1 } });
      await assert.rejects(save(company, 'RESTORE'), { status: 409 });
      await prisma.planHistory.update({ where: { id: history.id }, data: { limiteClientesContratado: 100 } });
      await save(company, 'RESTORE'); row = await prisma.empresa.findUniqueOrThrow({ where: { id: company.id } });
      assert.equal(row.arquivadoEm, null); assert.equal(row.proprietarioUserId, owner.id); assert.equal(row.ambiente, 'HOMOLOGACAO');
    });
    await t.test('emissao pendente ou transmitida sem conciliacao impede arquivar tomador', async () => {
      const job = await prisma.emissaoJob.create({ data: { empresaId: company.id, clienteId: customer.id, actorUserId: owner.id, payloadJson: '{}', idempotencyKey: randomUUID() } });
      try {
        await assert.rejects(save(customer, 'ARCHIVE'), { status: 409 });
        await prisma.emissaoJob.update({ where: { id: job.id }, data: { status: 'ERRO_FINAL', transmissionStartedAt: new Date() } });
        await assert.rejects(save(customer, 'ARCHIVE'), { status: 409 });
      } finally { await prisma.emissaoJob.delete({ where: { id: job.id } }); }
    });
    await t.test('arquivar tomador preserva documentos e outra carteira; restaurar confere cota', async () => {
      const note = await prisma.notaFiscal.create({ data: { empresaId: company.id, clienteId: customer.id, valor: 1, descricao: 'Nota QA preservada', status: 'AUTORIZADA', ambiente: 'HOMOLOGACAO',
        prestadorCnpj: company.documento, tomadorCnpj: customer.documento, tomadorNome: 'Nome fiscal congelado', xmlAutorizadoBase64: 'QA-DOCUMENT-NOT-REAL' } });
      try {
        await save(customer, 'ARCHIVE');
        assert.deepEqual(await prisma.notaFiscal.findUniqueOrThrow({ where: { id: note.id } }), note);
        assert.equal((await prisma.cliente.findUniqueOrThrow({ where: { id: otherCustomer.id } })).arquivadoEm, null);
        const archived = await list(new URLSearchParams({ type: 'TOMADOR', empresaId: company.id, state: 'ARQUIVADOS' }));
        assert.equal(archived.data[0].id, customer.id); assert.equal(archived.data[0].archived, true);
        await prisma.planHistory.update({ where: { id: history.id }, data: { limiteClientesContratado: 1 } });
        await assert.rejects(save(customer, 'RESTORE'), { status: 409 });
        await prisma.planHistory.update({ where: { id: history.id }, data: { limiteClientesContratado: 100 } });
        await save(customer, 'RESTORE');
        assert.equal((await prisma.cliente.findUniqueOrThrow({ where: { id: customer.id } })).arquivadoEm, null);
        assert.deepEqual(await prisma.notaFiscal.findUniqueOrThrow({ where: { id: note.id } }), note);
      } finally { await prisma.notaFiscal.delete({ where: { id: note.id } }); }
    });
    await t.test('tomador arquivado enquanto emissao aguarda lock nao gera venda, job ou reserva', async () => {
      const commercial = require('../../app/services/commercialService.ts');
      const original = commercial.commercialTransaction;
      let reached, resume;
      const barrier = new Promise(resolve => { reached = resolve; }); const release = new Promise(resolve => { resume = resolve; });
      commercial.commercialTransaction = async (...args) => { reached(); await release; return original(...args); };
      let pending;
      try {
        pending = criarEmissaoJob({ userId: owner.id, contextId: company.id, idempotencyKey: randomUUID(), body: {
          empresaConfirmadaId: company.id, ambienteConfirmado: 'HOMOLOGACAO', clienteId: customer.id, valor: '10.00', descricao: 'QA barreira', codigoCnae: '6201501',
        } });
        const outcome = pending.then(value => ({ value }), error => ({ error }));
        await Promise.race([barrier, outcome.then(result => { throw result.error || new Error('Barreira não alcançada'); })]);
        await save(customer, 'ARCHIVE'); resume();
        const result = await outcome; assert.equal(result.error?.status, 409);
        assert.equal(await prisma.emissaoJob.count({ where: { empresaId: company.id } }), 0);
        assert.equal(await prisma.venda.count({ where: { empresaId: company.id } }), 0);
        assert.equal(await prisma.emissionCreditReservation.count({ where: { userId: owner.id } }), 0);
      } finally { resume(); commercial.commercialTransaction = original; if (pending) await pending.catch(() => {}); }
      await save(customer, 'RESTORE');
    });
    await t.test('consulta do tomador usa a transacao fornecida, inclusive antes do commit', async () => {
      const { findTenantCustomer } = require('../../app/services/tenantCustomerService.ts');
      const before = await prisma.cliente.findUniqueOrThrow({ where: { id: customer.id } });
      await assert.rejects(prisma.$transaction(async tx => {
        await tx.cliente.update({ where: { id: customer.id }, data: { nome: 'QA mudança não confirmada' } });
        assert.equal((await findTenantCustomer(customer.id, company.id, tx)).nome, 'QA mudança não confirmada');
        throw new Error('QA_ROLLBACK');
      }), /QA_ROLLBACK/);
      assert.deepEqual(await prisma.cliente.findUniqueOrThrow({ where: { id: customer.id } }), before);
    });
    await t.test('auditoria e resposta nao incluem senha ou material de certificado', async () => {
      const response = await save(company, 'UPDATE', { razaoSocial: prefix + ' final' });
      assert.deepEqual(Object.keys(response).sort(), ['id', 'success', 'updatedAt']);
      const logs = await prisma.systemLog.findMany({ where: { empresaId: company.id } });
      assert.ok(logs.length > 5);
      for (const secret of [password, 'QA-CERTIFICATE-NOT-REAL', 'QA-ENCRYPTED-PASSWORD']) assert.equal(JSON.stringify({ response, logs }).includes(secret), false);
    });
  } finally {
    const userIds = users.map(user => user.id);
    if (companies.length) {
      await prisma.systemLog.deleteMany({ where: { empresaId: { in: companies } } });
      await prisma.notaRascunho.deleteMany({ where: { empresaId: { in: companies } } });
      await prisma.emissaoJob.deleteMany({ where: { empresaId: { in: companies } } });
      await prisma.notaFiscal.deleteMany({ where: { empresaId: { in: companies } } });
      await prisma.venda.deleteMany({ where: { empresaId: { in: companies } } });
      await prisma.cliente.deleteMany({ where: { empresaId: { in: companies } } });
      await prisma.user.updateMany({ where: { id: { in: userIds } }, data: { empresaId: null } });
      await prisma.empresa.deleteMany({ where: { id: { in: companies } } });
    }
    if (userIds.length) { await prisma.planHistory.deleteMany({ where: { userId: { in: userIds } } }); await prisma.user.deleteMany({ where: { id: { in: userIds } } }); }
    if (plan) await prisma.plan.delete({ where: { id: plan.id } });
  }
});
