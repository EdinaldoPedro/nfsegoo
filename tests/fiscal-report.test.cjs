const { test } = require('node:test');
const assert = require('node:assert/strict');
const { gzipSync } = require('node:zlib');
const JSZip = require('jszip');
const { reportPeriod, currentFiscalMonth, parseFiscalReportQuery, reportEnvironment, formatReportMoney } = require('../app/utils/fiscal-report.ts');
const { parseFiscalExport, buildFiscalExportArchive } = require('../app/services/fiscalReportExportService.ts');
const { createFiscalReportPdf } = require('../app/utils/fiscal-report-pdf.ts');
const { makeReport } = require('./fixtures/fiscal-report.cjs');

test('relatorio usa dia brasileiro e limites inclusivo/exclusivo inclusive no horario de verao legado', () => {
  assert.deepEqual(currentFiscalMonth(new Date('2026-09-01T02:59:59Z')), { startDate: '2026-08-01', endDate: '2026-08-31' });
  const period = reportPeriod('2026-09-01', '2026-09-02');
  assert.equal(period.startsAt.toISOString(), '2026-09-01T03:00:00.000Z');
  assert.equal(period.endsAt.toISOString(), '2026-09-03T03:00:00.000Z');
  const summer = reportPeriod('2018-11-04', '2018-11-04');
  assert.equal(summer.startsAt.toISOString(), '2018-11-04T03:00:00.000Z');
  assert.equal(summer.endsAt.toISOString(), '2018-11-05T02:00:00.000Z');
  assert.equal(reportPeriod('2019-02-16', '2019-02-16').endsAt.toISOString(), '2019-02-17T03:00:00.000Z');
});
test('datas inexistentes, periodo invertido, paginacao e ambiente ambiguo sao recusados', () => {
  for (const [start, end] of [['2026-02-30', '2026-03-01'], ['2026-09-02', '2026-09-01'], ['2025-01-01', '2026-01-02'], ['', '2026-01-01']]) assert.throws(() => reportPeriod(start, end), { status: 400 });
  for (const query of ['page=0', 'limit=101', 'page=1e2', 'incluirCanceladas=1', 'output=all', 'search=%00', 'ambiente=TODOS']) assert.throws(() => parseFiscalReportQuery(new URLSearchParams(query)), { status: 400 });
  assert.equal(reportEnvironment(undefined), 'PRODUCAO');
  for (const input of ['', false, 'producao', {}, '__proto__']) assert.throws(() => reportEnvironment(input), { status: 400 });
  const all = parseFiscalReportQuery(new URLSearchParams('output=report&page=5&limit=1'));
  assert.equal(all.page, 1); assert.equal(all.limit, 1000);
});
test('totais monetarios mantem centavos sem converter agregados para float', () => {
  assert.equal(formatReportMoney('123456789012345678.91'), 'R$ 123.456.789.012.345.678,91');
  assert.equal(formatReportMoney('-0.01'), '-R$ 0,01');
  assert.equal(formatReportMoney('10.1'), 'R$ 10,10');
  assert.equal(formatReportMoney('Infinity'), 'Valor indisponível');
});
test('exportacao limita ids, remove ambiguidade e rejeita repeticao/travessia', () => {
  for (const ids of [[], ['a', 'a'], ['../a'], Array.from({ length: 51 }, (_, i) => String(i))]) assert.throws(() => parseFiscalExport({ ids, formato: 'XML' }), { status: 400 });
  assert.throws(() => parseFiscalExport({ ids: ['a'], formato: 'EXE' }), { status: 400 });
  assert.equal(parseFiscalExport({ ids: ['a'], formato: 'PDF', ambiente: 'LEGADO' }).ambiente, 'LEGADO');
});
const base = { id: 'one', empresaId: 'empresa', numero: 1, numeroOficial: '1234567890123', status: 'AUTORIZADA', xmlBase64: Buffer.from('<NFSe>synthetic</NFSe>').toString('base64'), xmlAutorizadoBase64: null, xmlCancelamentoEventoBase64: null, pdfBase64: null, documentTask: null };
test('ZIP nao sobrescreve numeros iguais e inclui evento separado e aviso de homologacao', async () => {
  const bytes = await buildFiscalExportArchive([base, { ...base, id: 'two', status: 'CANCELADA', xmlCancelamentoEventoBase64: Buffer.from('<evento>synthetic</evento>').toString('base64') }], 'XML', 'HOMOLOGACAO');
  const zip = await JSZip.loadAsync(bytes);
  const files = Object.values(zip.files).filter(file => !file.dir);
  assert.equal(files.length, 4);
  assert.ok(files.some(file => file.name.endsWith('-two-evento-cancelamento.xml')));
  assert.match(await zip.file('LEIA-ME.txt').async('string'), /SEM VALOR FISCAL/);
});
test('lote incompleto, XML perigoso, PDF nao verificado e bomba gzip nunca viram sucesso parcial', async () => {
  await assert.rejects(buildFiscalExportArchive([base, { ...base, id: 'two', xmlBase64: null }], 'XML', 'PRODUCAO'), { status: 409 });
  await assert.rejects(buildFiscalExportArchive([{ ...base, status: 'CANCELADA' }], 'XML', 'PRODUCAO'), { status: 409 });
  await assert.rejects(buildFiscalExportArchive([{ ...base, xmlBase64: Buffer.from('<!DOCTYPE x [<!ENTITY a "x">]><x>&a;</x>').toString('base64') }], 'XML', 'PRODUCAO'), { status: 422 });
  await assert.rejects(buildFiscalExportArchive([{ ...base, pdfBase64: Buffer.from('%PDF-TEST').toString('base64') }], 'PDF', 'PRODUCAO'), { status: 409 });
  await assert.rejects(buildFiscalExportArchive([{ ...base, pdfBase64: gzipSync(Buffer.alloc(21 * 1024 * 1024)).toString('base64'), documentTask: { status: 'CONCLUIDA' } }], 'PDF', 'PRODUCAO'), { status: 422 });
});
test('PDF exige snapshot completo e mantem ambiente e numeracao de 13 digitos em varias paginas', () => {
  const report = makeReport();
  assert.throws(() => createFiscalReportPdf({ ...report, meta: { ...report.meta, complete: false } }), /completo/);
  const pdf = createFiscalReportPdf(report);
  assert.ok(pdf.getNumberOfPages() >= 3);
  const bytes = pdf.output();
  assert.match(bytes, /1234567890000/); assert.match(bytes, /PRODUCAO/);
  const homo = createFiscalReportPdf(makeReport('HOMOLOGACAO', 16));
  assert.match(homo.output(), /SEM VALOR FISCAL/);
  assert.equal(createFiscalReportPdf(makeReport('LEGADO', 0)).getNumberOfPages(), 1);
});
test('PDF nao gera identidade corrompida para caracteres sem glifo disponivel', () => {
  const report = makeReport('PRODUCAO', 1); report.data[0].tomadorNomeExibicao = '東京';
  assert.throws(() => createFiscalReportPdf(report), /caracteres/);
});
