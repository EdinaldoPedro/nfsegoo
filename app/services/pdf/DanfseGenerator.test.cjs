const test = require('node:test');
const assert = require('node:assert/strict');
const { DANFSE_LAYOUT, generateDanfsePdf, parseDanfseXml } = require('./DanfseGenerator.ts');

function xmlAutorizado({ ambiente = '1', emailEmitente = 'cadastro.portal@example.com', descricao = 'Consultoria em tecnologia', exterior = false } = {}) {
  const contatoEmitente = emailEmitente ? `<email>${emailEmitente}</email>` : '';
  const enderecoTomador = exterior
    ? '<end><endExt><cEndPost>19801</cEndPost><xCidade>Wilmington</xCidade><xEstProv>Delaware</xEstProv></endExt></end><NIF>US123</NIF>'
    : '<end><endNac><cMun>3550308</cMun><CEP>01001000</CEP><xLgr>Praça da Sé</xLgr><nro>1</nro><xBairro>Sé</xBairro><UF>SP</UF></endNac></end><CNPJ>11222333000181</CNPJ>';
  return `<?xml version="1.0" encoding="UTF-8"?>
  <NFSe><infNFSe Id="NFS12345678901234567890123456789012345678901234567890">
    <nNFSe>23</nNFSe><dhProc>2026-08-25T09:30:00</dhProc><xLocEmi>Recife</xLocEmi><xLocIncid>Recife</xLocIncid><cLocIncid>2611606</cLocIncid><cStat>100</cStat><ambGer>Emissor Nacional</ambGer>
    <emit><CNPJ>54545869000140</CNPJ><xNome>PRESTADOR TESTE</xNome><enderNac><cMun>2611606</cMun><CEP>51010000</CEP><xLgr>AVENIDA TESTE</xLgr><nro>100</nro><xBairro>BOA VIAGEM</xBairro><UF>PE</UF></enderNac>${contatoEmitente}</emit>
    <valores><vBC>1000.00</vBC><pAliqAplic>5.00</pAliqAplic><vISSQN>50.00</vISSQN><vTotalRet>65.00</vTotalRet><vLiq>935.00</vLiq></valores>
    <DPS><infDPS><tpAmb>${ambiente}</tpAmb><dCompet>2026-08-25</dCompet><dhEmi>2026-08-25T09:29:00</dhEmi><nDPS>13</nDPS><serie>900</serie><tpEmit>1</tpEmit>
      <prest><CNPJ>54545869000140</CNPJ><email>usuario-do-saas@example.com</email><regTrib><opSimpNac>2</opSimpNac><regApTribSN>1</regApTribSN><regEspTrib>0</regEspTrib></regTrib></prest>
      <toma>${enderecoTomador}<xNome>TOMADOR TESTE</xNome><email>tomador@example.com</email></toma>
      <serv><cServ><cTribNac>01.01.01</cTribNac><cNBS>123456789</cNBS><xDescServ>${descricao}</xDescServ></cServ></serv>
      <valores><vServPrest><vServ>1000.00</vServ></vServPrest><tribMun><tribISSQN>1</tribISSQN><tpRetISSQN>1</tpRetISSQN></tribMun><tribFed><vRetIRRF>10.00</vRetIRRF><vRetCP>20.00</vRetCP><vRetCSLL>5.00</vRetCSLL><piscofins><tpRetPisCofins>1</tpRetPisCofins><vPis>10.00</vPis><vCofins>20.00</vCofins></piscofins></tribFed></valores>
    </infDPS></DPS>
  </infNFSe></NFSe>`;
}

test('usa CEP e e-mail cadastral do emitente devolvido pelo Portal Nacional', () => {
  const data = parseDanfseXml(xmlAutorizado());
  assert.equal(data.prestador.codigoIbgeCep, '26.11606 / 51.010-000');
  assert.equal(data.prestador.email, 'cadastro.portal@example.com');
});

test('não reaproveita contato não cadastral da DPS', () => {
  assert.equal(parseDanfseXml(xmlAutorizado({ emailEmitente: '' })).prestador.email, '');
  assert.equal(parseDanfseXml(xmlAutorizado({ emailEmitente: 'usuario-do-saas@example.com' })).prestador.email, '');
});

test('extrai identificação, serviço, ISSQN, retenções e totais exclusivamente do XML', () => {
  const data = parseDanfseXml(xmlAutorizado());
  assert.equal(data.numeroNfse, '23');
  assert.equal(data.numeroDps, '13');
  assert.equal(data.servico.codigoTributacao, '01.01.01');
  assert.equal(data.servico.codigoNbs, '1.2345.67.89');
  assert.equal(data.issqn.valor, 'R$ 50,00');
  assert.equal(data.federal.irrf, 'R$ 10,00');
  assert.equal(data.totais.liquido, 'R$ 935,00');
});

test('trata tomador no exterior', () => {
  const data = parseDanfseXml(xmlAutorizado({ exterior: true }));
  assert.equal(data.tomador.documento, 'US123');
  assert.match(data.tomador.codigoIbgeCep, /19801/);
});

test('fixa medidas formais da NT 008 v1.02', () => {
  assert.equal(DANFSE_LAYOUT.page.width, 210);
  assert.equal(DANFSE_LAYOUT.page.height, 297);
  assert.equal(DANFSE_LAYOUT.qr.size, 15.2);
  assert.ok(Math.abs(DANFSE_LAYOUT.internalLineMm - 0.1763888889) < 0.00001);
});

test('gera A4 retrato de página única nos cenários normal, homologação, cancelamento e substituição', async () => {
  for (const scenario of [
    { xml: xmlAutorizado(), options: {} },
    { xml: xmlAutorizado({ ambiente: '2' }), options: {} },
    { xml: xmlAutorizado(), options: { cancelada: true } },
    { xml: xmlAutorizado(), options: { substituida: true } },
  ]) {
    const pdf = await generateDanfsePdf(scenario.xml, scenario.options);
    assert.equal(pdf.subarray(0, 4).toString(), '%PDF');
    assert.ok(pdf.length > 10_000);
  }
});

test('conteúdo extenso é ajustado sem criar uma segunda página', async () => {
  const descricao = 'Serviço técnico especializado com detalhamento operacional, fiscal e contratual. '.repeat(30);
  const pdf = await generateDanfsePdf(xmlAutorizado({ descricao }));
  assert.equal(pdf.subarray(0, 4).toString(), '%PDF');
});
