const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

test('worker PostgreSQL: posse, recuperação, conciliação e liquidação atômica', { skip: process.env.ALLOW_TEST_DATABASE_WRITES !== 'true' }, async (t) => {
  require('./require-test-database.cjs')();
  const { prisma } = require('../../app/utils/prisma.ts');
  const { claimEmission, LostEmissionLease, withEmissionLease } = require('../../app/services/emissionLeaseService.ts');
  const { processClaimedEmission, finishEmissionFailure, finishEmissionSuccess } = require('../../app/services/durableEmissionWorker.ts');
  const { reserveEmissionCredit } = require('../../app/services/planService.ts');
  const prefix = `qa-worker-${randomUUID()}`;
  const companies = []; const users = []; let plan;
  const { makeDps, makeNfse } = require('../fixtures/fiscal.cjs');
  const { preparedDpsId } = require('../../app/services/emissor/validation/AuthorizedNfseValidator.ts');
  const key = '1'.repeat(50);
  let postCalls = 0; let getCalls = 0;
  try {
    const owner = await prisma.user.create({ data: { email: `${prefix}@example.invalid`, nome: 'Fixture worker', senha: 'unused' } }); users.push(owner.id);
    const other = await prisma.user.create({ data: { email: `${prefix}-other@example.invalid`, nome: 'Fixture contador', senha: 'unused', role: 'CONTADOR' } }); users.push(other.id);
    plan = await prisma.plan.create({ data: { name: 'Fixture worker', slug: prefix, tipo: 'PLANO', features: '[]', maxNotasMensal: 20, maxClientes: 20, priceMonthly: 1, priceYearly: 12 } });
    const start = new Date(Date.now() - 86400000);
    await prisma.planHistory.create({ data: { userId: owner.id, planId: plan.id, dataInicio: start, cicloInicio: start, dataFim: new Date(Date.now() + 20 * 86400000),
      tipoContratado: 'PLANO', nomeContratado: plan.name, limiteNotasContratado: 20, limiteClientesContratado: 20 } });
    async function company() {
      const record = await prisma.empresa.create({ data: { documento: `${prefix}-${companies.length}`, razaoSocial: 'Fixture sem rede',
        proprietarioUserId: owner.id, donoFaturamentoId: owner.id, ambiente: 'PRODUCAO', regimeTributario: 'MEI', codigoIbge: '2611606' } });
      companies.push(record.id);
      await prisma.userCliente.create({ data: { userId: other.id, empresaId: record.id } });
      const customer = await prisma.cliente.create({ data: { empresaId: record.id, nome: 'Fixture tomador', documento: randomUUID(), tipo: 'PJ', vinculos: { create: {} } } });
      await prisma.dpsSequencia.create({ data: { empresaId: record.id, ambiente: 'PRODUCAO', serie: '900', ultimoReservado: 20 } });
      return { ...record, customer };
    }
    async function job(company, actorId = owner.id, number = 1, transmitted = false) {
      const reservation = await reserveEmissionCredit(owner.id, `${prefix}:${randomUUID()}`);
      assert.equal(reservation.allowed, true);
      const sale = await prisma.venda.create({ data: { empresaId: company.id, clienteId: company.customer.id, valor: 10, descricao: 'Fixture sem envio', status: 'PROCESSANDO' } });
      const signedXml = makeDps(number);
      const dpsId = preparedDpsId(signedXml);
      return prisma.emissaoJob.create({ data: { empresaId: company.id, clienteId: company.customer.id, vendaId: sale.id, actorUserId: actorId, billingUserId: owner.id,
        ambiente: 'PRODUCAO', payloadJson: JSON.stringify({ valor: '10.00', descricao: sale.descricao }), idempotencyKey: randomUUID(),
        creditReservationId: reservation.reservationId, reservedDpsNumero: number, serieDPS: '900', dpsId, signedXml,
        transmissionStartedAt: transmitted ? new Date() : null, createdAt: new Date(start.getTime() + number * 1000),
        preparedMetadataJson: JSON.stringify({ valor: 10, descricao: sale.descricao, prestadorDocumento: company.documento, tomadorDocumento: company.customer.documento, cnae: '6201501' }) } });
    }
    function result(xml) {
      const official = makeNfse(xml, { numero: '1' });
      return { sucesso: true, notaGov: { chave: key, numero: '1', protocolo: key, xml: Buffer.from(official).toString('base64') } };
    }
    const fake = { preparar: async () => { throw new Error('Fixture deve usar XML preparado'); },
      transmitirPreparado: async (xml) => { postCalls++; return result(xml); },
      conciliarDps: async (xml, empresa) => { getCalls++; assert.equal(empresa.ambiente, 'PRODUCAO'); return result(xml); } };
    const a = await company(); const a1 = await job(a, owner.id, 1, true); await job(a, other.id, 2);
    let first;
    await t.test('oito workers concorrentes assumem apenas a cabeca da empresa', async () => {
      const claims = await Promise.all(Array.from({ length: 8 }, (_, i) => claimEmission(`${prefix}-${i}`, [a.id], true)));
      assert.equal(claims.filter(Boolean).length, 1);
      first = claims.find(Boolean); assert.equal(first.id, a1.id);
    });
    await t.test('posse expirada e recuperavel; worker antigo nao pode finalizar ou devolver credito', async () => {
      await prisma.emissaoJob.update({ where: { id: a1.id }, data: { leaseUntil: new Date(Date.now() - 1000) } });
      const recovered = await claimEmission(prefix, [a.id], true);
      assert.ok(recovered); assert.notEqual(recovered.leaseToken, first.leaseToken);
      await assert.rejects(finishEmissionFailure(first, true, 'Não pode gravar'), LostEmissionLease);
      // Environment/permission may change after transmission; reconciliation uses captured environment.
      await prisma.empresa.update({ where: { id: a.id }, data: { ambiente: 'HOMOLOGACAO' } });
      await processClaimedEmission(recovered, fake);
      assert.equal(postCalls, 0); assert.equal(getCalls, 1);
      const complete = await prisma.emissaoJob.findUniqueOrThrow({ where: { id: a1.id } });
      assert.equal(complete.status, 'AUTORIZADA');
      assert.equal(await prisma.notaFiscal.count({ where: { vendaId: a1.vendaId } }), 1);
      assert.equal(await prisma.emissionDocumentTask.count({ where: { jobId: a1.id } }), 1);
      assert.equal((await prisma.emissionCreditReservation.findUnique({ where: { id: a1.creditReservationId } })).status, 'CONSUMED');
      await assert.rejects(finishEmissionSuccess(recovered, result(recovered.signedXml)), LostEmissionLease);
      assert.equal(await prisma.notaFiscal.count({ where: { vendaId: a1.vendaId } }), 1);
    });
    await t.test('timeout apos POST so consulta a DPS na retomada, nunca executa segundo POST', async () => {
      const b = await company(); const b1 = await job(b);
      const claimed = await claimEmission(prefix, [b.id], true);
      const uncertain = { ...fake, transmitirPreparado: async () => { postCalls++; return { sucesso: false, failureKind: 'UNKNOWN' }; } };
      await processClaimedEmission(claimed, uncertain);
      assert.equal(postCalls, 1);
      const retry = await prisma.emissaoJob.findUnique({ where: { id: b1.id } });
      assert.equal(retry.status, 'ERRO_TEMPORARIO'); assert.ok(retry.transmissionStartedAt);
      assert.equal((await prisma.emissionCreditReservation.findUnique({ where: { id: b1.creditReservationId } })).status, 'RESERVED');
      await prisma.emissaoJob.update({ where: { id: b1.id }, data: { nextAttemptAt: new Date(Date.now() - 1000) } });
      await processClaimedEmission(await claimEmission(prefix, [b.id], true), fake);
      assert.equal(postCalls, 1); assert.equal(getCalls, 2);
    });
    await t.test('incerteza esgotada conserva credito e bloqueia somente sua empresa', async () => {
      const c = await company(); const c1 = await job(c, owner.id, 1, true); await job(c, other.id, 2);
      await prisma.emissaoJob.update({ where: { id: c1.id }, data: { maxAttempts: 1 } });
      const claimed = await claimEmission(prefix, [c.id], true);
      await processClaimedEmission(claimed, { ...fake, conciliarDps: async () => ({ sucesso: false, failureKind: 'UNKNOWN' }) });
      assert.equal((await prisma.emissaoJob.findUnique({ where: { id: c1.id } })).status, 'RECONCILIACAO_MANUAL');
      assert.equal((await prisma.emissionCreditReservation.findUnique({ where: { id: c1.creditReservationId } })).status, 'RESERVED');
      // PostgreSQL transaction timestamps may precede the actual insert after a
      // long lock wait. A different timestamp/order cannot bypass the manual hold.
      await prisma.emissaoJob.updateMany({ where: { empresaId: c.id, id: { not: c1.id } }, data: { createdAt: new Date(start.getTime() - 1000) } });
      assert.equal(await claimEmission(prefix, [c.id], true), null);
      const d = await company(); await job(d);
      assert.ok(await claimEmission(prefix, [d.id], true));
    });
    await t.test('perda de permissao antes do envio rejeita sem POST e devolve credito', async () => {
      const e = await company(); const e1 = await job(e, other.id);
      await prisma.userCliente.deleteMany({ where: { userId: other.id, empresaId: e.id } });
      const before = postCalls;
      await processClaimedEmission(await claimEmission(prefix, [e.id], true), fake);
      assert.equal(postCalls, before);
      assert.equal((await prisma.emissaoJob.findUnique({ where: { id: e1.id } })).status, 'ERRO_FINAL');
      assert.equal((await prisma.emissionCreditReservation.findUnique({ where: { id: e1.creditReservationId } })).status, 'RELEASED');
    });
    await t.test('escrita parcial sob posse faz rollback; tarefas novas de producao exigem habilitacao', async () => {
      const f = await company(); const f1 = await job(f);
      assert.equal(await claimEmission(prefix, [f.id]), null);
      const claim = await claimEmission(prefix, [f.id], true);
      await assert.rejects(withEmissionLease(claim, async (tx) => {
        await tx.emissaoJob.update({ where: { id: f1.id }, data: { status: 'AUTORIZADA' } });
        throw new Error('Fixture rollback');
      }), /Fixture rollback/);
      assert.equal((await prisma.emissaoJob.findUnique({ where: { id: f1.id } })).status, 'PROCESSANDO');
    });
  } finally {
    if (companies.length) {
      await prisma.emissionDocumentTask.deleteMany({ where: { job: { empresaId: { in: companies } } } });
      await prisma.emissaoJob.deleteMany({ where: { empresaId: { in: companies } } });
      await prisma.appNotification.deleteMany({ where: { empresaId: { in: companies } } });
      await prisma.systemLog.deleteMany({ where: { empresaId: { in: companies } } });
      await prisma.notaFiscal.deleteMany({ where: { empresaId: { in: companies } } });
      await prisma.venda.deleteMany({ where: { empresaId: { in: companies } } });
      await prisma.vinculoCarteira.deleteMany({ where: { empresaId: { in: companies } } });
      await prisma.cliente.deleteMany({ where: { empresaId: { in: companies } } });
      await prisma.userCliente.deleteMany({ where: { empresaId: { in: companies } } });
      await prisma.dpsSequencia.deleteMany({ where: { empresaId: { in: companies } } });
      await prisma.empresa.deleteMany({ where: { id: { in: companies } } });
    }
    if (users.length) {
      await prisma.emissionCreditReservation.deleteMany({ where: { userId: { in: users } } });
      await prisma.planUsageCycle.deleteMany({ where: { history: { userId: { in: users } } } });
      await prisma.planHistory.deleteMany({ where: { userId: { in: users } } });
      await prisma.user.deleteMany({ where: { id: { in: users } } });
    }
    if (plan) await prisma.plan.delete({ where: { id: plan.id } });
  }
});
