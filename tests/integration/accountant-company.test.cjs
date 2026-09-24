const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

// Synthetic, isolated identifiers. Never query government APIs or transmit a DPS.
function fixtureCnpj() {
  let base = `QA${randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase()}`;
  for (let pass = 0; pass < 2; pass++) {
    let sum = 0; let weight = 2;
    for (let index = base.length - 1; index >= 0; index--) { sum += (base.charCodeAt(index) - 48) * weight; weight = weight === 9 ? 2 : weight + 1; }
    const remainder = sum % 11; base += String(remainder < 2 ? 0 : 11 - remainder);
  }
  return base;
}

test('PostgreSQL: contratos de contador, cotas de empresas e consentimento de vinculos', { skip: process.env.ALLOW_TEST_DATABASE_WRITES !== 'true' }, async (t) => {
  require('./require-test-database.cjs')();
  const { prisma } = require('../../app/utils/prisma.ts');
  const { grantAccountantBenefit } = require('../../app/services/contadorPlanService.ts');
  const { updateUserRoleSecurely } = require('../../app/utils/admin-security.ts');
  const { registerAdditionalCompany } = require('../../app/services/companyRegistrationService.ts');
  const { upsertEmpresaAndLinkUser } = require('../../app/services/empresaService.ts');
  const { decideAccountantLink } = require('../../app/services/accountantLinkService.ts');
  const { hasEmpresaAccess } = require('../../app/utils/access-control.ts');
  const prefix = `qa-company-${randomUUID()}`;
  const users = []; const companyIds = []; const planIds = [];
  try {
    for (const role of ['ADMIN', 'CONTADOR', 'CONTADOR', 'COMUM', 'COMUM', 'SUPORTE']) users.push(await prisma.user.create({
      data: { email: `${prefix}-${users.length}@example.invalid`, nome: 'Fixture de acesso contábil', senha: 'not-used', role, limiteEmpresas: 2 },
    }));
    const [admin, accountant, requester, owner, quotaUser, support] = users;
    const plan = await prisma.plan.create({ data: { slug: prefix, name: 'Fixture de contrato', features: '[]', tipo: 'PLANO', maxNotasMensal: 5, maxClientes: 5, priceMonthly: 1, priceYearly: 12 } });
    planIds.push(plan.id);
    const start = new Date(Date.now() - 60000); const end = new Date(Date.now() + 86400000 * 40);
    for (const user of [accountant, requester, owner, quotaUser]) await prisma.planHistory.create({ data: {
      userId: user.id, planId: plan.id, dataInicio: start, dataFim: end, cicloInicio: start, tipoContratado: 'PLANO', nomeContratado: 'Fixture de contrato', limiteNotasContratado: 5, limiteClientesContratado: 5,
    } });
    const company = await prisma.empresa.create({ data: { documento: fixtureCnpj(), razaoSocial: 'Empresa protegida', email: 'private@example.invalid',
      proprietarioUserId: owner.id, contadorCustodianteId: accountant.id, donoFaturamentoId: owner.id, certificadoA1: 'not-a-real-certificate', ambiente: 'HOMOLOGACAO' } });
    companyIds.push(company.id);
    await prisma.contadorVinculo.create({ data: { contadorId: accountant.id, empresaId: company.id, status: 'APROVADO' } });
    let pending;
    await t.test('pedido de vinculo nao altera cadastro protegido nem concede acesso ao solicitante', async () => {
      const result = await upsertEmpresaAndLinkUser(company.documento, requester.id, { email: 'attacker@example.invalid', certificadoA1: 'attacker' }, 'MASTER');
      assert.equal(result._statusVinculo, 'PENDENTE_DONO');
      assert.equal(result.certificadoA1, undefined); assert.equal(result.email, undefined);
      assert.equal(await hasEmpresaAccess(requester, company.id), false);
      const after = await prisma.empresa.findUnique({ where: { id: company.id } });
      assert.equal(after.email, company.email); assert.equal(after.certificadoA1, company.certificadoA1);
      assert.equal(after.updatedAt.toISOString(), company.updatedAt.toISOString());
      pending = await prisma.contadorVinculo.findUnique({ where: { contadorId_empresaId: { contadorId: requester.id, empresaId: company.id } } });
    });
    await t.test('somente titular aprova pendencia do dono; revogacao tira o acesso imediatamente', async () => {
      const input = { actorId: accountant.id, linkId: pending.id, action: 'APROVAR' };
      await assert.rejects(decideAccountantLink(input), (e) => e.status === 403);
      await assert.rejects(decideAccountantLink({ ...input, actorId: support.id }), (e) => e.status === 403);
      await decideAccountantLink({ ...input, actorId: owner.id });
      assert.equal(await hasEmpresaAccess(requester, company.id), true);
      await decideAccountantLink({ ...input, actorId: owner.id, action: 'REVOGAR' });
      assert.equal(await hasEmpresaAccess(requester, company.id), false);
      await assert.rejects(decideAccountantLink({ ...input, actorId: owner.id }), (e) => e.status === 409);
    });
    await t.test('cadastro adicional concorrente nao excede a cota nem toma empresa orfa', async () => {
      await prisma.user.update({ where: { id: quotaUser.id }, data: { limiteEmpresas: 1 } });
      const requests = Array.from({ length: 8 }, () => ({ documento: fixtureCnpj(), razaoSocial: 'Fixture adicional' }));
      const results = await Promise.allSettled(requests.map((body) => registerAdditionalCompany(quotaUser.id, body)));
      const successes = results.filter((r) => r.status === 'fulfilled');
      successes.forEach((r) => companyIds.push(r.value.empresa.id));
      assert.equal(successes.length, 1);
      assert.equal(await prisma.empresa.count({ where: { proprietarioUserId: quotaUser.id } }), 1);
      const created = successes[0].value.empresa;
      assert.equal((await registerAdditionalCompany(quotaUser.id, { documento: created.documento, razaoSocial: created.razaoSocial })).created, false);
      const orphan = await prisma.empresa.create({ data: { documento: fixtureCnpj(), razaoSocial: 'Historico orfao protegido' } });
      companyIds.push(orphan.id);
      await assert.rejects(registerAdditionalCompany(owner.id, { documento: orphan.documento, razaoSocial: 'Nao pode assumir' }), (e) => e.status === 409);
      assert.equal((await prisma.empresa.findUnique({ where: { id: orphan.id } })).proprietarioUserId, null);
    });
    await t.test('salvar/promover papel nao renova contrato e concessao explicita e atomica/idempotente', async () => {
      const count = await prisma.planHistory.count({ where: { userId: accountant.id } });
      const result = await updateUserRoleSecurely(admin.id, accountant.id, 'CONTADOR', { limiteEmpresas: 3 }, 'Ajustar somente capacidade de empresas');
      assert.equal(result.error, null);
      assert.equal(await prisma.planHistory.count({ where: { userId: accountant.id } }), count);
      const operationId = randomUUID();
      const input = { actorId: admin.id, userId: accountant.id, operationId, justification: 'Concessao custom para fixture',
        benefit: { action: 'GRANT', kind: 'CUSTOM', cycle: 'MENSAL', notes: 17, customers: 9 } };
      const grants = await Promise.all([grantAccountantBenefit(input), grantAccountantBenefit(input)]);
      assert.equal(grants.filter((g) => g.reused).length, 1);
      const contract = await prisma.planHistory.findUnique({ where: { id: operationId } });
      planIds.push(contract.planId);
      assert.equal(contract.dataInicio.toISOString(), end.toISOString()); assert.equal(contract.limiteNotasContratado, 17);
      await assert.rejects(grantAccountantBenefit({ ...input, benefit: { ...input.benefit, notes: 99 } }), (e) => e.status === 409);
      assert.equal(await prisma.plan.count({ where: { slug: { startsWith: `contador-${operationId}-` } } }), 1);
      assert.equal(await prisma.fatura.count({ where: { userId: accountant.id } }), 0);
    });
  } finally {
    const ids = users.map((user) => user.id);
    // Only rows associated with fixture IDs; existing user data is never targeted.
    const createdCompanies = await prisma.empresa.findMany({ where: { OR: [{ id: { in: companyIds } }, { proprietarioUserId: { in: ids } }] }, select: { id: true } });
    const allCompanyIds = createdCompanies.map((row) => row.id);
    const createdPlans = await prisma.planHistory.findMany({ where: { userId: { in: ids } }, select: { planId: true } });
    await prisma.contadorVinculo.deleteMany({ where: { OR: [{ contadorId: { in: ids } }, { empresaId: { in: allCompanyIds } }] } });
    await prisma.systemLog.deleteMany({ where: { userId: { in: ids } } });
    await prisma.userEvent.deleteMany({ where: { userId: { in: ids } } });
    await prisma.planHistory.deleteMany({ where: { userId: { in: ids } } });
    await prisma.empresa.deleteMany({ where: { id: { in: allCompanyIds } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await prisma.plan.deleteMany({ where: { id: { in: [...planIds, ...createdPlans.map((row) => row.planId)] } } });
  }
});
