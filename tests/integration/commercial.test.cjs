const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

test('integracao comercial PostgreSQL: cotacao, estoque, idempotencia e conciliacao', { skip: process.env.ALLOW_TEST_DATABASE_WRITES !== 'true' }, async (t) => {
  require('./require-test-database.cjs')();
  const { prisma } = require('../../app/utils/prisma.ts');
  const { loadCommercialQuote, commercialTransaction, createManualOrder, processManualOrder, cancelManualOrder } = require('../../app/services/commercialService.ts');
  const { grantPlanManually } = require('../../app/services/manualPlanGrantService.ts');
  const prefix = `qa-commerce-${randomUUID()}`;
  const users = []; const plans = []; const coupons = [];
  const quoteFor = (userId, cart) => commercialTransaction(userId, (tx) => loadCommercialQuote(tx, userId, cart));
  const proof = { nomeArquivo: 'fixture.pdf', mimeType: 'application/pdf', tamanho: 9, conteudoBase64: Buffer.from('%PDF-1.4\n').toString('base64') };
  try {
    for (const role of ['COMUM', 'COMUM', 'COMERCIAL', 'SUPORTE', 'ADMIN']) {
      users.push(await prisma.user.create({ data: { email: `${users.length}-${prefix}@example.invalid`, nome: 'Fixture comercial', senha: 'not-used', role } }));
    }
    const plan = await prisma.plan.create({ data: { name: 'Assinatura QA', slug: prefix, tipo: 'PLANO', priceMonthly: '39.90', priceYearly: '399', features: '[]', maxNotasMensal: 30, maxClientes: 50 } });
    plans.push(plan.id);
    const cupom = await prisma.cupom.create({ data: { codigo: `QA_${randomUUID().replaceAll('-', '').slice(0, 20)}`.toUpperCase(), tipoDesconto: 'PORCENTAGEM', valorDesconto: '10', limiteUsos: 1 } });
    coupons.push(cupom.id);
    const cart = { planSlug: plan.slug, ciclo: 'MENSAL', qtdCiclos: 1, cupom: cupom.codigo };
    let order;
    await t.test('duas reservas concorrentes disputam o ultimo cupom; apenas uma vence', async () => {
      const quotes = await Promise.all(users.slice(0, 2).map((u) => quoteFor(u.id, cart)));
      const results = await Promise.allSettled(users.slice(0, 2).map((u, index) => createManualOrder({ userId: u.id, input: cart, hash: quotes[index].hash, idempotencyKey: randomUUID(), proof })));
      assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
      order = results.find((r) => r.status === 'fulfilled').value.pedido;
      assert.equal(await prisma.pedido.count({ where: { cupomId: cupom.id, cupomEstado: 'RESERVADO' } }), 1);
      const same = await createManualOrder({ userId: order.userId, input: cart, hash: order.cotacaoHash, idempotencyKey: order.idempotencyKey, proof });
      assert.equal(same.pedido.id, order.id);
      assert.equal(await prisma.pedidoAnexo.count({ where: { pedidoId: order.id } }), 1);
    });
    await t.test('suporte nao aprova, ativacao exige analise e valores exatos', async () => {
      const args = { actorId: users[2].id, id: order.id, status: 'ATIVADO_MANUALMENTE', justification: 'Fixture de conciliacao', paymentChecked: true, receivedAmount: '35.91', paymentReference: `QA:${randomUUID()}` };
      await assert.rejects(processManualOrder({ ...args, actorId: users[3].id }), (error) => error.status === 403);
      await assert.rejects(processManualOrder(args), (error) => error.status === 409);
      await processManualOrder({ ...args, status: 'EM_ANALISE' });
      await assert.rejects(processManualOrder({ ...args, receivedAmount: '0.01' }), (error) => error.status === 400);
      assert.equal(await prisma.fatura.count({ where: { userId: order.userId } }), 0);
    });
    await t.test('aprovacao repetida gera apenas uma fatura/historico e preserva cotacao apos editar catalogo', async () => {
      await prisma.plan.update({ where: { id: plan.id }, data: { priceMonthly: '99.00', maxNotasMensal: 999 } });
      const args = { actorId: users[2].id, id: order.id, status: 'ATIVADO_MANUALMENTE', justification: 'Fixture de conciliacao', paymentChecked: true, receivedAmount: '35.91', paymentReference: `QA:${randomUUID()}` };
      const results = await Promise.all([processManualOrder(args), processManualOrder(args)]);
      assert.equal(results[0].faturaId, results[1].faturaId);
      assert.equal(await prisma.fatura.count({ where: { userId: order.userId } }), 1);
      const histories = await prisma.planHistory.findMany({ where: { pedidoId: order.id } });
      assert.equal(histories.length, 1); assert.equal(histories[0].limiteNotasContratado, 30);
      assert.equal(Number(results[0].valorTotal), 35.91);
      assert.equal((await prisma.cupom.findUnique({ where: { id: cupom.id } })).vezesUsado, 1);
      await assert.rejects(cancelManualOrder(order.userId, order.id), (error) => error.status === 409);
      await assert.rejects(processManualOrder({ ...args, paymentReference: 'OUTRO:PAGAMENTO' }), (error) => error.status === 409);
      order = results[0];
    });
    await t.test('mesma transferencia em outro pedido falha e reverte todos os beneficios', async () => {
      const other = users.find((u) => u.role === 'COMUM' && u.id !== order.userId);
      const input = { ...cart, cupom: null };
      const quote = await quoteFor(other.id, input);
      const { pedido } = await createManualOrder({ userId: other.id, input, hash: quote.hash, idempotencyKey: randomUUID(), proof });
      const args = { actorId: users[2].id, id: pedido.id, justification: 'Fixture de referencia duplicada' };
      await processManualOrder({ ...args, status: 'EM_ANALISE' });
      await assert.rejects(processManualOrder({ ...args, status: 'ATIVADO_MANUALMENTE', paymentChecked: true, receivedAmount: '99.00', paymentReference: order.referenciaPagamento }), (error) => error.status === 409);
      assert.equal(await prisma.planHistory.count({ where: { pedidoId: pedido.id } }), 0);
      assert.equal((await prisma.pedido.findUnique({ where: { id: pedido.id } })).status, 'EM_ANALISE');
      await cancelManualOrder(other.id, pedido.id);
    });
    await t.test('concessao administrativa e idempotente e nao quita pagamentos', async () => {
      const op = { actorId: users[4].id, userId: order.userId, operationId: randomUUID(), planSlug: plan.slug, cycle: 'MENSAL', justification: 'Cortesia de teste administrativo' };
      const results = await Promise.all([grantPlanManually(op), grantPlanManually(op)]);
      assert.equal(results.filter((r) => r.reused).length, 1);
      assert.equal(await prisma.planHistory.count({ where: { id: op.operationId } }), 1);
      assert.equal(await prisma.fatura.count({ where: { userId: order.userId } }), 1);
      const grant = await prisma.planHistory.findUnique({ where: { id: op.operationId } });
      const previous = await prisma.planHistory.findFirst({ where: { pedidoId: order.id } });
      assert.equal(grant.dataInicio.toISOString(), previous.dataFim.toISOString());
    });
  } finally {
    // Exact fixture ids only; never delete broad user/production data.
    const ids = users.map((u) => u.id);
    await prisma.planHistory.deleteMany({ where: { userId: { in: ids } } });
    await prisma.pedido.deleteMany({ where: { userId: { in: ids } } });
    await prisma.cupomLog.deleteMany({ where: { userId: { in: ids } } });
    await prisma.fatura.deleteMany({ where: { userId: { in: ids } } });
    await prisma.ticket.deleteMany({ where: { solicitanteId: { in: ids } } });
    await prisma.userEvent.deleteMany({ where: { userId: { in: ids } } });
    await prisma.systemLog.deleteMany({ where: { userId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await prisma.cupom.deleteMany({ where: { id: { in: coupons } } });
    await prisma.plan.deleteMany({ where: { id: { in: plans } } });
  }
});
