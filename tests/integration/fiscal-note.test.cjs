const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { gunzipSync } = require('node:zlib');

test('operacoes de nota PostgreSQL: cancelamento duravel, consulta, documentos e arquivamento seguro', { skip: process.env.ALLOW_TEST_DATABASE_WRITES !== 'true' }, async (t) => {
  require('./require-test-database.cjs')();
  const { prisma } = require('../../app/utils/prisma.ts');
  const { enqueueFiscalNoteOperation, requestFiscalDocument, resumeFiscalNoteReconciliation } = require('../../app/services/fiscalNoteService.ts');
  const { claimFiscalNoteOperation, processFiscalNoteOperation, finishFiscalNoteOperation, failFiscalNoteOperation, LostNoteLease } = require('../../app/services/fiscalNoteWorker.ts');
  const { processNextEmissionDocument } = require('../../app/services/emissionDocumentWorker.ts');
  const { archiveSale } = require('../../app/services/saleArchiveService.ts');
  const { prepareCancellationRequest } = require('../../app/services/emissor/validation/CancellationEvent.ts');
  const { makeDps, makeNfse, signingCredentials, makeCancellationEvent } = require('../fixtures/fiscal.cjs');
  const prefix = 'qa-note-' + randomUUID(); const users = []; const companies = []; const notes = [];
  let company; let owner; let accountant; let admin; let support; let commercial; let stranger; let customer; let number = 0;
  let postCalls = 0; let getCalls = 0;
  const reason = { code: '1', justification: 'Erro identificado na descricao do servico' };
  const signing = async (key, reason, timestamp, company) => prepareCancellationRequest({ key, reason, timestamp, ambiente: company.ambiente, authorDocument: company.documento }, signingCredentials());
  const confirmed = (xml, key) => ({ sucesso: true, requestMatched: true, xmlEvento: Buffer.from(makeCancellationEvent(xml, key)).toString('base64') });
  const fake = {
    prepararCancelamento: signing,
    transmitirCancelamento: async (xml, key, currentCompany) => { postCalls++; assert.equal(currentCompany.ambiente, 'PRODUCAO'); return confirmed(xml, key); },
    conciliarCancelamento: async (xml, key, currentCompany) => { getCalls++; assert.equal(currentCompany.ambiente, 'PRODUCAO'); return confirmed(xml, key); },
  };
  async function createNote(ambiente = 'PRODUCAO', overrides = {}) {
    number++;
    const key = String(number).padStart(50, '1');
    const xml = Buffer.from(makeNfse(makeDps(number, (rps) => ({ ...rps, meta: { ...rps.meta, ambiente } })), { chave: key, numero: String(number) })).toString('base64');
    const sale = await prisma.venda.create({ data: { empresaId: company.id, clienteId: customer.id, valor: 123.45, descricao: 'Servico sintetico', status: ambiente === 'PRODUCAO' ? 'CONCLUIDA' : 'HOMOLOGACAO_VALIDADA' } });
    const note = await prisma.notaFiscal.create({ data: { empresaId: company.id, clienteId: customer.id, vendaId: sale.id, valor: 123.45, descricao: sale.descricao,
      prestadorCnpj: company.documento, tomadorCnpj: customer.documento, status: 'AUTORIZADA', ambiente, numero: number, numeroOficial: String(number),
      chaveAcesso: key, xmlAutorizadoBase64: xml, xmlBase64: xml, pdfBase64: Buffer.from('%PDF-OLD').toString('base64'), ...overrides } });
    notes.push(note.id); return note;
  }
  const queue = (note, overrides = {}) => enqueueFiscalNoteOperation({ actorId: owner.id, notaId: note.id, tipo: 'CANCELAR', idempotencyKey: randomUUID(), reasonCode: reason.code, justification: reason.justification, ...overrides });
  const claim = (note, allow = true) => claimFiscalNoteOperation(allow, [note.id]);
  const currentNote = (note) => prisma.notaFiscal.findUniqueOrThrow({ where: { id: note.id } });
  const currentOp = (op) => prisma.fiscalNoteOperation.findUniqueOrThrow({ where: { id: op.id } });
  const makeDue = (op) => prisma.fiscalNoteOperation.update({ where: { id: op.id }, data: { nextAttemptAt: new Date(Date.now() - 1000) } });
  try {
    for (const role of ['COMUM', 'CONTADOR', 'ADMIN', 'SUPORTE', 'COMERCIAL', 'COMUM']) {
      users.push(await prisma.user.create({ data: { email: `${prefix}-${users.length}@example.invalid`, nome: 'QA sem certificado real', senha: 'unused', role } }));
    }
    [owner, accountant, admin, support, commercial, stranger] = users;
    company = await prisma.empresa.create({ data: { documento: '11222333000181', razaoSocial: 'QA fiscal sintetico', proprietarioUserId: owner.id, donoFaturamentoId: owner.id,
      ambiente: 'HOMOLOGACAO', regimeTributario: 'MEI', codigoIbge: '3550308' } }); companies.push(company.id);
    customer = await prisma.cliente.create({ data: { empresaId: company.id, documento: '12345678909', nome: 'QA tomador', tipo: 'PF' } });
    await prisma.userCliente.create({ data: { userId: accountant.id, empresaId: company.id } });
    const initialCredits = await prisma.emissionCreditReservation.count({ where: { userId: owner.id } });
    let pendingNote; let pendingOperation;

    await t.test('cancelamento independe de plano; seis pedidos concorrentes viram uma operacao, sem alterar nota', async () => {
      assert.equal(await prisma.planHistory.count({ where: { userId: owner.id } }), 0);
      pendingNote = await createNote();
      const idempotencyKey = randomUUID();
      const results = await Promise.all(Array.from({ length: 6 }, () => queue(pendingNote, { idempotencyKey })));
      assert.equal(new Set(results.map(op => op.id)).size, 1); pendingOperation = results[0];
      assert.equal(pendingOperation.ambiente, 'PRODUCAO'); assert.equal((await currentNote(pendingNote)).status, 'AUTORIZADA');
      assert.equal(await prisma.fiscalNoteOperation.count({ where: { notaId: pendingNote.id } }), 1);
      await assert.rejects(queue(pendingNote, { idempotencyKey, justification: 'Justificativa diferente para a mesma chave' }), { status: 409 });
      await assert.rejects(queue(pendingNote, { justification: 'Outro motivo enquanto o primeiro esta pendente' }), { status: 409 });
      const duplicate = await createNote('PRODUCAO', { chaveAcesso: pendingNote.chaveAcesso, xmlBase64: pendingNote.xmlBase64, xmlAutorizadoBase64: pendingNote.xmlAutorizadoBase64 });
      await assert.rejects(queue(duplicate), { status: 409 });
    });
    await t.test('suporte/admin/comercial nao cancelam; desconhecido nao consulta, suporte pode consultar', async () => {
      const note = await createNote();
      for (const user of [support, admin, commercial, stranger]) await assert.rejects(queue(note, { actorId: user.id }), { status: 403 });
      await assert.rejects(queue(note, { actorId: stranger.id, tipo: 'CONSULTAR' }), { status: 403 });
      await assert.rejects(queue(note, { actorId: commercial.id, tipo: 'CONSULTAR' }), { status: 403 });
      await assert.rejects(queue(note, { actorId: admin.id, tipo: 'CONSULTAR', customerMode: true }), { status: 403 });
      const consultation = await queue(note, { actorId: support.id, tipo: 'CONSULTAR' });
      assert.equal(consultation.tipo, 'CONSULTAR');
      // The read-only worker must not claim a pending production cancellation.
      assert.equal(await claimFiscalNoteOperation(false, [pendingNote.id], true), null);
      const leased = await claimFiscalNoteOperation(false, [note.id], true);
      assert.equal(leased?.id, consultation.id);
      await processFiscalNoteOperation(leased, { consultar: async () => ({ sucesso: true, situacao: 'AUTORIZADA', xmlDistribuicao: note.xmlBase64 }) });
      assert.equal((await currentOp(consultation)).status, 'CONCLUIDA');
      assert.equal((await currentNote(note)).status, 'AUTORIZADA');
      assert.equal(postCalls, 0);
    });
    await t.test('producao precisa habilitacao e apenas um worker assume a operacao', async () => {
      assert.equal(await claim(pendingNote, false), null);
      const claims = await Promise.all(Array.from({ length: 6 }, () => claim(pendingNote)));
      assert.equal(claims.filter(Boolean).length, 1);
      // Simulate a worker dying before transmission.
      await prisma.fiscalNoteOperation.update({ where: { id: pendingOperation.id }, data: { leaseUntil: new Date(Date.now() - 1000) } });
      const recovered = await claim(pendingNote);
      await assert.rejects(failFiscalNoteOperation(claims.find(Boolean), true), LostNoteLease);
      await processFiscalNoteOperation(recovered, { ...fake, transmitirCancelamento: async () => { postCalls++; return { sucesso: false, failureKind: 'UNKNOWN' }; } });
      assert.equal(postCalls, 1);
      const op = await currentOp(pendingOperation);
      assert.ok(op.signedRequestXml); assert.ok(op.transmissionStartedAt); assert.equal(op.status, 'ERRO_TEMPORARIO');
      assert.equal((await currentNote(pendingNote)).status, 'AUTORIZADA');
    });
    await t.test('timeout depois de POST retoma somente GET no ambiente original; XML original e creditos preservados', async () => {
      const before = await currentOp(pendingOperation);
      await prisma.empresa.update({ where: { id: company.id }, data: { ambiente: 'HOMOLOGACAO' } });
      await makeDue(pendingOperation);
      const leased = await claim(pendingNote, false); // GET recovery allowed while new production POSTs are disabled.
      await processFiscalNoteOperation(leased, fake);
      assert.equal(postCalls, 1); assert.equal(getCalls, 1);
      const note = await currentNote(pendingNote); const op = await currentOp(pendingOperation);
      assert.equal(note.status, 'CANCELADA'); assert.equal(note.xmlBase64, pendingNote.xmlBase64); assert.equal(note.xmlAutorizadoBase64, pendingNote.xmlAutorizadoBase64);
      assert.ok(note.xmlCancelamentoEventoBase64); assert.ok(note.dataCancelamento); assert.equal(note.pdfBase64, null);
      assert.equal(op.status, 'CONCLUIDA'); assert.equal(op.signedRequestXml, before.signedRequestXml);
      assert.equal(op.transmissionStartedAt.getTime(), before.transmissionStartedAt.getTime());
      assert.equal((await prisma.venda.findUniqueOrThrow({ where: { id: note.vendaId } })).status, 'CANCELADA');
      assert.equal((await prisma.emissionDocumentTask.findUniqueOrThrow({ where: { notaId: note.id } })).status, 'PENDENTE');
      await assert.rejects(finishFiscalNoteOperation(leased, confirmed(before.signedRequestXml, before.chaveAcesso)), LostNoteLease);
      assert.equal(await prisma.emissionCreditReservation.count({ where: { userId: owner.id } }), initialCredits);
    });
    await t.test('permissao revogada antes do POST impede envio e nao cancela nota', async () => {
      const note = await createNote(); const op = await queue(note, { actorId: accountant.id });
      await prisma.userCliente.deleteMany({ where: { userId: accountant.id, empresaId: company.id } });
      const before = postCalls; await processFiscalNoteOperation(await claim(note), fake);
      assert.equal(postCalls, before); assert.equal((await currentOp(op)).status, 'ERRO_FINAL');
      assert.equal((await currentOp(op)).transmissionStartedAt, null); assert.equal((await currentNote(note)).status, 'AUTORIZADA');
    });
    await t.test('incerteza esgotada bloqueia novos pedidos; somente admin retoma GET sem limpar marcador', async () => {
      const note = await createNote(); const op = await queue(note);
      await prisma.fiscalNoteOperation.update({ where: { id: op.id }, data: { maxAttempts: 1 } });
      await processFiscalNoteOperation(await claim(note), { ...fake, transmitirCancelamento: async () => { postCalls++; return { sucesso: false, failureKind: 'UNKNOWN' }; } });
      const manual = await currentOp(op); assert.equal(manual.status, 'RECONCILIACAO_MANUAL');
      assert.equal((await currentNote(note)).status, 'AUTORIZADA'); assert.equal(await claim(note), null);
      await assert.rejects(queue(note, { tipo: 'CONSULTAR' }), { status: 409 });
      await assert.rejects(resumeFiscalNoteReconciliation(support.id, op.id, 'QA retomada sem reenvio'), { status: 403 });
      await resumeFiscalNoteReconciliation(admin.id, op.id, 'QA retomada sem reenvio');
      const beforePosts = postCalls;
      await processFiscalNoteOperation(await claim(note, false), fake);
      assert.equal(postCalls, beforePosts); assert.equal((await currentNote(note)).status, 'CANCELADA');
      assert.equal((await currentOp(op)).signedRequestXml, manual.signedRequestXml);
      // An administrator cannot promote a not-yet-transmitted request into a POST.
      const unsent = await createNote(); const unsentOp = await queue(unsent);
      await prisma.fiscalNoteOperation.update({ where: { id: unsentOp.id }, data: { status: 'RECONCILIACAO_MANUAL' } });
      await assert.rejects(resumeFiscalNoteReconciliation(admin.id, unsentOp.id, 'QA nao permite novo envio'), { status: 409 });
    });
    await t.test('consulta posterior nunca descancela; homologacao nao vira nota de producao', async () => {
      const query = await queue(pendingNote, { tipo: 'CONSULTAR', actorId: support.id });
      await processFiscalNoteOperation(await claim(pendingNote, false), { consultar: async () => ({ sucesso: true, situacao: 'AUTORIZADA', xmlDistribuicao: pendingNote.xmlBase64 }) });
      assert.equal((await currentNote(pendingNote)).status, 'CANCELADA'); assert.equal((await currentOp(query)).resultStatus, 'CANCELADA');
      const homol = await createNote('HOMOLOGACAO'); await queue(homol, { tipo: 'CONSULTAR' });
      await processFiscalNoteOperation(await claim(homol, false), { consultar: async () => ({ sucesso: true, situacao: 'AUTORIZADA', xmlDistribuicao: homol.xmlBase64 }) });
      assert.equal((await prisma.venda.findUniqueOrThrow({ where: { id: homol.vendaId } })).status, 'HOMOLOGACAO_VALIDADA');
    });
    await t.test('evento de outra nota ou retorno sem evento nao altera nota/PDF/venda', async () => {
      const note = await createNote(); const op = await queue(note);
      const otherRequest = await signing(pendingNote.chaveAcesso, reason, new Date(), { ...company, ambiente: 'PRODUCAO' });
      await processFiscalNoteOperation(await claim(note), { ...fake, transmitirCancelamento: async () => confirmed(otherRequest, pendingNote.chaveAcesso) });
      const current = await currentNote(note);
      assert.equal(current.status, 'AUTORIZADA'); assert.equal(current.pdfBase64, note.pdfBase64); assert.equal(current.xmlCancelamentoEventoBase64, null);
      assert.equal((await currentOp(op)).status, 'ERRO_TEMPORARIO');
    });
    await t.test('PDF antigo em renderizacao nao sobrescreve cancelamento; nova geracao recebe o evento validado', async () => {
      const note = await createNote(); await prisma.$transaction(tx => requestFiscalDocument(tx, note.id));
      const op = await queue(note);
      await processNextEmissionDocument([note.id], async () => {
        await processFiscalNoteOperation(await claim(note), fake);
        return Buffer.from('%PDF-STALE-AUTHORIZED');
      });
      assert.equal((await currentOp(op)).status, 'CONCLUIDA'); assert.equal((await currentNote(note)).pdfBase64, null);
      const task = await prisma.emissionDocumentTask.findUniqueOrThrow({ where: { notaId: note.id } });
      assert.equal(task.status, 'PENDENTE'); assert.equal(task.revision, 2);
      await processNextEmissionDocument([note.id], async (xml, options) => {
        assert.equal(xml, note.xmlAutorizadoBase64); assert.equal(options.cancelada, true); assert.ok(options.eventoCancelamentoXml);
        return Buffer.from('%PDF-CANCELLED-QA');
      });
      assert.equal(gunzipSync(Buffer.from((await currentNote(note)).pdfBase64, 'base64')).toString(), '%PDF-CANCELLED-QA');
      assert.equal((await prisma.emissionDocumentTask.findUniqueOrThrow({ where: { notaId: note.id } })).status, 'CONCLUIDA');
    });
    await t.test('XML legado adulterado impede cancelamento/renderizacao sem fabricar dados fiscais', async () => {
      const valid = await createNote();
      const note = await createNote('PRODUCAO', { ambiente: null, xmlBase64: null, xmlAutorizadoBase64: null });
      await assert.rejects(queue(note), { status: 409 });
      await assert.rejects(queue(note, { tipo: 'CONSULTAR' }), { status: 409 });
      const tampered = Buffer.from(Buffer.from(valid.xmlBase64, 'base64').toString().replace('123.45', '999.99')).toString('base64');
      await prisma.notaFiscal.update({ where: { id: valid.id }, data: { xmlAutorizadoBase64: tampered } });
      await assert.rejects(queue(valid));
      await prisma.$transaction(tx => requestFiscalDocument(tx, valid.id));
      let renders = 0; await processNextEmissionDocument([valid.id], async () => { renders++; return Buffer.from('%PDF-never'); });
      assert.equal(renders, 0); assert.equal((await currentNote(valid)).status, 'AUTORIZADA');
      assert.equal((await currentNote(valid)).xmlAutorizadoBase64, tampered);
    });
    await t.test('arquivo nao e exclusao fiscal: admin nao oculta autorizadas/canceladas e suporte nao arquiva', async () => {
      await assert.rejects(archiveSale(owner.id, pendingNote.vendaId), { status: 409 });
      await assert.rejects(archiveSale(admin.id, pendingNote.vendaId, true), { status: 409 });
      await assert.rejects(archiveSale(support.id, pendingNote.vendaId, true), { status: 403 });
      const authorized = await createNote(); await assert.rejects(archiveSale(admin.id, authorized.vendaId, true), { status: 409 });
      const draft = await prisma.venda.create({ data: { empresaId: company.id, clienteId: customer.id, valor: 10, descricao: 'QA venda sem nota', status: 'PENDENTE' } });
      await archiveSale(owner.id, draft.id); await archiveSale(owner.id, draft.id);
      assert.equal((await prisma.venda.findUniqueOrThrow({ where: { id: draft.id } })).status, 'DESCARTADA');
      assert.equal(await prisma.systemLog.count({ where: { vendaId: draft.id, action: 'VENDA_ARQUIVADA' } }), 1);
    });
    assert.equal(await prisma.emissionCreditReservation.count({ where: { userId: owner.id } }), initialCredits);
  } finally {
    if (notes.length) {
      await prisma.fiscalNoteOperation.deleteMany({ where: { notaId: { in: notes } } });
      await prisma.emissionDocumentTask.deleteMany({ where: { notaId: { in: notes } } });
    }
    if (companies.length) {
      await prisma.appNotification.deleteMany({ where: { empresaId: { in: companies } } });
      await prisma.systemLog.deleteMany({ where: { empresaId: { in: companies } } });
      await prisma.notaFiscal.deleteMany({ where: { empresaId: { in: companies } } });
      await prisma.venda.deleteMany({ where: { empresaId: { in: companies } } });
      await prisma.vinculoCarteira.deleteMany({ where: { empresaId: { in: companies } } });
      await prisma.cliente.deleteMany({ where: { empresaId: { in: companies } } });
      await prisma.userCliente.deleteMany({ where: { empresaId: { in: companies } } });
      await prisma.empresa.deleteMany({ where: { id: { in: companies } } });
    }
    if (users.length) await prisma.user.deleteMany({ where: { id: { in: users.map(user => user.id) } } });
  }
});
