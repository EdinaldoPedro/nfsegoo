const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

test('homologacao PostgreSQL: documentos persistidos, credito preservado e copia sem sobrescrita', { skip: process.env.ALLOW_TEST_DATABASE_WRITES !== 'true' }, async t => {
  require('./require-test-database.cjs')();
  const { prisma } = require('../../app/utils/prisma.ts');
  const { criarEmissaoJob } = require('../../app/services/emissaoJobService.ts');
  const { claimEmission } = require('../../app/services/emissionLeaseService.ts');
  const { processClaimedEmission } = require('../../app/services/durableEmissionWorker.ts');
  const { processNextEmissionDocument } = require('../../app/services/emissionDocumentWorker.ts');
  const { enqueueFiscalNoteOperation } = require('../../app/services/fiscalNoteService.ts');
  const { claimFiscalNoteOperation, processFiscalNoteOperation } = require('../../app/services/fiscalNoteWorker.ts');
  const { preparedDpsId } = require('../../app/services/emissor/validation/AuthorizedNfseValidator.ts');
  const { prepareCancellationRequest } = require('../../app/services/emissor/validation/CancellationEvent.ts');
  const { makeDps, makeNfse, makeCancellationEvent, signingCredentials } = require('../fixtures/fiscal.cjs');
  const prefix = 'qa-homol-' + randomUUID(); const users = []; const companies = [];
  const issuerDocument = '90123456000131'; const key = '1'.repeat(50);
  let owner, stranger, company, customer, source, note, productionCopy;
  try {
    for (const [i, role] of ['ADMIN', 'COMUM'].entries()) users.push(await prisma.user.create({ data: { email: `${prefix}-${i}@example.invalid`, nome: 'QA homologacao', senha: 'unused', role } }));
    [owner, stranger] = users;
    company = await prisma.empresa.create({ data: { documento: issuerDocument, razaoSocial: 'Empresa QA homologacao', proprietarioUserId: owner.id, donoFaturamentoId: owner.id,
      ambiente: 'HOMOLOGACAO', regimeTributario: 'MEI', codigoIbge: '3550308', certificadoA1: 'QA-NOT-A-CERTIFICATE', serieDPS: '900', ultimoDPS: 42 } }); companies.push(company.id);
    await prisma.user.update({ where: { id: owner.id }, data: { empresaId: company.id } });
    customer = await prisma.cliente.create({ data: { empresaId: company.id, nome: 'Cadastro atual diferente', documento: '12345678909', tipo: 'PF',
      codigoIbge: '3550308', cep: '01001000', logradouro: 'Rua de teste', numero: '10', bairro: 'Centro', cidade: 'Sao Paulo', uf: 'SP', vinculos: { create: {} } } });
    const body = { empresaConfirmadaId: company.id, ambienteConfirmado: 'HOMOLOGACAO', clienteId: customer.id, valor: '123.45', descricao: 'Servico sintético', codigoCnae: '6201501' };
    const request = (payload, overrides = {}) => criarEmissaoJob({ userId: owner.id, contextId: company.id, body: { ...body, ...payload }, idempotencyKey: randomUUID(), ...overrides });

    await t.test('confirmacao ausente, desconhecida ou de outra empresa nao registra venda, job ou credito', async () => {
      for (const payload of [{ ambienteConfirmado: undefined }, { ambienteConfirmado: 'producao' }, { empresaConfirmadaId: stranger.id }, { ambienteConfirmado: 'PRODUCAO' }]) {
        await assert.rejects(request(payload), error => [400, 409].includes(error.status));
      }
      assert.equal(await prisma.venda.count({ where: { empresaId: company.id } }), 0);
      assert.equal(await prisma.emissaoJob.count({ where: { empresaId: company.id } }), 0);
      assert.equal(await prisma.emissionCreditReservation.count({ where: { userId: owner.id } }), 0);
    });

    await t.test('homologacao autorizada cria nota, XML e tarefa PDF no ambiente congelado, sem consumir producao', async () => {
      source = await request({});
      assert.equal(source.job.creditReservationId, null);
      const signedXml = makeDps(15, rps => ({ ...rps, prestador: { ...rps.prestador, documento: issuerDocument },
        tomador: { ...rps.tomador, razaoSocial: 'Nome oficial anterior' }, meta: { ...rps.meta, ambiente: 'HOMOLOGACAO' } }));
      await prisma.emissaoJob.update({ where: { id: source.job.id }, data: { signedXml, dpsId: preparedDpsId(signedXml), reservedDpsNumero: 15, transmissionStartedAt: new Date(),
        preparedMetadataJson: JSON.stringify({ cnae: '6201501', valor: 1, descricao: 'Nao usar metadados mutaveis como documento', prestadorDocumento: issuerDocument }) } });
      await prisma.empresa.update({ where: { id: company.id }, data: { ambiente: 'PRODUCAO' } });
      const replay = await request({}, { idempotencyKey: source.job.idempotencyKey });
      assert.equal(replay.job.id, source.job.id); assert.equal(replay.existing, true); assert.equal(replay.job.ambiente, 'HOMOLOGACAO');
      await assert.rejects(request({}), { status: 409, code: 'EMISSION_CONTEXT_CHANGED' });
      assert.equal(await prisma.emissaoJob.count({ where: { empresaId: company.id } }), 1);
      body.ambienteConfirmado = 'PRODUCAO'; // A fresh review is now explicit, never inherited from the first job.
      const claim = await claimEmission(prefix, [company.id], false); assert.ok(claim);
      await processClaimedEmission(claim, { conciliarDps: async (xml, originalCompany) => {
        assert.equal(originalCompany.ambiente, 'HOMOLOGACAO');
        return { sucesso: true, notaGov: { chave: key, numero: '1234567890123', xml: Buffer.from(makeNfse(xml, { chave: key, numero: '1234567890123', issuerDocument })).toString('base64') } };
      }, transmitirPreparado: async () => { throw new Error('NO POST ALLOWED'); } });
      const job = await prisma.emissaoJob.findUniqueOrThrow({ where: { id: source.job.id } });
      assert.equal(job.status, 'AUTORIZADA'); assert.ok(job.resultNotaId); assert.equal(job.authorizedXmlBase64, null);
      note = await prisma.notaFiscal.findUniqueOrThrow({ where: { id: job.resultNotaId } });
      assert.equal(note.ambiente, 'HOMOLOGACAO'); assert.equal(note.numero, null); assert.equal(note.numeroOficial, '1234567890123');
      assert.equal(note.valor.toFixed(2), '123.45'); assert.equal(note.tomadorNome, 'Nome oficial anterior'); assert.equal(note.codigoServico, '010101'); assert.ok(note.metadadosVerificadosEm);
      assert.equal(note.prestadorCnpj, issuerDocument); assert.ok(note.xmlAutorizadoBase64);
      assert.equal((await prisma.empresa.findUniqueOrThrow({ where: { id: company.id } })).ultimoDPS, 42);
      assert.equal(await prisma.emissionCreditReservation.count({ where: { userId: owner.id } }), 0);
      await processNextEmissionDocument([note.id]);
      assert.equal((await prisma.emissionDocumentTask.findUniqueOrThrow({ where: { notaId: note.id } })).status, 'CONCLUIDA');
      assert.ok((await prisma.notaFiscal.findUniqueOrThrow({ where: { id: note.id } })).pdfBase64);
      await prisma.emissaoJob.update({ where: { id: source.job.id }, data: { acknowledgedAt: new Date() } });
    });
    await t.test('reenviar/editar a mesma venda autorizada e copiar origem de outra empresa sao bloqueados', async () => {
      await assert.rejects(request({ vendaId: source.venda.id }), { status: 409 });
      await assert.rejects(request({ vendaId: source.venda.id, copiaDeVendaId: source.venda.id }), { status: 400 });
      await assert.rejects(request({ copiaDeVendaId: source.venda.id }, { userId: stranger.id }), { status: 403 });
      await assert.rejects(request({ copiaDeVendaId: randomUUID() }), { status: 403 });
      assert.equal(await prisma.emissionCreditReservation.count({ where: { userId: owner.id } }), 0);
    });
    await t.test('seis copias com mesma chave criam uma nova venda ilimitada e mantem a homologacao original', async () => {
      const beforeSale = await prisma.venda.findUniqueOrThrow({ where: { id: source.venda.id } });
      const beforeNote = await prisma.notaFiscal.findUniqueOrThrow({ where: { id: note.id } });
      const idempotencyKey = randomUUID();
      const copies = await Promise.all(Array.from({ length: 6 }, () => request({ copiaDeVendaId: source.venda.id }, { idempotencyKey })));
      assert.equal(new Set(copies.map(result => result.job.id)).size, 1);
      assert.notEqual(copies[0].venda.id, source.venda.id); assert.equal(copies[0].job.ambiente, 'PRODUCAO');
      productionCopy = copies[0];
      assert.equal(productionCopy.job.creditReservationId, null); assert.equal(productionCopy.job.billingUnlimited, true); assert.equal(productionCopy.job.reservedDpsNumero, null);
      assert.equal(JSON.parse(copies[0].job.payloadJson).copiaDeVendaId, source.venda.id);
      assert.equal(await prisma.emissionCreditReservation.count({ where: { userId: owner.id } }), 0);
      assert.deepEqual(await prisma.venda.findUniqueOrThrow({ where: { id: source.venda.id } }), beforeSale);
      assert.deepEqual(await prisma.notaFiscal.findUniqueOrThrow({ where: { id: note.id } }), beforeNote);
      assert.equal(await claimEmission(prefix, [company.id], false), null); // No real production transmission.
    });
    await t.test('ADMIN titular conclui produção com benefício ilimitado e sem fabricar reserva', async () => {
      const signedXml = makeDps(16, rps => ({ ...rps, prestador: { ...rps.prestador, documento: issuerDocument }, meta: { ...rps.meta, ambiente: 'PRODUCAO' } }));
      await prisma.emissaoJob.update({ where: { id: productionCopy.job.id }, data: { signedXml, dpsId: preparedDpsId(signedXml), reservedDpsNumero: 16,
        preparedMetadataJson: JSON.stringify({ cnae: '6201501', valor: 123.45, descricao: 'Servico sintético', prestadorDocumento: issuerDocument }) } });
      const claimed = await claimEmission(prefix, [company.id], true); assert.ok(claimed);
      const productionKey = '2'.repeat(50);
      await processClaimedEmission(claimed, { transmitirPreparado: async xml => ({ sucesso: true,
        notaGov: { chave: productionKey, numero: '16', xml: Buffer.from(makeNfse(xml, { chave: productionKey, numero: '16', issuerDocument })).toString('base64') } }),
        conciliarDps: async () => { throw new Error('Consulta inesperada'); } });
      const completed = await prisma.emissaoJob.findUniqueOrThrow({ where: { id: productionCopy.job.id } });
      assert.equal(completed.status, 'AUTORIZADA'); assert.equal(completed.billingUnlimited, true); assert.equal(completed.creditReservationId, null);
      assert.equal(await prisma.emissionCreditReservation.count({ where: { userId: owner.id } }), 0);
    });
    await t.test('cancelamento de homologacao preserva ambiente e XML e nao altera credito da nova producao', async () => {
      const creditsBefore = await prisma.emissionCreditReservation.count({ where: { userId: owner.id } });
      const operation = await enqueueFiscalNoteOperation({ actorId: owner.id, notaId: note.id, tipo: 'CANCELAR', idempotencyKey: randomUUID(), reasonCode: '1', justification: 'Teste sintético de cancelamento em homologacao' });
      const claim = await claimFiscalNoteOperation(false, [note.id]); assert.ok(claim);
      await processFiscalNoteOperation(claim, {
        prepararCancelamento: async (key, reason, timestamp, company) => prepareCancellationRequest({ key, reason, timestamp, ambiente: company.ambiente, authorDocument: company.documento }, signingCredentials()),
        transmitirCancelamento: async (xml, key, frozenCompany) => {
          assert.equal(frozenCompany.ambiente, 'HOMOLOGACAO');
          return { sucesso: true, requestMatched: true, xmlEvento: Buffer.from(makeCancellationEvent(xml, key)).toString('base64') };
        },
      });
      assert.equal((await prisma.fiscalNoteOperation.findUniqueOrThrow({ where: { id: operation.id } })).status, 'CONCLUIDA');
      const cancelled = await prisma.notaFiscal.findUniqueOrThrow({ where: { id: note.id } });
      assert.equal(cancelled.status, 'CANCELADA'); assert.equal(cancelled.ambiente, 'HOMOLOGACAO'); assert.equal(cancelled.xmlAutorizadoBase64, note.xmlAutorizadoBase64); assert.ok(cancelled.xmlCancelamentoEventoBase64);
      assert.equal(await prisma.emissionCreditReservation.count({ where: { userId: owner.id } }), creditsBefore);
    });
  } finally {
    if (companies.length) {
      await prisma.fiscalNoteOperation.deleteMany({ where: { empresaId: { in: companies } } });
      await prisma.emissionDocumentTask.deleteMany({ where: { nota: { empresaId: { in: companies } } } });
      await prisma.emissaoJob.deleteMany({ where: { empresaId: { in: companies } } });
      await prisma.appNotification.deleteMany({ where: { empresaId: { in: companies } } });
      await prisma.systemLog.deleteMany({ where: { empresaId: { in: companies } } });
      await prisma.notaFiscal.deleteMany({ where: { empresaId: { in: companies } } });
      await prisma.venda.deleteMany({ where: { empresaId: { in: companies } } });
      await prisma.vinculoCarteira.deleteMany({ where: { empresaId: { in: companies } } });
      await prisma.cliente.deleteMany({ where: { empresaId: { in: companies } } });
      await prisma.dpsSequencia.deleteMany({ where: { empresaId: { in: companies } } });
      await prisma.user.updateMany({ where: { empresaId: { in: companies } }, data: { empresaId: null } });
      await prisma.empresa.deleteMany({ where: { id: { in: companies } } });
    }
    if (users.length) {
      const ids = users.map(user => user.id);
      await prisma.emissionCreditReservation.deleteMany({ where: { userId: { in: ids } } });
      await prisma.planUsageCycle.deleteMany({ where: { history: { userId: { in: ids } } } });
      await prisma.planHistory.deleteMany({ where: { userId: { in: ids } } });
      await prisma.user.deleteMany({ where: { id: { in: ids } } });
    }
  }
});
