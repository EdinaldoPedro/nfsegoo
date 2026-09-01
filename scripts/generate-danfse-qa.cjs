const fs = require('node:fs');
const path = require('node:path');
const { generateDanfsePdf } = require('../app/services/pdf/DanfseGenerator.ts');

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<NFSe><infNFSe Id="NFS12345678901234567890123456789012345678901234567890">
  <nNFSe>202600000023</nNFSe><dhProc>2026-08-25T09:30:00</dhProc><xLocEmi>Recife</xLocEmi><xLocPrestacao>Uruguai</xLocPrestacao><xLocIncid>Recife</xLocIncid><cLocIncid>2611606</cLocIncid><cStat>100</cStat><ambGer>Emissor Nacional</ambGer>
  <emit><CNPJ>54545869000140</CNPJ><xNome>PRESTADOR DE SERVICOS TECNOLOGICOS LTDA</xNome><enderNac><cMun>2611606</cMun><CEP>51010000</CEP><xLgr>Avenida Engenheiro Domingos Ferreira</xLgr><nro>1000</nro><xBairro>Boa Viagem</xBairro><UF>PE</UF></enderNac><email>fiscal@prestador.example</email></emit>
  <valores><vBC>51422.26</vBC><pAliqAplic>5.00</pAliqAplic><vISSQN>2571.11</vISSQN><vTotalRet>2571.11</vTotalRet><vLiq>48851.15</vLiq></valores><IBSCBS><cLocalidadeIncid>9999999</cLocalidadeIncid><xLocalidadeIncid>Exterior</xLocalidadeIncid></IBSCBS>
  <DPS><infDPS><tpAmb>2</tpAmb><dCompet>2026-08-24</dCompet><dhEmi>2026-08-25T09:29:00</dhEmi><nDPS>14</nDPS><serie>900</serie><tpEmit>1</tpEmit>
    <prest><CNPJ>54545869000140</CNPJ><regTrib><opSimpNac>3</opSimpNac><regApTribSN>1</regApTribSN><regEspTrib>0</regEspTrib></regTrib></prest>
    <toma><NIF>UY123</NIF><xNome>TOMADOR NO EXTERIOR</xNome><end><endExt><cEndPost>11000</cEndPost><xCidade>Montevideo</xCidade></endExt></end><email>financeiro@tomador.example</email></toma>
    <serv><cServ><cTribNac>01.01.01</cTribNac><cNBS>123456789</cNBS><xDescServ>Consultoria especializada em arquitetura, implantação, monitoramento e sustentação de sistemas fiscais integrados, conforme contrato e relatório técnico mensal.</xDescServ></cServ><locPrest><cPaisPrestacao>UY</cPaisPrestacao></locPrest><infoCompl><xInfComp>Serviço executado remotamente com aceite eletrônico do tomador.</xInfComp></infoCompl></serv><IBSCBS><cIndOp>100301</cIndOp></IBSCBS>
    <valores><vServPrest><vServ>51422.26</vServ></vServPrest><tribMun><tribISSQN>1</tribISSQN><tpRetISSQN>2</tpRetISSQN></tribMun><tribFed><vRetIRRF>771.33</vRetIRRF><vRetCP>0.00</vRetCP><vRetCSLL>514.22</vRetCSLL><piscofins><tpRetPisCofins>3</tpRetPisCofins><vPis>334.24</vPis><vCofins>1542.67</vCofins></piscofins></tribFed></valores>
  </infDPS></DPS>
</infNFSe></NFSe>`;

(async () => {
  const outputDir = path.join(process.cwd(), 'output', 'pdf');
  fs.mkdirSync(outputDir, { recursive: true });
  const output = path.join(outputDir, 'danfse-uf-exterior-qa.pdf');
  fs.writeFileSync(output, await generateDanfsePdf(xml));
  process.stdout.write(output);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
