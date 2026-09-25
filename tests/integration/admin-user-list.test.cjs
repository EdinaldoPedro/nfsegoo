const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

test('PostgreSQL: listagem administrativa de contas é mínima, paginada e hierárquica', { skip: process.env.ALLOW_TEST_DATABASE_WRITES !== 'true' }, async t => {
  require('./require-test-database.cjs')();
  const { prisma } = require('../../app/utils/prisma.ts');
  const { listAdminUsers } = require('../../app/services/adminUserListService.ts');
  const { getCrmMetrics } = require('../../app/services/crmMetricsService.ts');
  const prefix = 'qa-user-list-' + randomUUID(), users = [], companies = [];
  let billingPlan, invoice, order;
  try {
    for (const role of ['MASTER', 'ADMIN', 'SUPORTE', 'COMUM', 'COMUM', 'COMUM', 'CONTADOR']) users.push(await prisma.user.create({ data: {
      nome: prefix + '-' + users.length, email: `${prefix}-${users.length}@qa.test`, senha: 'QA-HASH-NEVER-RETURN', role,
    } }));
    const company = await prisma.empresa.create({ data: { documento: '12345678000195', razaoSocial: prefix,
      certificadoA1: 'QA-PFX-NEVER-RETURN', senhaCertificado: 'QA-PFX-PASSWORD', proprietarioUserId: users[3].id } });
    companies.push(company);
    await prisma.user.update({ where: { id: users[3].id }, data: { empresaId: company.id } });
    await t.test('pagina e busca retornam somente DTO necessário', async () => {
      const first = await listAdminUsers(users[1].id, new URLSearchParams(`roles=COMUM&limit=2&search=${encodeURIComponent(prefix)}`));
      assert.equal(first.data.length, 2); assert.equal(first.meta.total, 3); assert.equal(first.meta.totalPages, 2);
      const next = await listAdminUsers(users[1].id, new URLSearchParams(`roles=COMUM&limit=2&page=2&search=${encodeURIComponent(prefix)}`));
      assert.equal(next.data.length, 1);
      const serialized = JSON.stringify({ first, next });
      for (const secret of ['QA-HASH-NEVER-RETURN', 'QA-PFX-NEVER-RETURN', 'QA-PFX-PASSWORD', 'senha', 'certificadoA1']) assert.equal(serialized.includes(secret), false);
    });
    await t.test('suporte enxerga clientes/contadores, não equipe interna', async () => {
      assert.equal((await listAdminUsers(users[2].id, new URLSearchParams(`roles=COMUM,CONTADOR&limit=50&search=${encodeURIComponent(prefix)}`))).data.length, 4);
      await assert.rejects(listAdminUsers(users[2].id, new URLSearchParams('roles=ADMIN')), { status: 403 });
      const visibleMaster = await listAdminUsers(users[1].id, new URLSearchParams(`roles=MASTER&search=${encodeURIComponent(prefix)}`));
      assert.equal(visibleMaster.data.length, 1);
    });
    await t.test('MASTER pode listar equipe de modo delimitado', async () => {
      const result = await listAdminUsers(users[0].id, new URLSearchParams(`roles=MASTER,ADMIN,SUPORTE&search=${encodeURIComponent(prefix)}`));
      assert.equal(result.data.length, 3); assert.deepEqual(new Set(result.data.map(row => row.role)), new Set(['MASTER', 'ADMIN', 'SUPORTE']));
    });
    await t.test('métricas agregam no banco sem carregar contas, senhas ou planos em memória', async () => {
      const before = await getCrmMetrics(users[0].id);
      billingPlan = await prisma.plan.create({ data: { slug: prefix, name: prefix, features: '[]', priceMonthly: 999, priceYearly: 999, tipo: 'PLANO' } });
      invoice = await prisma.fatura.create({ data: { userId: users[4].id, planoId: billingPlan.id, descricao: prefix, valorTotal: 120, status: 'PAGO', pagoEm: new Date() } });
      order = await prisma.pedido.create({ data: { userId: users[4].id, planoSlug: billingPlan.slug, ciclo: 'ANUAL', valorPlano: 120,
        valorAdicionais: 0, valorTotal: 120, status: 'ATIVADO_MANUALMENTE', formaPagamento: 'TRANSFERENCIA_MANUAL',
        cotacao: { cart: { qtdCiclos: 1 } }, faturaId: invoice.id, idempotencyKey: randomUUID() } });
      await prisma.planHistory.create({ data: { userId: users[4].id, planId: billingPlan.id, pedidoId: order.id, status: 'ATIVO',
        tipoContratado: 'PLANO', nomeContratado: prefix, dataInicio: new Date(Date.now() - 1000), dataFim: new Date(Date.now() + 86400000) } });
      await prisma.plan.update({ where: { id: billingPlan.id }, data: { priceYearly: 5000 } });
      const result = await getCrmMetrics(users[0].id);
      assert.ok(result.totalClientes >= 4); assert.equal(Number.isFinite(result.mrrTotal), true);
      assert.equal(result.mrrTotal - before.mrrTotal, 10);
      assert.equal(result.metricBasis, 'CONTRATOS_ATIVOS_PAGOS_COTACAO_CONGELADA');
      await assert.rejects(getCrmMetrics(users[2].id), { status: 403 });
    });
  } finally {
    const ids = users.map(row => row.id);
    await prisma.user.updateMany({ where: { id: { in: ids } }, data: { empresaId: null } });
    await prisma.empresa.deleteMany({ where: { id: { in: companies.map(row => row.id) } } });
    await prisma.planHistory.deleteMany({ where: { userId: { in: ids } } });
    if (order) await prisma.pedido.delete({ where: { id: order.id } });
    if (invoice) await prisma.fatura.delete({ where: { id: invoice.id } });
    if (billingPlan) await prisma.plan.delete({ where: { id: billingPlan.id } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
  }
});
