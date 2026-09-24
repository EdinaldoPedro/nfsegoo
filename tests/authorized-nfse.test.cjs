const { test } = require('node:test');
const assert = require('node:assert/strict');
const { gzipSync } = require('node:zlib');
const { fiscalXml, preparedDpsId, validateAuthorizedNfse } = require('../app/services/emissor/validation/AuthorizedNfseValidator.ts');
const { makeDps, makeNfse, key } = require('./fixtures/fiscal.cjs');
const dps = makeDps();
const id = preparedDpsId(dps);
const nfse = makeNfse(dps);

test('retorno: XSD, assinatura, DPS preparada, chave e ambiente conferem', async () => {
  assert.match(id, /^DPS[0-9]{42}$/);
  for (const value of [nfse, Buffer.from(nfse).toString('base64'), gzipSync(nfse).toString('base64')]) {
    const result = await validateAuthorizedNfse(value, dps, 'PRODUCAO', key);
    assert.equal(result.numero, '123');
    assert.equal(result.chave, key);
    assert.equal(result.protocolo, '123');
    assert.equal(result.dataEmissao.toISOString(), '2026-09-02T13:30:00.000Z');
    assert.equal(Buffer.from(result.xml, 'base64').toString(), nfse);
  }
});

test('retorno: outra DPS assinada, ambiente, chave e texto Autorizado nao comprovam autorizacao', async () => {
  await assert.rejects(validateAuthorizedNfse(makeNfse(makeDps(2)), dps, 'PRODUCAO'), /outra DPS/);
  await assert.rejects(validateAuthorizedNfse(nfse, dps, 'HOMOLOGACAO'), /Ambiente/);
  await assert.rejects(validateAuthorizedNfse(nfse, dps, 'invalido'), /Ambiente/);
  await assert.rejects(validateAuthorizedNfse(nfse, dps, 'PRODUCAO', '2'.repeat(50)), /Chave/);
  await assert.rejects(validateAuthorizedNfse('<html>Autorizado</html>', dps, 'PRODUCAO'));
  await assert.rejects(validateAuthorizedNfse(dps, dps, 'PRODUCAO'));
});

test('retorno: duplicacao de blocos, adulteracao e campos faltantes sao rejeitados', async () => {
  for (const xml of [
    nfse.replace('</infNFSe>', dps.replace(/<\?xml[^?]*\?>/, '') + '</infNFSe>'),
    nfse.replace('<nNFSe>123</nNFSe>', ''),
    nfse.replace('<nNFSe>123</nNFSe>', '<nNFSe>0</nNFSe>'),
    nfse.replace('123.45', '999.99'),
    nfse.replace('2026-09-02T10:30:00-03:00', 'nao-data'),
    nfse.replace('Id="NFS' + key, 'Id="NFSe' + key),
  ]) await assert.rejects(validateAuthorizedNfse(xml, dps, 'PRODUCAO'));
});

test('retorno: bloqueia DTD, entidades, XML malformado, HTML e bomba gzip', async () => {
  for (const xml of ['<!DOCTYPE x [<!ENTITY secret SYSTEM "file:///secret">]><x>&secret;</x>', '<!ENTITY x "a"><x/>', '<x><y></x>', 'nao-xml']) {
    await assert.rejects(validateAuthorizedNfse(xml, dps, 'PRODUCAO'));
  }
  assert.throws(() => fiscalXml(gzipSync('<a>' + 'x'.repeat(5 * 1024 * 1024) + '</a>').toString('base64')));
});
