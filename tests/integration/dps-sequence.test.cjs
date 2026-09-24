const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

test('DPS PostgreSQL: aliases, historico, concorrencia e limite sem reutilizacao', { skip: process.env.ALLOW_TEST_DATABASE_WRITES !== 'true' }, async (t) => {
  require('./require-test-database.cjs')();
  const { prisma } = require('../../app/utils/prisma.ts');
  const { lockCanonicalDpsSequence } = require('../../app/services/dpsSequenceStore.ts');
  const { findDpsSequence, listDpsSequences, setUserDpsSequence, confirmDpsNumber, syncDpsSequence } = require('../../app/services/dpsSequenceService.ts');
  const { claimEmission, reserveJobDps } = require('../../app/services/emissionLeaseService.ts');
  const { nextDpsCandidate, MAX_STORED_DPS_NUMBER } = require('../../app/utils/dps-identity.ts');
  const prefix = `qa-dps-${randomUUID()}`;
  let company; let user;
  try {
    user = await prisma.user.create({ data: { email: `${prefix}@example.invalid`, nome: 'Fixture DPS', senha: 'unused' } });
    company = await prisma.empresa.create({ data: { documento: prefix, razaoSocial: 'Fixture sem rede', proprietarioUserId: user.id, ambiente: 'PRODUCAO', serieDPS: '00900' } });
    const base = { empresaId: company.id, ambiente: 'PRODUCAO', userId: user.id };
    const legacyA = await prisma.dpsSequencia.create({ data: { empresaId: company.id, ambiente: 'PRODUCAO', serie: '00900', ultimoConfirmado: 40, ultimoReservado: 43 } });
    const legacyB = await prisma.dpsSequencia.create({ data: { empresaId: company.id, ambiente: 'PRODUCAO', serie: '0900', ultimoConfirmado: 42, ultimoReservado: 49 } });
    async function job(data = {}) {
      return prisma.emissaoJob.create({ data: { empresaId: company.id, clienteId: randomUUID(), actorUserId: user.id, billingUserId: user.id,
        ambiente: 'PRODUCAO', serieDPS: '00900', payloadJson: '{}', idempotencyKey: randomUUID(), acknowledgedAt: new Date(), ...data } });
    }
    await job({ status: 'ERRO_FINAL', reservedDpsNumero: 60 });

    await t.test('leitura consolida aliases e reservas rejeitadas sem alterar linhas legadas', async () => {
      for (const serie of ['900', '0900', '00900']) {
        const state = await findDpsSequence(company.id, 'PRODUCAO', serie);
        assert.equal(state.serie, '900'); assert.equal(state.ultimoConfirmado, 42); assert.equal(state.ultimoReservado, 60);
        assert.equal(nextDpsCandidate(state.ultimoConfirmado, state.ultimoReservado), 61);
      }
      assert.equal(await prisma.dpsSequencia.count({ where: { empresaId: company.id } }), 2);
      const list = await listDpsSequences(company.id);
      assert.equal(list.length, 1); assert.equal(list[0].ultimoReservado, 60); assert.equal('syncToken' in list[0], false);
    });
    await t.test('oito reservas concorrentes em aliases distintos usam o mesmo bloqueio', async () => {
      const numbers = await Promise.all(Array.from({ length: 8 }, (_, i) => prisma.$transaction(async (tx) => {
        const state = await lockCanonicalDpsSequence(tx, { ...base, serie: ['900', '00900', '0900'][i % 3] });
        const number = nextDpsCandidate(state.ultimoConfirmado, state.ultimoReservado);
        await tx.dpsSequencia.update({ where: { id: state.id }, data: { ultimoReservado: number } });
        return number;
      })));
      assert.deepEqual(numbers.sort((a, b) => a - b), [61, 62, 63, 64, 65, 66, 67, 68]);
      assert.deepEqual(await prisma.dpsSequencia.findUnique({ where: { id: legacyA.id } }), legacyA);
      assert.deepEqual(await prisma.dpsSequencia.findUnique({ where: { id: legacyB.id } }), legacyB);
    });
    await t.test('ajuste manual e confirmacao concorrentes nunca diminuem confirmado ou reservado', async () => {
      await Promise.all([
        setUserDpsSequence({ ...base, serie: '00900', ultimoConfirmado: 75 }),
        setUserDpsSequence({ ...base, serie: '0900', ultimoConfirmado: 0 }),
        confirmDpsNumber({ ...base, serie: '900', numero: 80, origem: 'QA' }),
      ]);
      const state = await findDpsSequence(company.id, 'PRODUCAO', '00900');
      assert.equal(state.ultimoConfirmado, 80); assert.equal(state.ultimoReservado, 68);
    });
    await t.test('ambiente e outras series mantem sequencias independentes', async () => {
      const other = await prisma.$transaction((tx) => lockCanonicalDpsSequence(tx, { ...base, ambiente: 'HOMOLOGACAO', serie: '00900' }));
      const series = await prisma.$transaction((tx) => lockCanonicalDpsSequence(tx, { ...base, serie: '901' }));
      assert.equal(nextDpsCandidate(other.ultimoConfirmado, other.ultimoReservado), 1);
      assert.equal(nextDpsCandidate(series.ultimoConfirmado, series.ultimoReservado), 1);
    });
    await t.test('worker congela serie da tarefa e retries concorrentes retornam a mesma reserva', async () => {
      const record = await job();
      await prisma.empresa.update({ where: { id: company.id }, data: { serieDPS: '7' } });
      const claim = await claimEmission(prefix, [company.id], true);
      assert.equal(claim.id, record.id);
      const reservations = await Promise.all(Array.from({ length: 6 }, () => reserveJobDps(claim)));
      assert.ok(reservations.every((row) => row.reservedDpsNumero === 81 && row.serieDPS === '900'));
      await prisma.emissaoJob.update({ where: { id: record.id }, data: { status: 'ERRO_FINAL', leaseToken: null, leaseUntil: null } });
      const next = await job();
      const nextClaim = await claimEmission(prefix, [company.id], true);
      assert.equal(nextClaim.id, next.id);
      assert.equal((await reserveJobDps(nextClaim)).reservedDpsNumero, 82);
      await prisma.emissaoJob.update({ where: { id: next.id }, data: { status: 'ERRO_FINAL', leaseToken: null, leaseUntil: null } });
    });
    await t.test('numero manual usado e entrada malformada falham sem reserva parcial', async () => {
      const manual = await job({ payloadJson: JSON.stringify({ numeroDPS: 70 }) });
      const claim = await claimEmission(prefix, [company.id], true);
      await assert.rejects(reserveJobDps(claim), { status: 400 });
      assert.equal((await prisma.emissaoJob.findUnique({ where: { id: manual.id } })).reservedDpsNumero, null);
      await assert.rejects(setUserDpsSequence({ ...base, serie: 'A900', ultimoConfirmado: 900 }), { status: 400 });
      await assert.rejects(confirmDpsNumber({ ...base, serie: '900', numero: 1.9, origem: 'QA' }), { status: 400 });
      assert.equal((await findDpsSequence(company.id, 'PRODUCAO', '900')).ultimoReservado, 82);
      await prisma.emissaoJob.update({ where: { id: manual.id }, data: { status: 'ERRO_FINAL', leaseToken: null, leaseUntil: null } });
    });
    await t.test('sincronizacao reconhece posse legada equivalente sem abrir certificado/rede', async () => {
      await prisma.empresa.update({ where: { id: company.id }, data: { certificadoA1: 'synthetic-not-a-certificate', senhaCertificado: 'unused' } });
      await prisma.dpsSequencia.update({ where: { id: legacyA.id }, data: { syncToken: randomUUID(), syncLockedUntil: new Date(Date.now() + 60_000) } });
      await assert.rejects(syncDpsSequence({ ...base, serie: '900' }), { status: 409 });
      await prisma.dpsSequencia.update({ where: { id: legacyA.id }, data: { syncToken: null, syncLockedUntil: null } });
    });
    await t.test('piso legado da empresa e preservado em producao e nao contamina homologacao', async () => {
      await prisma.empresa.update({ where: { id: company.id }, data: { ultimoDPS: 100 } });
      const production = await findDpsSequence(company.id, 'PRODUCAO', '00900');
      assert.equal(nextDpsCandidate(production.ultimoConfirmado, production.ultimoReservado), 101);
      const testState = await findDpsSequence(company.id, 'HOMOLOGACAO', '00900');
      assert.equal(nextDpsCandidate(testState.ultimoConfirmado, testState.ultimoReservado), 1);
      await setUserDpsSequence({ ...base, serie: '00900', ultimoConfirmado: 0 });
      assert.equal((await findDpsSequence(company.id, 'PRODUCAO', '900')).ultimoConfirmado, 100);
    });
    await t.test('esgotamento bloqueia nova reserva sem transbordar ou reiniciar', async () => {
      await setUserDpsSequence({ ...base, serie: '0900', ultimoConfirmado: MAX_STORED_DPS_NUMBER });
      const state = await findDpsSequence(company.id, 'PRODUCAO', '00900');
      assert.equal(nextDpsCandidate(state.ultimoConfirmado, state.ultimoReservado), null);
      const record = await job(); const claim = await claimEmission(prefix, [company.id], true);
      await assert.rejects(reserveJobDps(claim), { status: 400 });
      assert.equal((await prisma.emissaoJob.findUnique({ where: { id: record.id } })).reservedDpsNumero, null);
      await assert.rejects(syncDpsSequence({ ...base, serie: '900' }), { status: 409 });
      assert.equal((await findDpsSequence(company.id, 'PRODUCAO', '900')).ultimoConfirmado, MAX_STORED_DPS_NUMBER);
    });
  } finally {
    if (company) {
      await prisma.emissaoJob.deleteMany({ where: { empresaId: company.id } });
      await prisma.dpsSequencia.deleteMany({ where: { empresaId: company.id } });
      await prisma.empresa.delete({ where: { id: company.id } });
    }
    if (user) await prisma.user.delete({ where: { id: user.id } });
  }
});
