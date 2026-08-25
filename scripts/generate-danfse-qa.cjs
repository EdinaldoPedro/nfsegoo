const fs = require('node:fs');
const path = require('node:path');
const { generateDanfsePdf } = require('../app/services/pdf/DanfseGenerator.ts');

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<NFSe><infNFSe Id="NFS12345678901234567890123456789012345678901234567890">
  <nNFSe>202600000023</nNFSe><dhProc>2026-08-25T09:30:00</dhProc><xLocEmi>Recife</xLocEmi><xLocIncid>Recife</xLocIncid><cLocIncid>2611606</cLocIncid><cStat>100</cStat><ambGer>Emissor Nacional</ambGer>
  <emit><CNPJ>54545869000140</CNPJ><xNome>PRESTADOR DE SERVICOS TECNOLOGICOS LTDA</xNome><enderNac><cMun>2611606</cMun><CEP>51010000</CEP><xLgr>Avenida Engenheiro Domingos Ferreira</xLgr><nro>1000</nro><xBairro>Boa Viagem</xBairro><UF>PE</UF></enderNac><email>fiscal@prestador.example</email></emit>
  <valores><vBC>51422.26</vBC><pAliqAplic>5.00</pAliqAplic><vISSQN>2571.11</vISSQN><vTotalRet>2571.11</vTotalRet><vLiq>48851.15</vLiq></valores>
  <DPS><infDPS><tpAmb>2</tpAmb><dCompet>2026-08-24</dCompet><dhEmi>2026-08-25T09:29:00</dhEmi><nDPS>14</nDPS><serie>900</serie><tpEmit>1</tpEmit>
    <prest><CNPJ>54545869000140</CNPJ><regTrib><opSimpNac>3</opSimpNac><regApTribSN>1</regApTribSN><regEspTrib>0</regEspTrib></regTrib></prest>
    <toma><CNPJ>11222333000181</CNPJ><xNome>TOMADOR EMPRESARIAL COM NOME EXTENSO PARA VALIDACAO VISUAL LTDA</xNome><end><endNac><cMun>3550308</cMun><CEP>01001000</CEP><xLgr>Praça da Sé</xLgr><nro>1</nro><xBairro>Sé</xBairro><UF>SP</UF></endNac></end><email>financeiro@tomador.example</email></toma>
    <serv><cServ><cTribNac>01.01.01</cTribNac><cNBS>123456789</cNBS><xDescServ>Consultoria especializada em arquitetura, implantação, monitoramento e sustentação de sistemas fiscais integrados, conforme contrato e relatório técnico mensal.</xDescServ></cServ><infoCompl><xInfComp>Serviço executado remotamente com aceite eletrônico do tomador.</xInfComp></infoCompl></serv>
    <valores><vServPrest><vServ>51422.26</vServ></vServPrest><tribMun><tribISSQN>1</tribISSQN><tpRetISSQN>2</tpRetISSQN></tribMun><tribFed><vRetIRRF>771.33</vRetIRRF><vRetCP>0.00</vRetCP><vRetCSLL>514.22</vRetCSLL><piscofins><tpRetPisCofins>3</tpRetPisCofins><vPis>334.24</vPis><vCofins>1542.67</vCofins></piscofins></tribFed></valores>
  </infDPS></DPS>
</infNFSe></NFSe>`;

(async () => {
  const outputDir = path.join(process.cwd(), 'output', 'pdf');
  fs.mkdirSync(outputDir, { recursive: true });
  const output = path.join(outputDir, 'danfse-nt008-v102-qa.pdf');
  fs.writeFileSync(output, await generateDanfsePdf(xml));
  process.stdout.write(output);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
