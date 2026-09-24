const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const JSZip = require('jszip');

test('relatorios PostgreSQL: ambiente, historico acessivel, snapshot e exportacao sem vazamentos', { skip: process.env.ALLOW_TEST_DATABASE_WRITES !== 'true' }, async t => {
  require('./require-test-database.cjs')();
  const { prisma } = require('../../app/utils/prisma.ts');
  const { getFiscalReport, fiscalReportNoteSelect } = require('../../app/services/fiscalReportService.ts');
  const { getAdminFiscalStats } = require('../../app/services/fiscalStatsService.ts');
  const { exportFiscalReport } = require('../../app/services/fiscalReportExportService.ts');
  const { makeNfse, key } = require('../fixtures/fiscal.cjs');
  const prefix = 'qa-report-' + randomUUID(); const companies = []; const users = [];
  const query = extra => new URLSearchParams({ startDate: '2086-09-01', endDate: '2086-09-02', ...extra });
  const now = new Date('2086-09-02T18:00:00Z');
  let owner, stranger, accountant, support, company, customer, first, second, homol, legacy, cancelled;
  const read = extra => getFiscalReport(owner.id, company.id, query(extra), now);
  try {
    for (const role of ['COMUM', 'COMUM', 'CONTADOR', 'SUPORTE']) users.push(await prisma.user.create({ data: { email: `${prefix}-${role}-${users.length}@example.invalid`, nome: prefix, senha: 'unused', role, planoStatus: 'expired' } }));
    [owner, stranger, accountant, support] = users;
    company = await prisma.empresa.create({ data: { documento: prefix, razaoSocial: prefix, ambiente: 'HOMOLOGACAO', proprietarioUserId: owner.id, donoFaturamentoId: owner.id } }); companies.push(company.id);
    customer = await prisma.cliente.create({ data: { empresaId: company.id, nome: 'Nome do cadastro atual', documento: '12345678909', tipo: 'PF' } });
    const note = overrides => prisma.notaFiscal.create({ data: { empresaId: company.id, clienteId: customer.id, valor: '10.10', descricao: 'Servico registrado', prestadorCnpj: '11222333000181', tomadorCnpj: customer.documento,
      tomadorNome: 'Nome congelado no XML', metadadosVerificadosEm: now, codigoServico: '010101', ambiente: 'PRODUCAO', status: 'AUTORIZADA', dataEmissao: new Date('2086-09-02T13:00:00Z'),
      createdAt: new Date('2086-09-02T16:00:00Z'), xmlBase64: Buffer.from('<NFSe>QA synthetic</NFSe>').toString('base64'), ...overrides } });
    first = await note({ numero: null, numeroOficial: '1234567890123' }); second = await note({ valor: '0.20', dataEmissao: null, tomadorNome: null, metadadosVerificadosEm: null });
    homol = await note({ ambiente: 'HOMOLOGACAO', valor: '999.00' });
    legacy = await note({ ambiente: null, valor: '888.00' }); await note({ ambiente: 'DESCONHECIDO', valor: '777.00' });
    cancelled = await note({ status: 'CANCELADA', valor: '66.00', dataCancelamento: new Date('2086-09-02T14:00:00Z') });
    await note({ valor: '555.00', arquivadoEm: now });
    await note({ dataEmissao: new Date('2086-09-01T02:59:59.999Z'), valor: '4.44' });
    await note({ dataEmissao: new Date('2086-09-03T03:00:00Z'), valor: '5.55' });

    await t.test('producao nao inclui homologacao, legado, canceladas ou registros fora do dia brasileiro', async () => {
      assert.equal(await prisma.planHistory.count({ where: { userId: owner.id } }), 0);
      const report = await read({ limit: '1' });
      assert.equal(report.meta.total, 2); assert.equal(report.data.length, 1);
      assert.equal(report.summary.totalValor, '10.30'); assert.equal(report.summary.qtdCanceladas, 1);
      assert.equal(report.summary.notasSemAmbienteNoPeriodo, 2); assert.equal(report.summary.datasEstimadas, 1);
      assert.equal(report.summary.metadadosLegados, 0);
      assert.equal((await read({ ambiente: 'HOMOLOGACAO' })).summary.totalValor, '999.00');
      assert.equal((await read({ ambiente: 'LEGADO' })).summary.totalValor, '1665.00');
      assert.equal((await read({ incluirCanceladas: 'true' })).summary.totalValor, '10.30');
      assert.equal((await read({ incluirCanceladas: 'true' })).meta.total, 3);
    });
    await t.test('PDF recebe todas as linhas e metadados congelados, nao blobs ou novo CNAE', async () => {
      await prisma.cliente.update({ where: { id: customer.id }, data: { nome: 'Cadastro alterado depois' } });
      const report = await read({ output: 'report', limit: '1', page: '2' });
      assert.equal(report.meta.complete, true); assert.equal(report.data.length, 2); assert.equal(report.meta.page, 1);
      const frozen = report.data.find(n => n.id === first.id);
      assert.equal(frozen.tomadorNomeExibicao, 'Nome congelado no XML'); assert.equal(frozen.numeroExibicao, '1234567890123'); assert.equal(frozen.codigoTribNacional, '010101');
      assert.equal(report.data.find(n => n.id === second.id).tomadorNomeOrigem, 'CADASTRO_ATUAL');
      for (const field of ['xmlBase64', 'pdfBase64', 'xmlAutorizadoBase64']) { assert.equal(field in fiscalReportNoteSelect, false); assert.equal(field in frozen, false); }
      assert.equal((await read({ search: '1234567890123' })).meta.total, 1);
    });
    await t.test('backup antigo recupera tomador e servico do XML fiscal verificado', async () => {
      const restored = await note({ numero: 123, numeroOficial: '123', tomadorNome: null, codigoServico: null,
        dataEmissao: new Date('2086-09-01T13:00:00Z'), metadadosVerificadosEm: null, chaveAcesso: key, xmlAutorizadoBase64: makeNfse() });
      try {
        const report = await read({ startDate: '2086-09-01', endDate: '2086-09-01' });
        assert.equal(report.meta.total, 1);
        assert.equal(report.data[0].tomadorNomeExibicao, 'Tomador de teste');
        assert.equal(report.data[0].tomadorNomeOrigem, 'XML_ASSINADO');
        assert.equal(report.data[0].codigoTribNacional, '010101');
        assert.equal(report.summary.metadadosLegados, 0);
      } finally { await prisma.notaFiscal.delete({ where: { id: restored.id } }); }
    });
    await t.test('desconhecido e suporte direto nao leem; contador perde acesso apos revogacao', async () => {
      await assert.rejects(getFiscalReport(stranger.id, company.id, query(), now), { status: 403 });
      await assert.rejects(getFiscalReport(support.id, company.id, query(), now), { status: 403 });
      await prisma.userCliente.create({ data: { userId: accountant.id, empresaId: company.id } });
      assert.equal((await getFiscalReport(accountant.id, company.id, query(), now)).meta.total, 2);
      await prisma.userCliente.deleteMany({ where: { userId: accountant.id, empresaId: company.id } });
      await assert.rejects(getFiscalReport(accountant.id, company.id, query(), now), { status: 403 });
    });
    await t.test('ZIP confere contexto e ambiente de TODOS os ids; falta de evento/PDF recusa o lote', async () => {
      const exported = await exportFiscalReport(owner.id, company.id, { ids: [first.id], formato: 'XML' });
      const zip = await JSZip.loadAsync(exported.bytes); assert.ok(zip.file('LEIA-ME.txt'));
      await assert.rejects(exportFiscalReport(stranger.id, company.id, { ids: [first.id], formato: 'XML' }), { status: 403 });
      await assert.rejects(exportFiscalReport(owner.id, company.id, { ids: [first.id, homol.id], formato: 'XML' }), { status: 403 });
      await assert.rejects(exportFiscalReport(owner.id, company.id, { ids: [legacy.id], formato: 'XML' }), { status: 403 });
      await assert.rejects(exportFiscalReport(owner.id, company.id, { ids: [first.id, cancelled.id], formato: 'XML' }), { status: 409 });
      await assert.rejects(exportFiscalReport(owner.id, company.id, { ids: [first.id], formato: 'PDF' }), { status: 409 });
    });
    await t.test('limite de armazenamento recusa exportacao antes de baixar/processar blob', async () => {
      await prisma.$executeRaw`UPDATE "NotaFiscal" SET "xmlBase64" = repeat('x', 33554433) WHERE "id" = ${first.id}`;
      await assert.rejects(exportFiscalReport(owner.id, company.id, { ids: [first.id], formato: 'XML' }), { status: 413 });
      assert.equal((await read()).summary.totalValor, '10.30'); // Listing never reads the oversized blob.
      await prisma.notaFiscal.update({ where: { id: first.id }, data: { xmlBase64: null } });
    });
    await t.test('admin agrega por dia e producao; nao converte testes em volume/receita', async () => {
      const stats = await getAdminFiscalStats(now);
      assert.equal(stats.value, '10.30'); assert.equal(stats.month, 2); assert.equal(stats.previousValue, '4.44');
      assert.equal(stats.byDay['2086-09-02'], 2); assert.equal(stats.byDay['2086-08-31'], 1);
      assert.equal(Object.keys(stats.byDay).length, 30); assert.equal(stats.cancelled, 1); assert.equal(stats.estimated, 1);
    });
    await t.test('mais de mil linhas exige reduzir filtros, nunca entrega relatorio PDF truncado', async () => {
      await prisma.notaFiscal.createMany({ data: Array.from({ length: 1001 }, (_, index) => ({ empresaId: company.id, clienteId: customer.id,
        valor: '0.01', descricao: 'QA limite', prestadorCnpj: '11222333000181', tomadorCnpj: customer.documento, status: 'AUTORIZADA', ambiente: 'HOMOLOGACAO',
        numeroOficial: String(index + 1), dataEmissao: new Date('2086-09-02T12:00:00Z') })) });
      const page = await read({ ambiente: 'HOMOLOGACAO', limit: '20' }); assert.equal(page.data.length, 20); assert.equal(page.meta.total, 1002);
      await assert.rejects(read({ ambiente: 'HOMOLOGACAO', output: 'report' }), { status: 422 });
    });
  } finally {
    if (companies.length) {
      await prisma.notaFiscal.deleteMany({ where: { empresaId: { in: companies } } });
      await prisma.cliente.deleteMany({ where: { empresaId: { in: companies } } });
      await prisma.userCliente.deleteMany({ where: { empresaId: { in: companies } } });
      await prisma.empresa.deleteMany({ where: { id: { in: companies } } });
    }
    if (users.length) await prisma.user.deleteMany({ where: { id: { in: users.map(u => u.id) } } });
  }
});
