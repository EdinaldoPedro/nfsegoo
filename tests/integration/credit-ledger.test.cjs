const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

test('ledger PostgreSQL: limite concorrente, ciclos, CAS e criacao atomica do job', { skip: process.env.ALLOW_TEST_DATABASE_WRITES !== 'true' }, async (t) => {
  require('./require-test-database.cjs')();
  const { prisma } = require('../../app/utils/prisma.ts');
  const { addCalendarMonths } = require('../../app/utils/commercial-pricing.ts');
  const { reserveEmissionCredit, reserveEmissionCreditInTransaction, releaseEmissionCredit, consumeEmissionCredit, getEffectivePlanLimits } = require('../../app/services/planService.ts');
  const { commercialTransaction } = require('../../app/services/commercialService.ts');
  const { criarEmissaoJob } = require('../../app/services/emissaoJobService.ts');
  const prefix = `qa-credit-${randomUUID()}`;
  let user; let plan; let company; let customer;
  const start = new Date(Date.now() - 60_000);
  try {
    user = await prisma.user.create({ data: { email: `${prefix}@example.invalid`, nome: 'Fixture de cota', senha: 'not-used', role: 'COMUM' } });
    plan = await prisma.plan.create({ data: { name: 'Quota fixture', slug: prefix, tipo: 'PLANO', priceMonthly: 1, priceYearly: 12, maxNotasMensal: 5, maxClientes: 5, features: '[]' } });
    await prisma.planHistory.create({ data: { userId: user.id, planId: plan.id, dataInicio: start, dataFim: addCalendarMonths(start, 12), cicloInicio: start,
      limiteNotasContratado: 5, limiteClientesContratado: 5, tipoContratado: 'PLANO', nomeContratado: 'Quota fixture' } });
    let reservations;
    await t.test('vinte requisicoes simultaneas reservam exatamente os cinco creditos', async () => {
      const results = await Promise.all(Array.from({ length: 20 }, (_, i) => reserveEmissionCredit(user.id, `${prefix}:${i}`, start)));
      reservations = results.filter((result) => result.allowed);
      assert.equal(reservations.length, 5);
      assert.equal((await getEffectivePlanLimits(user.id, prisma, start)).notasUsadas, 5);
      const first = await prisma.emissionCreditReservation.findUnique({ where: { id: reservations[0].reservationId } });
      assert.equal((await reserveEmissionCredit(user.id, first.requestKey, start)).reservationId, first.id);
      assert.equal(await prisma.emissionCreditReservation.count({ where: { userId: user.id } }), 5);
    });
    await t.test('devolucao concorrente e idempotente e nao reduz o saldo do ciclo seguinte', async () => {
      const next = addCalendarMonths(start, 1);
      const nextReservation = await reserveEmissionCredit(user.id, `${prefix}:next-cycle`, next);
      assert.equal(nextReservation.allowed, true);
      await Promise.all(Array.from({ length: 5 }, () => releaseEmissionCredit(reservations[0].reservationId)));
      assert.equal((await getEffectivePlanLimits(user.id, prisma, start)).notasUsadas, 4);
      assert.equal((await getEffectivePlanLimits(user.id, prisma, next)).notasUsadas, 1);
      await Promise.all([consumeEmissionCredit(nextReservation.reservationId), consumeEmissionCredit(nextReservation.reservationId)]);
      await releaseEmissionCredit(nextReservation.reservationId);
      assert.equal((await getEffectivePlanLimits(user.id, prisma, next)).notasUsadas, 1);
      const released = await prisma.emissionCreditReservation.findUnique({ where: { id: reservations[0].reservationId } });
      assert.equal((await reserveEmissionCredit(user.id, released.requestKey, next)).allowed, false);
    });
    await t.test('falha na mesma transacao desfaz a reserva', async () => {
      await assert.rejects(commercialTransaction(user.id, async (tx) => {
        assert.equal((await reserveEmissionCreditInTransaction(tx, user.id, `${prefix}:rollback`, start)).allowed, true);
        throw new Error('Fixture simula falha ao persistir job');
      }), /Fixture simula/);
      assert.equal(await prisma.emissionCreditReservation.count({ where: { requestKey: `${prefix}:rollback` } }), 0);
      assert.equal((await getEffectivePlanLimits(user.id, prisma, start)).notasUsadas, 4);
    });
    await t.test('reenvio concorrente da mesma emissao cria uma venda, um job e uma reserva', async () => {
      company = await prisma.empresa.create({ data: { documento: prefix, razaoSocial: 'Fixture sem transmissao', proprietarioUserId: user.id,
        donoFaturamentoId: user.id, ambiente: 'PRODUCAO', regimeTributario: 'MEI', certificadoA1: 'fixture-never-transmitted' } });
      customer = await prisma.cliente.create({ data: { empresaId: company.id, documento: 'fixture-customer', tipo: 'PJ', nome: 'Tomador fixture', vinculos: { create: {} } } });
      const args = { userId: user.id, contextId: company.id, idempotencyKey: randomUUID(), body: { empresaConfirmadaId: company.id, ambienteConfirmado: 'PRODUCAO', clienteId: customer.id, valor: '10.00', descricao: 'Fixture: nao transmitir', codigoCnae: '6201501' } };
      // Creating a job does not invoke the worker, portal, certificates or email.
      const results = await Promise.all([criarEmissaoJob(args), criarEmissaoJob(args)]);
      assert.equal(results[0].job.id, results[1].job.id);
      assert.equal(results.filter((result) => result.existing).length, 1);
      assert.equal(await prisma.venda.count({ where: { empresaId: company.id } }), 1);
      assert.equal(await prisma.emissaoJob.count({ where: { empresaId: company.id } }), 1);
      assert.ok(results[0].job.creditReservationId);
      assert.equal((await getEffectivePlanLimits(user.id, prisma, start)).notasUsadas, 5);
      await assert.rejects(criarEmissaoJob({ ...args, body: { ...args.body, valor: '20.00' } }), (error) => error.status === 409);
      await assert.rejects(criarEmissaoJob({ ...args, idempotencyKey: randomUUID() }), (error) => error.status === 409 && /anterior/.test(error.message));
    });
  } finally {
    if (company) {
      await prisma.emissaoJob.deleteMany({ where: { empresaId: company.id } });
      await prisma.systemLog.deleteMany({ where: { empresaId: company.id } });
      await prisma.venda.deleteMany({ where: { empresaId: company.id } });
      await prisma.vinculoCarteira.deleteMany({ where: { empresaId: company.id } });
      await prisma.cliente.deleteMany({ where: { empresaId: company.id } });
      await prisma.empresa.delete({ where: { id: company.id } });
    }
    if (user) {
      await prisma.emissionCreditReservation.deleteMany({ where: { userId: user.id } });
      await prisma.planUsageCycle.deleteMany({ where: { history: { userId: user.id } } });
      await prisma.planHistory.deleteMany({ where: { userId: user.id } });
      await prisma.user.delete({ where: { id: user.id } });
    }
    if (plan) await prisma.plan.delete({ where: { id: plan.id } });
  }
});
