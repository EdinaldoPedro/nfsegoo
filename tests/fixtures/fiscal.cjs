// Synthetic tax data and self-signed keys. NEVER an ICP-Brasil certificate or a
// real authorization. Used only to exercise structure and cryptographic integrity.
const crypto = require('node:crypto');
const forge = require('node-forge');
const { signFiscalXml } = require('../../app/services/emissor/validation/FiscalSignature.ts');
const { NacionalAdapter } = require('../../app/services/emissor/adapters/NacionalAdapter.ts');
const ns = 'http://www.sped.fazenda.gov.br/nfse';
const key = '1'.repeat(50);
let credentials;
function signingCredentials() {
  if (credentials) return credentials;
  const keys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
  const cert = forge.pki.createCertificate();
  cert.publicKey = forge.pki.publicKeyFromPem(keys.publicKey);
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date('2026-01-01T00:00:00Z');
  cert.validity.notAfter = new Date('2027-01-01T00:00:00Z');
  const attrs = [{ name: 'commonName', value: 'QA ONLY - NOT AN OFFICIAL FISCAL CERTIFICATE' }];
  cert.setSubject(attrs); cert.setIssuer(attrs);
  cert.sign(forge.pki.privateKeyFromPem(keys.privateKey), forge.md.sha256.create());
  credentials = { key: keys.privateKey, cert: forge.pki.certificateToPem(cert) };
  return credentials;
}
function canonicalRps(number = 1) {
  return {
    prestador: { documento: '11222333000181', regimeTributario: 'MEI', endereco: { codigoIbge: '3550308', uf: 'SP' }, configuracoes: { regimeEspecial: '0' } },
    tomador: { documento: '12345678909', tipo: 'PF', razaoSocial: 'Tomador de teste', endereco: { codigoIbge: '3550308', cep: '01001000', logradouro: 'Rua de teste', numero: '10', bairro: 'Centro', cidade: 'Sao Paulo', uf: 'SP' } },
    servico: { valor: 123.45, descricao: 'Servico sintetico de teste', codigoTributacaoNacional: '010101', tipoTributacao: '1', issRetido: false },
    meta: { ambiente: 'PRODUCAO', serie: '900', numero: number, dataEmissao: new Date('2026-09-02T13:00:00Z'), dataCompetencia: '2026-09-02', layoutVersion: '1.01' },
  };
}
function makeDps(number = 1, mutate = (rps) => rps) {
  return signFiscalXml(new NacionalAdapter().toXml(mutate(canonicalRps(number))), 'DPS', signingCredentials());
}
function makeNfse(dps = makeDps(), { numero = '123', chave = key, issuerDocument = '11222333000181' } = {}) {
  const content = `<NFSe xmlns="${ns}" versao="1.01"><infNFSe Id="NFS${chave}"><xLocEmi>Sao Paulo</xLocEmi><xLocPrestacao>Sao Paulo</xLocPrestacao><nNFSe>${numero}</nNFSe><xTribNac>Analise de sistemas</xTribNac><verAplic>QA-1</verAplic><ambGer>2</ambGer><tpEmis>1</tpEmis><cStat>107</cStat><dhProc>2026-09-02T10:30:00-03:00</dhProc><nDFSe>123</nDFSe><emit><CNPJ>${issuerDocument}</CNPJ><xNome>Emitente de teste</xNome><enderNac><xLgr>Rua de teste</xLgr><nro>10</nro><xBairro>Centro</xBairro><cMun>3550308</cMun><UF>SP</UF><CEP>01001000</CEP></enderNac></emit><valores><vLiq>123.45</vLiq></valores>${dps.replace(/<\?xml[^?]*\?>/, '')}</infNFSe></NFSe>`;
  return signFiscalXml(content, 'NFSe', signingCredentials());
}
function makeCancellationEvent(requestXml, chave = key, type = '101101') {
  return signFiscalXml(`<evento xmlns="${ns}" versao="1.01"><infEvento Id="EVT${chave}${type}001"><verAplic>Portal-QA</verAplic><ambGer>2</ambGer><nSeqEvento>1</nSeqEvento><dhProc>2026-09-02T13:01:00+00:00</dhProc><nDFSe>456</nDFSe>${requestXml}</infEvento></evento>`, 'evento', signingCredentials());
}
module.exports = { ns, key, signingCredentials, canonicalRps, makeDps, makeNfse, makeCancellationEvent };
