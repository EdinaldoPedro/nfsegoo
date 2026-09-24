const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const bcrypt = require('bcryptjs');

function cnpj() {
  let value = 'QA' + randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase();
  for (let pass = 0; pass < 2; pass++) {
    let sum = 0, weight = 2;
    for (let i = value.length - 1; i >= 0; i--) { sum += (value.charCodeAt(i) - 48) * weight; weight = weight === 9 ? 2 : weight + 1; }
    value += String(sum % 11 < 2 ? 0 : 11 - sum % 11);
  }
  return value;
}

test('perfil PostgreSQL: empresa/conta atomicas, versao, permissao, cotas e reautenticacao', { skip: process.env.ALLOW_TEST_DATABASE_WRITES !== 'true' }, async t => {
  require('./require-test-database.cjs')();
  const { prisma } = require('../../app/utils/prisma.ts');
  const { updateProfile } = require('../../app/services/profileService.ts');
  const prefix = 'qa-profile-' + randomUUID(); const users = [], companies = []; let plan;
  const password = 'synthetic-' + randomUUID();
  const activity = { codigo: '6201-5/01', descricao: 'Atividade isolada de QA', principal: true };
  const base = { escopo: 'EMPRESA', razaoSocial: 'Empresa QA', regimeTributario: 'MEI', cnaes: [activity], ambiente: 'HOMOLOGACAO',
    emailComercial: 'empresa@example.invalid', cep: '01001-000', logradouro: 'Rua de QA', numero: '10', complemento: 'Sala 3', bairro: 'Centro', cidade: 'São Paulo', uf: 'SP', codigoIbge: '3550308' };
  let owner, accountant, stranger, support, commercial, admin, master, newcomer, pendingOwner, company;
  try {
    const hash = await bcrypt.hash(password, 4);
    for (const role of ['COMUM', 'CONTADOR', 'COMUM', 'SUPORTE', 'COMERCIAL', 'ADMIN', 'MASTER', 'COMUM', 'COMUM']) users.push(await prisma.user.create({ data: {
      email: `${prefix}-${users.length}@example.invalid`, nome: 'Perfil pessoal original', senha: hash, role, limiteEmpresas: 1,
    } }));
    [owner, accountant, stranger, support, commercial, admin, master, newcomer, pendingOwner] = users;
    company = await prisma.empresa.create({ data: { documento: cnpj(), razaoSocial: 'Empresa original', proprietarioUserId: owner.id, donoFaturamentoId: owner.id,
      ambiente: 'HOMOLOGACAO', regimeTributario: 'MEI', certificadoA1: 'SYNTHETIC-CIPHERTEXT', senhaCertificado: 'SYNTHETIC-PASSWORD' } }); companies.push(company.id);
    await prisma.user.update({ where: { id: owner.id }, data: { empresaId: company.id } });
    await prisma.contadorVinculo.create({ data: { contadorId: accountant.id, empresaId: company.id, status: 'APROVADO' } });
    const freshInput = async overrides => {
      const current = await prisma.empresa.findUniqueOrThrow({ where: { id: company.id } });
      return { ...base, empresaConfirmadaId: current.id, empresaAtualizadaEm: current.updatedAt.toISOString(), documento: current.documento, ...overrides };
    };
    const save = async (actorId, overrides = {}, context = company.id) => updateProfile(actorId, context, await freshInput(overrides));

    await t.test('salvar conta nao altera empresa nem aceita email/papel/plano/empresa por mass assignment', async () => {
      const before = await prisma.empresa.findUniqueOrThrow({ where: { id: company.id } });
      await updateProfile(owner.id, company.id, { escopo: 'CONTA', nome: 'Novo nome pessoal', telefone: '11999999999' });
      assert.deepEqual(await prisma.empresa.findUniqueOrThrow({ where: { id: company.id } }), before);
      for (const extra of [{ documento: company.documento }, { email: 'attacker@example.invalid' }, { role: 'MASTER' }, { empresaId: company.id }, { plano: 'FREE' }]) {
        await assert.rejects(updateProfile(owner.id, null, { escopo: 'CONTA', nome: 'Não salvar', ...extra }), { status: 400 });
      }
      assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: owner.id } })).nome, 'Novo nome pessoal');
    });
    await t.test('empresa salva complemento/email comercial/CNAEs locais e auditoria sem publicar regras globais', async () => {
      const globalBefore = await prisma.globalCnae.findMany({ where: { codigo: { in: ['6201501', '6201-5/01'] } } });
      const rulesBefore = await prisma.tributacaoMunicipal.findMany({ where: { cnae: { in: ['6201501', '6201-5/01'] }, codigoIbge: '3550308' } });
      const result = await save(owner.id, { serieDPS: '00900', ultimoDPS: 10 });
      assert.equal(result.cadastroCompleto, true); assert.equal(result.certificadoA1, undefined); assert.equal(result.primeiroCertificadoCadastrado, false);
      const after = await prisma.empresa.findUniqueOrThrow({ where: { id: company.id }, include: { atividades: true } });
      assert.equal(after.complemento, 'Sala 3'); assert.equal(after.email, base.emailComercial); assert.equal(after.serieDPS, '900');
      assert.equal(after.atividades[0].codigo, '6201501'); assert.equal(after.atividades[0].temRetencaoInss, false);
      assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: owner.id } })).email, owner.email);
      assert.deepEqual(await prisma.globalCnae.findMany({ where: { codigo: { in: ['6201501', '6201-5/01'] } } }), globalBefore);
      assert.deepEqual(await prisma.tributacaoMunicipal.findMany({ where: { cnae: { in: ['6201501', '6201-5/01'] }, codigoIbge: '3550308' } }), rulesBefore);
      assert.equal((await prisma.dpsSequencia.findFirstOrThrow({ where: { empresaId: company.id } })).ultimoConfirmado, 10);
    });
    await t.test('CNPJ imutavel, versao/contexto errados e entrada invalida nao deixam gravacao parcial', async () => {
      const before = await prisma.empresa.findUniqueOrThrow({ where: { id: company.id }, include: { atividades: true } });
      for (const extra of [{ documento: cnpj() }, { empresaAtualizadaEm: '2000-01-01T00:00:00.000Z' }, { empresaConfirmadaId: stranger.id }, { cnaes: [] }, { nome: 'Não salvar perfil pessoal' }, { ultimoDPS: 1.1 }]) {
        await assert.rejects(save(owner.id, { razaoSocial: 'Não salvar', ...extra }), e => [400, 403, 409].includes(e.status));
      }
      assert.deepEqual(await prisma.empresa.findUniqueOrThrow({ where: { id: company.id }, include: { atividades: true } }), before);
    });
    await t.test('seis atualizacoes concorrentes da mesma versao admitem apenas uma, com auditoria unica', async () => {
      const input = await freshInput({ razaoSocial: 'Uma única atualização' });
      const before = await prisma.systemLog.count({ where: { empresaId: company.id, action: 'COMPANY_PROFILE_UPDATED' } });
      const results = await Promise.allSettled(Array.from({ length: 6 }, () => updateProfile(owner.id, company.id, input)));
      assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
      assert.ok(results.filter(r => r.status === 'rejected').every(r => r.reason.status === 409));
      assert.equal(await prisma.systemLog.count({ where: { empresaId: company.id, action: 'COMPANY_PROFILE_UPDATED' } }), before + 1);
    });
    await t.test('falha de sequencia apos UPDATE faz rollback do cadastro, CNAEs e auditoria', async () => {
      await prisma.empresa.update({ where: { id: company.id }, data: { ultimoDPS: -1 } }); // Corrupt synthetic legacy floor.
      const before = await prisma.empresa.findUniqueOrThrow({ where: { id: company.id }, include: { atividades: true } });
      const logsBefore = await prisma.systemLog.count({ where: { empresaId: company.id } });
      await assert.rejects(save(owner.id, { ambiente: 'PRODUCAO', accountPassword: password, serieDPS: '901', ultimoDPS: 5,
        razaoSocial: 'Não pode persistir', cnaes: [{ ...activity, descricao: 'Também deve reverter' }] }), error => error.status === 400);
      assert.deepEqual(await prisma.empresa.findUniqueOrThrow({ where: { id: company.id }, include: { atividades: true } }), before);
      assert.equal(await prisma.systemLog.count({ where: { empresaId: company.id } }), logsBefore);
      assert.equal(await prisma.dpsSequencia.count({ where: { empresaId: company.id, serie: '901' } }), 0);
      await prisma.empresa.update({ where: { id: company.id }, data: { ultimoDPS: 0 } });
    });
    await t.test('contador aprovado edita; revogacao, papel interno ou conta estranha bloqueiam imediatamente', async () => {
      await save(accountant.id);
      await prisma.contadorVinculo.update({ where: { contadorId_empresaId: { contadorId: accountant.id, empresaId: company.id } }, data: { status: 'REVOGADO' } });
      for (const user of [accountant, stranger, support, commercial, admin, master]) await assert.rejects(save(user.id), { status: 403 });
      // Staff can still edit their own personal preferences without fiscal privileges.
      await updateProfile(support.id, null, { escopo: 'CONTA', cargo: 'Atendimento' });
    });
    await t.test('ADMIN titular edita somente a propria PJ pelo portal do cliente', async () => {
      const adminCompany = await prisma.empresa.create({ data: { documento: cnpj(), razaoSocial: 'PJ própria do administrador',
        proprietarioUserId: admin.id, donoFaturamentoId: admin.id, ambiente: 'HOMOLOGACAO', regimeTributario: 'MEI' } });
      companies.push(adminCompany.id);
      await prisma.user.update({ where: { id: admin.id }, data: { empresaId: adminCompany.id } });
      const input = { ...base, documento: adminCompany.documento, razaoSocial: 'PJ do administrador atualizada',
        empresaConfirmadaId: adminCompany.id, empresaAtualizadaEm: adminCompany.updatedAt.toISOString() };
      await updateProfile(admin.id, null, input);
      assert.equal((await prisma.empresa.findUniqueOrThrow({ where: { id: adminCompany.id } })).razaoSocial, 'PJ do administrador atualizada');
      await assert.rejects(save(admin.id), { status: 403 });
    });
    await t.test('producao e remocao de certificado exigem senha atual; segredos nao entram no log/resposta', async () => {
      await assert.rejects(save(owner.id, { ambiente: 'PRODUCAO' }), { status: 403 });
      await assert.rejects(save(owner.id, { ambiente: 'PRODUCAO', accountPassword: 'incorrect' }), { status: 403 });
      assert.equal((await prisma.empresa.findUniqueOrThrow({ where: { id: company.id } })).ambiente, 'HOMOLOGACAO');
      await save(owner.id, { ambiente: 'PRODUCAO', accountPassword: password });
      await assert.rejects(save(owner.id, { ambiente: 'PRODUCAO', deletarCertificado: true }), { status: 403 });
      const result = await save(owner.id, { ambiente: 'PRODUCAO', deletarCertificado: true, accountPassword: password });
      const after = await prisma.empresa.findUniqueOrThrow({ where: { id: company.id } });
      assert.equal(after.certificadoA1, null); assert.equal(after.senhaCertificado, null);
      const logs = await prisma.systemLog.findMany({ where: { empresaId: company.id } });
      for (const secret of [password, 'SYNTHETIC-CIPHERTEXT', 'SYNTHETIC-PASSWORD', owner.email]) assert.equal(JSON.stringify({ result, logs }).includes(secret), false);
    });
    await t.test('empresa arquivada continua protegida mesmo com id primario e senha do titular', async () => {
      await prisma.empresa.update({ where: { id: company.id }, data: { arquivadoEm: new Date() } });
      await assert.rejects(save(owner.id, { accountPassword: password }), { status: 403 });
      await prisma.empresa.update({ where: { id: company.id }, data: { arquivadoEm: null } });
    });
    await t.test('cadastro inicial respeita plano/cota e nunca reivindica CNPJ existente', async () => {
      const input = { ...base, documento: cnpj(), empresaConfirmadaId: null };
      await assert.rejects(updateProfile(newcomer.id, null, input), { status: 403 });
      plan = await prisma.plan.create({ data: { name: prefix, slug: prefix, tipo: 'PLANO', features: '[]', maxNotasMensal: 10, maxClientes: 10, priceMonthly: 1, priceYearly: 12 } });
      for (const user of [newcomer, pendingOwner]) await prisma.planHistory.create({ data: { userId: user.id, planId: plan.id,
        dataInicio: new Date(Date.now() - 86400000), dataFim: new Date(Date.now() + 30 * 86400000), cicloInicio: new Date(Date.now() - 86400000),
        tipoContratado: 'PLANO', nomeContratado: plan.name, limiteNotasContratado: 10, limiteClientesContratado: 10 } });
      await assert.rejects(updateProfile(newcomer.id, null, { ...input, documento: company.documento }), { status: 409 });
      const result = await updateProfile(newcomer.id, null, input); companies.push(result.empresaId);
      const created = await prisma.empresa.findUniqueOrThrow({ where: { id: result.empresaId } });
      assert.equal(created.ambiente, 'HOMOLOGACAO'); assert.equal(created.proprietarioUserId, newcomer.id); assert.equal(created.donoFaturamentoId, newcomer.id);
      assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: newcomer.id } })).empresaId, created.id);
      await prisma.contadorVinculo.create({ data: { contadorId: pendingOwner.id, empresaId: company.id, status: 'PENDENTE_DONO' } });
      await assert.rejects(updateProfile(pendingOwner.id, null, { ...input, documento: cnpj() }), { status: 403 });
      assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: pendingOwner.id } })).empresaId, null);
    });
  } finally {
    const userIds = users.map(user => user.id);
    if (userIds.length) {
      await prisma.systemLog.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.contadorVinculo.deleteMany({ where: { contadorId: { in: userIds } } });
      await prisma.user.updateMany({ where: { id: { in: userIds } }, data: { empresaId: null } });
    }
    if (companies.length) {
      await prisma.dpsSequencia.deleteMany({ where: { empresaId: { in: companies } } });
      await prisma.cnae.deleteMany({ where: { empresaId: { in: companies } } });
      await prisma.empresa.deleteMany({ where: { id: { in: companies } } });
    }
    if (userIds.length) { await prisma.planHistory.deleteMany({ where: { userId: { in: userIds } } }); await prisma.user.deleteMany({ where: { id: { in: userIds } } }); }
    if (plan) await prisma.plan.delete({ where: { id: plan.id } });
  }
});
