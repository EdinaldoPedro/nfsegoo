const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const bcrypt = require('bcryptjs');

function fixtureCnpj() {
  let base = 'QA' + randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase();
  for (let pass = 0; pass < 2; pass++) {
    let sum = 0, weight = 2;
    for (let index = base.length - 1; index >= 0; index--) { sum += (base.charCodeAt(index) - 48) * weight; weight = weight === 9 ? 2 : weight + 1; }
    const remainder = sum % 11; base += String(remainder < 2 ? 0 : 11 - remainder);
  }
  return base;
}

test('PostgreSQL: cadastro administrativo e preferencia principal nao transferem titularidade', { skip: process.env.ALLOW_TEST_DATABASE_WRITES !== 'true' }, async t => {
  require('./require-test-database.cjs')();
  const { prisma } = require('../../app/utils/prisma.ts');
  const { mutateAccountCompany: mutate, listAccountCompanies: list } = require('../../app/services/adminAccountCompanyService.ts');
  const { registerAdditionalCompany } = require('../../app/services/companyRegistrationService.ts');
  const { hasEmpresaAccess } = require('../../app/utils/access-control.ts');
  const prefix = 'qa-account-company-' + randomUUID(), password = 'qa-' + randomUUID();
  const users = [], companyIds = [];
  const authorization = { adminPassword: password, justification: 'Operação sintética autorizada para QA' };
  let admin, master, owner, accountant, other, quota, raceA, raceB, plan, first, second, customer, note;
  const register = (target, documento = fixtureCnpj(), actor = admin) => mutate(actor.id, target.id, { action: 'REGISTER_NEW', documento, razaoSocial: prefix, ...authorization });
  const primaryInput = async (target, empresaId) => ({ action: 'SET_PRIMARY', empresaId,
    expectedUserUpdatedAt: (await prisma.user.findUniqueOrThrow({ where: { id: target.id }, select: { updatedAt: true } })).updatedAt.toISOString(), ...authorization });
  const choose = async (target, empresaId, actor = admin) => mutate(actor.id, target.id, await primaryInput(target, empresaId));
  const createCompany = async (data = {}) => {
    const row = await prisma.empresa.create({ data: { documento: fixtureCnpj(), razaoSocial: prefix, ambiente: 'HOMOLOGACAO', ...data } });
    companyIds.push(row.id); return row;
  };
  const failingAudit = async work => {
    const original = prisma.$transaction.bind(prisma);
    prisma.$transaction = (callback, options) => original(tx => callback(new Proxy(tx, { get(target, prop) {
      if (prop === 'systemLog') return { ...target.systemLog, create: async () => { throw new Error('QA_AUDIT_FAILURE'); } };
      return Reflect.get(target, prop);
    } })), options);
    try { await work(); } finally { prisma.$transaction = original; }
  };
  try {
    const hash = await bcrypt.hash(password, 4);
    for (const role of ['ADMIN', 'MASTER', 'COMUM', 'CONTADOR', 'COMUM', 'CONTADOR', 'COMUM', 'COMUM', 'SUPORTE', 'SUPORTE_TI', 'COMERCIAL']) {
      users.push(await prisma.user.create({ data: { nome: prefix, email: `${prefix}-${users.length}@example.invalid`, senha: hash, role, limiteEmpresas: 30 } }));
    }
    [admin, master, owner, accountant, other, quota, raceA, raceB] = users;
    plan = await prisma.plan.create({ data: { slug: prefix, name: prefix, tipo: 'PLANO', features: '[]', priceMonthly: 1, priceYearly: 12, maxClientes: 20, maxNotasMensal: 20 } });
    for (const user of [owner, accountant, other, quota, raceA, raceB]) await prisma.planHistory.create({ data: { userId: user.id, planId: plan.id,
      dataInicio: new Date(Date.now() - 86400000), cicloInicio: new Date(Date.now() - 86400000), dataFim: new Date(Date.now() + 10 * 86400000),
      tipoContratado: 'PLANO', nomeContratado: prefix, limiteNotasContratado: 20, limiteClientesContratado: 20 } });
    first = await createCompany({ proprietarioUserId: owner.id, donoFaturamentoId: owner.id, contadorCustodianteId: accountant.id,
      certificadoA1: 'QA-NOT-A-REAL-PFX', senhaCertificado: 'QA-NOT-A-REAL-SECRET', ultimoDPS: 42, serieDPS: '900' });
    second = await createCompany({ proprietarioUserId: owner.id, donoFaturamentoId: owner.id });
    await prisma.user.update({ where: { id: owner.id }, data: { empresaId: first.id } });
    await prisma.contadorVinculo.create({ data: { contadorId: accountant.id, empresaId: first.id, status: 'APROVADO' } });
    customer = await prisma.cliente.create({ data: { empresaId: first.id, documento: '12345678909', nome: prefix, tipo: 'PF', vinculos: { create: {} } } });
    note = await prisma.notaFiscal.create({ data: { empresaId: first.id, clienteId: customer.id, descricao: prefix, valor: 1, status: 'AUTORIZADA', ambiente: 'HOMOLOGACAO', prestadorCnpj: first.documento, tomadorCnpj: customer.documento, xmlAutorizadoBase64: Buffer.from('<QA-sem-valor-fiscal/>').toString('base64') } });

    await t.test('lista paginada traz apenas empresas da conta, sem carregar segredo em consulta', async () => {
      const result = await list(admin.id, owner.id, new URLSearchParams('limit=1'));
      assert.equal(result.data.length, 1); assert.equal(result.meta.total, 2); assert.equal(result.meta.totalPages, 2);
      assert.equal(result.account.canChangePrimary, true); assert.equal(result.primary.id, first.id);
      const json = JSON.stringify(result);
      for (const value of ['QA-NOT-A-REAL-PFX', 'QA-NOT-A-REAL-SECRET', 'proprietarioUserId', 'senha', 'historicoPlanos', 'minhaCarteira', 'xml']) assert.equal(json.includes(value), false);
      const next = await list(master.id, owner.id, new URLSearchParams('limit=1&page=2'));
      assert.notEqual(result.data[0].id, next.data[0].id);
      assert.equal((await list(admin.id, other.id, new URLSearchParams())).meta.total, 0);
      await assert.rejects(list(admin.id, owner.id, new URLSearchParams('limit=26')), { status: 400 });
      for (const actor of users.filter(user => !['ADMIN', 'MASTER'].includes(user.role))) await assert.rejects(list(actor.id, owner.id, new URLSearchParams()), { status: 403 });
    });
    await t.test('papeis e senha atuais sao reconferidos; conta interna nao vira proprietaria por este fluxo', async () => {
      for (const actor of users.filter(user => !['ADMIN', 'MASTER'].includes(user.role))) await assert.rejects(register(owner, fixtureCnpj(), actor), { status: 403 });
      await assert.rejects(mutate(admin.id, owner.id, { action: 'REGISTER_NEW', documento: fixtureCnpj(), razaoSocial: prefix, ...authorization, adminPassword: 'wrong' }), { status: 403 });
      await assert.rejects(register(admin), { status: 409 });
      await prisma.user.update({ where: { id: admin.id }, data: { role: 'SUPORTE' } });
      try { await assert.rejects(register(owner), { status: 403 }); } finally { await prisma.user.update({ where: { id: admin.id }, data: { role: 'ADMIN' } }); }
      await prisma.user.update({ where: { id: owner.id }, data: { role: 'SUPORTE' } });
      try { await assert.rejects(register(owner), { status: 409 }); } finally { await prisma.user.update({ where: { id: owner.id }, data: { role: 'COMUM' } }); }
    });
    await t.test('cadastro novo e minimo, HOMO e auditado; nao cria contrato, custodia ou vinculo contabil', async () => {
      const contracts = await prisma.planHistory.count({ where: { userId: accountant.id } });
      const result = await register(accountant, fixtureCnpj(), master); companyIds.push(result.empresa.id);
      const row = await prisma.empresa.findUniqueOrThrow({ where: { id: result.empresa.id } });
      assert.equal(result.created, true); assert.equal(row.ambiente, 'HOMOLOGACAO'); assert.equal(row.cadastroCompleto, false);
      assert.equal(row.proprietarioUserId, accountant.id); assert.equal(row.donoFaturamentoId, accountant.id);
      assert.equal(row.contadorCustodianteId, null); assert.equal(row.certificadoA1, null); assert.equal(row.senhaCertificado, null);
      assert.equal(await prisma.contadorVinculo.count({ where: { empresaId: row.id } }), 0);
      assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: accountant.id } })).empresaId, null);
      assert.equal(await prisma.planHistory.count({ where: { userId: accountant.id } }), contracts);
      assert.equal(await prisma.systemLog.count({ where: { empresaId: row.id, action: 'ADMIN_NEW_COMPANY_REGISTERED', userId: master.id } }), 1);
      const again = await register(accountant, row.documento); assert.equal(again.created, false);
      assert.deepEqual(await prisma.empresa.findUniqueOrThrow({ where: { id: row.id } }), row);
      assert.equal(await prisma.systemLog.count({ where: { empresaId: row.id, action: 'ADMIN_NEW_COMPANY_REGISTERED' } }), 1);
      assert.deepEqual(Object.keys(again.empresa).sort(), ['ambiente', 'documento', 'id', 'razaoSocial']);
    });
    await t.test('CNPJ publico nao concede acesso a terceiro, orfao, custodia, faturamento ou registro arquivado', async () => {
      const rows = [first, await createCompany(), await createCompany({ contadorCustodianteId: other.id, donoFaturamentoId: other.id }),
        await createCompany({ donoFaturamentoId: other.id }), await createCompany({ proprietarioUserId: other.id, arquivadoEm: new Date() })];
      for (const row of rows) {
        const before = await prisma.empresa.findUniqueOrThrow({ where: { id: row.id } });
        await assert.rejects(register(other, row.documento), { status: 409 });
        await assert.rejects(choose(other, row.id), { status: 409 });
        assert.deepEqual(await prisma.empresa.findUniqueOrThrow({ where: { id: row.id } }), before);
        assert.equal(await hasEmpresaAccess(await prisma.user.findUniqueOrThrow({ where: { id: other.id } }), row.id), false);
      }
    });
    await t.test('cota concorrente compartilhada com cadastro do cliente permite somente uma nova empresa', async () => {
      await prisma.user.update({ where: { id: quota.id }, data: { limiteEmpresas: 1 } });
      const results = await Promise.allSettled(Array.from({ length: 6 }, (_, index) => index % 2
        ? register(quota, fixtureCnpj(), index % 3 ? admin : master)
        : registerAdditionalCompany(quota.id, { documento: fixtureCnpj(), razaoSocial: prefix })));
      const successes = results.filter(result => result.status === 'fulfilled');
      successes.forEach(result => companyIds.push(result.value.empresa.id));
      assert.equal(successes.length, 1); assert.ok(results.filter(result => result.status === 'rejected').every(result => result.reason.status === 403));
      assert.equal(await prisma.empresa.count({ where: { proprietarioUserId: quota.id } }), 1);
    });
    await t.test('pedidos contabeis pendentes e ausencia/suspensao de plano impedem novos cadastros', async () => {
      const pendingCompany = await createCompany({ proprietarioUserId: owner.id });
      await prisma.contadorVinculo.create({ data: { contadorId: quota.id, empresaId: pendingCompany.id, status: 'PENDENTE_DONO' } });
      await prisma.user.update({ where: { id: quota.id }, data: { limiteEmpresas: 2 } });
      await assert.rejects(register(quota), { status: 403 });
      await prisma.user.update({ where: { id: other.id }, data: { planoStatus: 'suspended' } });
      try { await assert.rejects(register(other), { status: 403 }); } finally { await prisma.user.update({ where: { id: other.id }, data: { planoStatus: 'active' } }); }
      await prisma.planHistory.updateMany({ where: { userId: other.id }, data: { status: 'EXPIRADO', dataFim: new Date(Date.now() - 60000) } });
      await assert.rejects(register(other), { status: 403 });
    });
    await t.test('mesmo CNPJ concorrente entre contas gera um cadastro global, sem transferencia automatica', async () => {
      const documento = fixtureCnpj();
      const results = await Promise.allSettled([register(raceA, documento, admin), register(raceB, documento, master)]);
      const winners = results.filter(result => result.status === 'fulfilled');
      assert.equal(winners.length, 1); companyIds.push(winners[0].value.empresa.id);
      assert.equal(results.find(result => result.status === 'rejected').reason.status, 409);
      assert.equal(await prisma.empresa.count({ where: { documento } }), 1);
      assert.equal(await prisma.systemLog.count({ where: { empresaId: winners[0].value.empresa.id, action: 'ADMIN_NEW_COMPANY_REGISTERED' } }), 1);
    });
    await t.test('falha de auditoria reverte criacao e selecao principal integralmente', async () => {
      const documento = fixtureCnpj(), before = await prisma.user.findUniqueOrThrow({ where: { id: owner.id } });
      await failingAudit(async () => {
        await assert.rejects(register(owner, documento), /QA_AUDIT_FAILURE/);
        await assert.rejects(choose(owner, second.id), /QA_AUDIT_FAILURE/);
      });
      assert.equal(await prisma.empresa.count({ where: { documento } }), 0);
      assert.deepEqual(await prisma.user.findUniqueOrThrow({ where: { id: owner.id } }), before);
    });
    await t.test('troca/limpeza da principal preserva acesso aos dois cadastros, XML, certificado, contrato e vinculos', async () => {
      const before = await prisma.empresa.findUniqueOrThrow({ where: { id: first.id }, include: { contadoresLink: true } });
      const contract = await prisma.planHistory.findMany({ where: { userId: owner.id } });
      await choose(owner, second.id);
      assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: owner.id } })).empresaId, second.id);
      await choose(owner, null);
      const user = await prisma.user.findUniqueOrThrow({ where: { id: owner.id } }); assert.equal(user.empresaId, null);
      for (const empresaId of [first.id, second.id]) assert.equal(await hasEmpresaAccess(user, empresaId), true);
      assert.deepEqual(await prisma.empresa.findUniqueOrThrow({ where: { id: first.id }, include: { contadoresLink: true } }), before);
      assert.deepEqual(await prisma.notaFiscal.findUniqueOrThrow({ where: { id: note.id } }), note);
      assert.deepEqual(await prisma.planHistory.findMany({ where: { userId: owner.id } }), contract);
      // Navigation to already owned history does not depend on a new subscription.
      await prisma.user.update({ where: { id: owner.id }, data: { planoStatus: 'suspended' } });
      try { await choose(owner, first.id); } finally { await prisma.user.update({ where: { id: owner.id }, data: { planoStatus: 'active' } }); }
    });
    await t.test('versao concorrente permite uma escolha, um log; replay fresco sem mudanca nao duplica auditoria', async () => {
      const input = await primaryInput(owner, second.id);
      const count = await prisma.systemLog.count({ where: { userId: { in: [admin.id, master.id] }, action: 'USER_PRIMARY_COMPANY_SELECTED' } });
      const results = await Promise.allSettled(Array.from({ length: 4 }, (_, index) => mutate(index % 2 ? admin.id : master.id, owner.id, input)));
      assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
      assert.ok(results.filter(result => result.status === 'rejected').every(result => result.reason.status === 409));
      assert.equal((await choose(owner, second.id)).changed, false);
      assert.equal(await prisma.systemLog.count({ where: { userId: { in: [admin.id, master.id] }, action: 'USER_PRIMARY_COMPANY_SELECTED' } }), count + 1);
    });
    await t.test('principal legado nao e abandonada; empresa com outro principal nao pode ser capturada', async () => {
      const legacy = await createCompany();
      await prisma.user.update({ where: { id: other.id }, data: { empresaId: legacy.id } });
      assert.equal((await list(admin.id, other.id, new URLSearchParams())).account.canChangePrimary, false);
      await assert.rejects(choose(other, null), { status: 409 });
      await assert.rejects(choose(other, second.id), { status: 409 });
      assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: other.id } })).empresaId, legacy.id);
      const inconsistent = await createCompany({ proprietarioUserId: owner.id });
      await prisma.user.update({ where: { id: raceA.id }, data: { empresaId: inconsistent.id } });
      await assert.rejects(choose(owner, inconsistent.id), { status: 409 });
      assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: raceA.id } })).empresaId, inconsistent.id);
    });
    await t.test('auditoria registra responsavel, alvo e justificativa, nunca senha ou material fiscal', async () => {
      const logs = await prisma.systemLog.findMany({ where: { userId: { in: [admin.id, master.id] }, action: { in: ['ADMIN_NEW_COMPANY_REGISTERED', 'USER_PRIMARY_COMPANY_SELECTED'] } } });
      assert.ok(logs.length >= 5);
      for (const row of logs) { const details = JSON.parse(row.details); assert.ok(details.targetUserId); assert.equal(details.justification, authorization.justification); }
      const json = JSON.stringify(logs);
      for (const value of [password, 'QA-NOT-A-REAL-PFX', 'QA-NOT-A-REAL-SECRET', note.xmlAutorizadoBase64]) assert.equal(json.includes(value), false);
    });
  } finally {
    const userIds = users.map(user => user.id);
    const associated = await prisma.empresa.findMany({ where: { OR: [{ id: { in: companyIds } }, { proprietarioUserId: { in: userIds } }] }, select: { id: true } });
    const ids = associated.map(row => row.id);
    await prisma.user.updateMany({ where: { id: { in: userIds } }, data: { empresaId: null } });
    await prisma.notaFiscal.deleteMany({ where: { empresaId: { in: ids } } });
    await prisma.vinculoCarteira.deleteMany({ where: { empresaId: { in: ids } } });
    await prisma.cliente.deleteMany({ where: { empresaId: { in: ids } } });
    await prisma.contadorVinculo.deleteMany({ where: { OR: [{ empresaId: { in: ids } }, { contadorId: { in: userIds } }] } });
    await prisma.systemLog.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.planHistory.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.empresa.deleteMany({ where: { id: { in: ids } } });
    if (plan) await prisma.plan.delete({ where: { id: plan.id } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  }
});
