const { test } = require('node:test');
const assert = require('node:assert/strict');
const { gzipSync } = require('node:zlib');
const JSZip = require('jszip');
const { fiscalDocumentDownload } = require('../app/services/fiscalDocumentDownload.ts');
test('download: XML original e evento saem separados no ZIP, sem substituir a nota pelo pedido', async () => {
  const original = '<NFSe>original sintetico preservado</NFSe>';
  const event = '<evento>cancelamento sintetico preservado</evento>';
  const response = await fiscalDocumentDownload({ numero: null, numeroOficial: '9999999999999', xmlBase64: null,
    xmlAutorizadoBase64: gzipSync(Buffer.from(original)).toString('base64'), xmlCancelamentoEventoBase64: Buffer.from(event).toString('base64') });
  assert.equal(response.status, 200); assert.equal(response.headers.get('content-type'), 'application/zip');
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  const zip = await JSZip.loadAsync(await response.arrayBuffer());
  assert.equal(await zip.file('NFSe-9999999999999.xml').async('string'), original);
  assert.equal(await zip.file('NFSe-9999999999999-evento-cancelamento.xml').async('string'), event);
});
test('download: arquivo ausente/invalido e descompressao excessiva falham sem expor detalhes', async () => {
  const note = { numero: 1, numeroOficial: '1', xmlBase64: null, xmlAutorizadoBase64: null, xmlCancelamentoEventoBase64: null };
  assert.equal((await fiscalDocumentDownload(note)).status, 404);
  for (const value of ['invalid-data', gzipSync(Buffer.from('<NFSe>' + 'x'.repeat(4 * 1024 * 1024) + '</NFSe>')).toString('base64')]) {
    const response = await fiscalDocumentDownload({ ...note, xmlBase64: value });
    assert.equal(response.status, 422); assert.ok(!(await response.text()).includes('stack'));
  }
});
