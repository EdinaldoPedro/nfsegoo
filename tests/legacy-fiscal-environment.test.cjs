const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Prisma } = require('@prisma/client');
const { inspectLegacyFiscalEnvironment } = require('../app/services/legacyFiscalEnvironmentService.ts');
const { signFiscalXml } = require('../app/services/emissor/validation/FiscalSignature.ts');
const { makeDps, makeNfse, signingCredentials, key } = require('./fixtures/fiscal.cjs');

const xml = makeNfse(makeDps());
function note(overrides = {}) {
  return { id: 'qa-note', empresaId: 'qa-company', vendaId: null, numero: 123, numeroOficial: '123', ambiente: null,
    status: 'AUTORIZADA', arquivadoEm: null, chaveAcesso: key, prestadorCnpj: '11222333000181',
    valor: new Prisma.Decimal('123.45'), xmlAutorizadoBase64: Buffer.from(xml).toString('base64'),
    xmlBase64: Buffer.from(xml).toString('base64'), dataEmissao: null, empresa: { razaoSocial: 'QA', documento: '11222333000181' }, ...overrides };
}

test('ambiente legado: confirma apenas ambiente assinado e identificadores congelados', async () => {
  const result = await inspectLegacyFiscalEnvironment(note());
  assert.equal(result.eligible, true);
  assert.equal(result.verified.ambiente, 'PRODUCAO');
  assert.equal(result.verified.schema, 'ATUAL');
  assert.match(result.verified.xmlHash, /^[0-9a-f]{64}$/);
  assert.equal((await inspectLegacyFiscalEnvironment(note({ ambiente: 'HOMOLOGACAO' }))).eligible, false);
  assert.equal((await inspectLegacyFiscalEnvironment(note({ status: 'RASCUNHO' }))).eligible, false);
});

test('ambiente legado: XML adulterado, chave, prestador, numero e valor divergentes ficam bloqueados', async () => {
  const tampered = Buffer.from(xml.replace('<tpAmb>1</tpAmb>', '<tpAmb>2</tpAmb>')).toString('base64');
  for (const overrides of [
    { xmlAutorizadoBase64: tampered, xmlBase64: tampered },
    { chaveAcesso: '2'.repeat(50) },
    { prestadorCnpj: '00000000000000' },
    { numeroOficial: '999' },
    { valor: new Prisma.Decimal('999.00') },
    { empresa: { razaoSocial: 'QA', documento: '00000000000000' } },
    { xmlAutorizadoBase64: null, xmlBase64: null },
    { xmlBase64: tampered },
  ]) assert.equal((await inspectLegacyFiscalEnvironment(note(overrides))).eligible, false);
});

test('ambiente legado: exceção XSD fica restrita aos campos históricos xNBS/CEP', async () => {
  const start = xml.lastIndexOf('<Signature xmlns');
  const end = xml.lastIndexOf('</Signature>') + '</Signature>'.length;
  const unsigned = xml.slice(0, start) + xml.slice(end);
  const signedWith = (field) => Buffer.from(signFiscalXml(unsigned.replace('</infNFSe>', field + '</infNFSe>'),
    'NFSe', signingCredentials())).toString('base64');
  const historic = signedWith('<xNBS>123</xNBS>');
  const accepted = await inspectLegacyFiscalEnvironment(note({ xmlAutorizadoBase64: historic, xmlBase64: historic }));
  assert.equal(accepted.eligible, true);
  assert.equal(accepted.verified.schema, 'LEGADO_XNBS_CEP');
  const invented = signedWith('<campoInventado>1</campoInventado>');
  assert.equal((await inspectLegacyFiscalEnvironment(note({ xmlAutorizadoBase64: invented, xmlBase64: invented }))).eligible, false);
});
