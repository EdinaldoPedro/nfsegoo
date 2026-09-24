const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { DOMParser } = require('@xmldom/xmldom');
const { verifiedFiscalReference, signFiscalXml } = require('../app/services/emissor/validation/FiscalSignature.ts');
const { FiscalSchemaError, validateFiscalSchema, compatibleFiscalSchema } = require('../app/services/emissor/validation/FiscalSchema.ts');
const { makeDps, makeNfse, signingCredentials } = require('./fixtures/fiscal.cjs');

test('DPS: local da prestacao nao muda municipio emissor nem identidade sequencial', async () => {
  const local = makeDps();
  const anotherCity = makeDps(1, (rps) => { rps.servico.localPrestacaoIbge = '2611606'; return rps; });
  const id = (xml) => verifiedFiscalReference(xml, 'DPS').getAttribute('Id');
  assert.equal(id(local), id(anotherCity));
  assert.ok(anotherCity.includes('<cLocEmi>3550308</cLocEmi>'));
  assert.ok(anotherCity.includes('<cLocPrestacao>2611606</cLocPrestacao>'));
  await validateFiscalSchema(anotherCity, 'DPS');
  assert.throws(() => makeDps(1, (rps) => { rps.servico.localPrestacaoIbge = '2611606abc'; return rps; }));
});

test('assinatura XML: canonicaliza aspas, atributos, namespace, entidades e elementos vazios', () => {
  const id = 'DPS' + '1'.repeat(42);
  const original = `<DPS xmlns='http://www.sped.fazenda.gov.br/nfse' versao='1.01'><infDPS z='2' Id='${id}' a='1'><x>A &amp; B &lt; C</x><vazio/></infDPS></DPS>`;
  const signed = signFiscalXml(original, 'DPS', signingCredentials());
  assert.equal(verifiedFiscalReference(signed, 'DPS', signingCredentials().cert).getAttribute('Id'), id);
  assert.doesNotThrow(() => verifiedFiscalReference(signed.replace('<vazio/>', '<vazio></vazio>'), 'DPS'));
  assert.throws(() => verifiedFiscalReference(signed.replace('A &amp; B', 'Conteudo alterado'), 'DPS'));
  assert.throws(() => signFiscalXml(signed, 'DPS', signingCredentials()), /já possui/);
});

test('assinatura XML: rejeita wrapping, IDs ambiguos, referencia remota e algoritmo rebaixado', () => {
  const dps = makeDps();
  const doc = new DOMParser().parseFromString(dps, 'application/xml');
  const id = doc.getElementsByTagName('infDPS')[0].getAttribute('Id');
  for (const altered of [
    dps.replace('</DPS>', `<outro Id="${id}"/></DPS>`),
    dps.replace(`Id="${id}"`, `id="${id}"`),
    dps.replace(`URI="#${id}"`, 'URI="https://example.invalid/document.xml"'),
    dps.replace('rsa-sha256', 'rsa-sha1'),
    dps.replace('<DigestMethod', '<Reference URI="#outro"/><DigestMethod'),
  ]) assert.throws(() => verifiedFiscalReference(altered, 'DPS'));
});

test('assinatura XML: canonicalizacao exclusiva oficial fica restrita a NFSe', () => {
  const dps = makeDps();
  const exclusive = dps
    .replaceAll('http://www.w3.org/TR/2001/REC-xml-c14n-20010315', 'http://www.w3.org/2001/10/xml-exc-c14n#WithComments');
  assert.throws(() => verifiedFiscalReference(exclusive, 'DPS'), /Algoritmo/);
});

test('assinatura XML: certificado privado divergente e assinatura ausente nao sao aceitos', () => {
  const dps = makeDps();
  const crypto = require('node:crypto');
  const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' });
  const unsigned = dps.replace(/<Signature[\s\S]*<\/Signature>/, '');
  assert.throws(() => signFiscalXml(unsigned, 'DPS', { ...signingCredentials(), key: other }), /não corresponde/);
  assert.throws(() => verifiedFiscalReference(unsigned, 'DPS'));
});

test('XSD: valida DPS e NFS-e completas com assinatura e recusa ordenacao/campos indevidos', async () => {
  const dps = makeDps();
  await validateFiscalSchema(dps, 'DPS');
  await validateFiscalSchema(makeNfse(dps), 'NFSe');
  await assert.rejects(validateFiscalSchema(dps.replace('</infDPS>', '<campoInventado>1</campoInventado></infDPS>'), 'DPS'), FiscalSchemaError);
  await assert.rejects(validateFiscalSchema(dps.replace('<tpAmb>1</tpAmb>', '').replace('</infDPS>', '<tpAmb>1</tpAmb></infDPS>'), 'DPS'), FiscalSchemaError);
  await assert.rejects(validateFiscalSchema(makeNfse(dps, { numero: '12345678901234' }), 'NFSe'), FiscalSchemaError);
});

test('XSD: tomador PF com telefone e email usa a ordem oficial', async () => {
  const dps = makeDps(2, (rps) => {
    rps.tomador.telefone = '11987654321';
    rps.tomador.email = 'tomador@example.invalid';
    return rps;
  });
  assert.match(dps, /<toma>[\s\S]*<fone>11987654321<\/fone><email>tomador@example\.invalid<\/email><\/toma>/);
  await validateFiscalSchema(dps, 'DPS');
});

test('XSD: compatibilidade de serie e estrita, versionada e nao altera originais', async () => {
  const name = 'tiposSimples_v1.01.xsd';
  const file = path.join(__dirname, '../resources/fiscal/xsd/1.01', name);
  const original = readFileSync(file, 'utf8');
  const adapted = compatibleFiscalSchema(name, original);
  assert.equal(adapted, original);
  assert.equal(readFileSync(file, 'utf8'), original);
  assert.throws(() => compatibleFiscalSchema(name, original.replace('[0-9]{1,4}|[0-8][0-9]{4}', '[0-9]{1,5}')), /mudou/);
  const dps = makeDps();
  for (const serie of ['0', '1', '900', '00900', '70000', '89999']) await validateFiscalSchema(dps.replace('<serie>900</serie>', `<serie>${serie}</serie>`), 'DPS');
  for (const serie of ['', 'A1', '900A', '^900$', '90000', '99999', '123456', '-1', ' 900', '900 ', '١٢']) await assert.rejects(validateFiscalSchema(dps.replace('<serie>900</serie>', `<serie>${serie}</serie>`), 'DPS'), FiscalSchemaError);
});

test('XSD: erro de validacao nao vaza valor de campo pessoal', async () => {
  const secret = 'sensitive-personal-value';
  await assert.rejects(validateFiscalSchema(makeDps().replace('<CPF>12345678909</CPF>', `<CPF>${secret}</CPF>`), 'DPS'), (error) => {
    assert.equal(error.name, 'FiscalSchemaError');
    assert.ok(!error.message.includes(secret));
    assert.ok(!JSON.stringify(error).includes(secret));
    return true;
  });
});

test('XML fiscal: limite de profundidade e UTF-8 invalido falham antes da validacao', async () => {
  await assert.rejects(validateFiscalSchema('<a>'.repeat(101) + '</a>'.repeat(101), 'DPS'), /profundo/);
  const invalid = Buffer.concat([Buffer.from('<x>'), Buffer.from([0xff]), Buffer.from('</x>')]);
  await assert.rejects(validateFiscalSchema(invalid.toString('base64'), 'DPS'));
});
