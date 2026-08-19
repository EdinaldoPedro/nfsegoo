import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { getFederalRetentionEligibility, getIbsCbsPilotControl, getPisCofinsDueDefaults, isIbsCbsMandatory, meetsFederalRetentionMinimum, retentionType, roundHalfEven, shouldEnableIbsCbs } from './FiscalMath.ts';
import { NacionalAdapter } from '../adapters/NacionalAdapter.ts';
import { validateDpsXml } from '../validation/DpsPreflightValidator.ts';

const retention = (retido, valor) => ({ retido, valor });

test('mapeia todas as combinacoes atuais de PIS/COFINS/CSLL da NT 007', () => {
  const cases = [
    [false, false, false, '0'], [true, true, true, '3'], [true, true, false, '4'],
    [true, false, false, '5'], [false, true, false, '6'], [false, true, true, '7'],
    [false, false, true, '8'], [true, false, true, '9'],
  ];
  for (const [pis, cofins, csll, expected] of cases) {
    assert.equal(retentionType({ pis: retention(pis, pis ? 1 : 0), cofins: retention(cofins, cofins ? 1 : 0), csll: retention(csll, csll ? 1 : 0) }), expected);
  }
});

test('aplica arredondamento bancario half-even', () => {
  assert.equal(roundHalfEven(1.005), 1);
  assert.equal(roundHalfEven(1.015), 1.02);
  assert.equal(roundHalfEven(2.675), 2.68);
});

test('aplica separadamente o limite mínimo monetário das retenções federais', () => {
  assert.equal(meetsFederalRetentionMinimum(10, 10.01), false);
  assert.equal(meetsFederalRetentionMinimum(10.004, 10.01), false);
  assert.equal(meetsFederalRetentionMinimum(10.006, 10.01), true);
  assert.equal(meetsFederalRetentionMinimum(0.01, 0), true);
});

test('respeita o cronograma de obrigatoriedade por regime', () => {
  assert.equal(isIbsCbsMandatory('LUCRO_PRESUMIDO', '2026-09-30', '7.02'), false);
  assert.equal(isIbsCbsMandatory('LUCRO_PRESUMIDO', '2026-10-01', '7.02'), true);
  assert.equal(isIbsCbsMandatory('LUCRO_PRESUMIDO', '2026-10-01', '1.03'), false);
  assert.equal(isIbsCbsMandatory('LUCRO_PRESUMIDO', '2026-12-01', '1.03'), true);
  assert.equal(isIbsCbsMandatory('LUCRO_PRESUMIDO', '2026-11-30', '7.02', '2026-12-01'), false);
  assert.equal(isIbsCbsMandatory('SIMPLES', '2026-12-31'), false);
  assert.equal(isIbsCbsMandatory('SIMPLES', '2027-01-01'), true);
});

test('pilota IBS/CBS por chave geral e regime sem alterar a obrigatoriedade', () => {
  assert.deepEqual(getIbsCbsPilotControl('LUCRO_PRESUMIDO'), {
    masterEnabled: true, regimeEnabled: true, enabled: true,
  });
  assert.equal(getIbsCbsPilotControl('MEI').enabled, false);
  assert.equal(getIbsCbsPilotControl('SIMPLES', { ibsCbsSimplesAtivo: true }).enabled, true);
  assert.equal(getIbsCbsPilotControl('LUCRO_REAL', {
    ibsCbsPilotoAtivo: false,
    ibsCbsLucroRealAtivo: true,
  }).enabled, false);
  assert.equal(getIbsCbsPilotControl('REGIME_DESCONHECIDO').enabled, false);
  assert.equal(shouldEnableIbsCbs({ mandatory: false, competence: '2025-12-31', pilotEnabled: true, ruleEnabled: true }), false);
  assert.equal(shouldEnableIbsCbs({ mandatory: false, competence: '2026-08-19', pilotEnabled: true, ruleEnabled: false }), false);
  assert.equal(shouldEnableIbsCbs({ mandatory: true, competence: '2027-01-01', pilotEnabled: false, ruleEnabled: false }), true);
});

test('separa a apuracao propria padrao do Lucro Presumido das retencoes', () => {
  assert.deepEqual(getPisCofinsDueDefaults('LUCRO_PRESUMIDO'), { enabled: true, pis: 0.65, cofins: 3, cst: '01' });
  assert.equal(getPisCofinsDueDefaults('LUCRO_REAL').enabled, false);
  assert.equal(getPisCofinsDueDefaults('SIMPLES').enabled, false);
});

test('restringe retenções federais por tomador e regime sem bloquear PJ normal', () => {
  assert.deepEqual(getFederalRetentionEligibility('LUCRO_PRESUMIDO', 'PF', 'Brasil'), {
    domesticLegalEntity: false, crsfAndIrrf: false, inss: false, reason: 'PF',
  });
  assert.deepEqual(getFederalRetentionEligibility('LUCRO_REAL', 'PJ', 'US'), {
    domesticLegalEntity: false, crsfAndIrrf: false, inss: false, reason: 'EXTERIOR',
  });
  assert.deepEqual(getFederalRetentionEligibility('LUCRO_PRESUMIDO', 'PJ', 'Brasil'), {
    domesticLegalEntity: true, crsfAndIrrf: true, inss: true, reason: 'DOMESTIC_PJ',
  });
  assert.deepEqual(getFederalRetentionEligibility('SIMPLES', 'PJ', 'Brasil'), {
    domesticLegalEntity: true, crsfAndIrrf: false, inss: true, reason: 'REGIME_SIMPLES',
  });
});

test('gera o caso LP para PJ com ISS nao retido e retencoes federais', () => {
  const xml = new NacionalAdapter().toXml({
    prestador: {
      id: 'empresa', documento: '62172136000136', inscricaoMunicipal: '683343001', regimeTributario: 'LUCRO_PRESUMIDO',
      endereco: { codigoIbge: '1302603', uf: 'AM' }, configuracoes: { regimeEspecial: '0' },
    },
    tomador: {
      documento: '21116762000209', razaoSocial: 'AGROSMART S.A.', tipo: 'PJ', pais: 'Brasil', moeda: 'BRL',
      endereco: { cep: '69010080', logradouro: '24 DE MAIO', numero: '220', complemento: 'SALA 801', bairro: 'CENTRO', cidade: 'Manaus', codigoIbge: '1302603', uf: 'AM' },
    },
    servico: {
      valor: 9248.97, valorLiquido: 8682, descricao: 'Servico Prestado em Agosto de 2026', cnae: '6204000',
      codigoTributacaoNacional: '010601', codigoTributacaoMunicipal: '100', codigoNbs: '115011000',
      aliquotaAplicada: 5, aliquotaMunicipio: 5, aliquotaTotTribFederal: 4.65, valorIss: 462.45, issRetido: false, tipoTributacao: '1',
      retencoes: {
        pis: { retido: true, aliquota: 0.65, valor: 59.92 }, cofins: { retido: true, aliquota: 3, valor: 276.57 },
        csll: { retido: true, aliquota: 1, valor: 92.19 }, ir: { retido: true, aliquota: 1.5, valor: 138.29 }, inss: { retido: false, valor: 0 },
      },
      tributosFederaisDevidos: {
        cst: '01', baseCalculo: 9218.97, pis: { aliquota: 0.65, valor: 59.92 }, cofins: { aliquota: 3, valor: 276.57 },
      },
      ibscbs: { enabled: true, mandatory: false, finNFSe: '0', indFinal: '0', cIndOp: '100301', indDest: '0', cst: '000', cClassTrib: '000001' },
    },
    meta: { ambiente: 'PRODUCAO', serie: '70000', numero: 7, dataEmissao: new Date('2026-08-19T12:44:34Z'), dataCompetencia: '2026-08-19', layoutVersion: '1.01' },
  });

  assert.match(xml, /<tpRetISSQN>1<\/tpRetISSQN>/);
  assert.doesNotMatch(xml, /<tribMun>.*?<pAliq>/s);
  assert.match(xml, /<tpRetPisCofins>3<\/tpRetPisCofins>/);
  assert.match(xml, /<vPis>59\.92<\/vPis><vCofins>276\.57<\/vCofins>/);
  assert.match(xml, /<vRetCSLL>428\.68<\/vRetCSLL>/);
  assert.match(xml, /<IBSCBS><finNFSe>0<\/finNFSe><indFinal>0<\/indFinal><cIndOp>100301<\/cIndOp>/);
  assert.deepEqual(validateDpsXml(xml), []);
  assert.ok(validateDpsXml(xml.replace('<finNFSe>0</finNFSe>', '<finNFSe>1</finNFSe>')).some(issue => issue.code === 'IBSCBS_FINNFSE_INVALIDO'));
  assert.ok(validateDpsXml(xml.replace('<cMun>1302603</cMun>', '<cMun>9999999</cMun>')).some(issue => issue.code === 'IBGE_PLACEHOLDER'));
  if (process.env.FISCAL_XML_OUTPUT) writeFileSync(process.env.FISCAL_XML_OUTPUT, xml, 'utf8');
});

test('gera MEI para PF com endereco, NBS e IBS/CBS sem CTM nem aliquota de ISS', () => {
  const base = {
    prestador: {
      id: 'empresa-mei', documento: '54545869000140', inscricaoMunicipal: '123456', regimeTributario: 'MEI',
      endereco: { codigoIbge: '2611606', uf: 'PE' }, configuracoes: { regimeEspecial: '0' },
    },
    tomador: {
      documento: '12345678909', razaoSocial: 'CLIENTE TESTE', tipo: 'PF', pais: 'Brasil', moeda: 'BRL', semEndereco: false,
      endereco: { cep: '55000000', logradouro: 'RUA TESTE', numero: '10', bairro: 'CENTRO', cidade: 'Recife', codigoIbge: '2611606', uf: 'PE' },
    },
    servico: {
      valor: 100, valorLiquido: 100, descricao: 'Preparacao de documentos', cnae: '8219999',
      codigoTributacaoNacional: '170201', codigoTributacaoMunicipal: '501', codigoNbs: '118065300',
      aliquotaAplicada: 6, valorIss: 6, issRetido: false, tipoTributacao: '1',
      retencoes: {
        pis: { retido: false, valor: 0 }, cofins: { retido: false, valor: 0 }, csll: { retido: false, valor: 0 },
        ir: { retido: false, valor: 0 }, inss: { retido: false, valor: 0 },
      },
      ibscbs: { enabled: true, mandatory: false, finNFSe: '0', indFinal: '0', cIndOp: '100301', indDest: '0', cst: '000', cClassTrib: '000001' },
    },
    meta: { ambiente: 'PRODUCAO', serie: '900', numero: 55, dataEmissao: new Date('2026-08-19T12:44:34Z'), dataCompetencia: '2026-08-19', layoutVersion: '1.01' },
  };

  const xml = new NacionalAdapter().toXml(base);
  assert.match(xml, /<opSimpNac>2<\/opSimpNac>/);
  assert.match(xml, /<CPF>12345678909<\/CPF><xNome>CLIENTE TESTE<\/xNome><end>/);
  assert.match(xml, /<endNac><cMun>2611606<\/cMun><CEP>55000000<\/CEP><\/endNac>/);
  assert.match(xml, /<cNBS>118065300<\/cNBS>/);
  assert.doesNotMatch(xml, /<cTribMun>/);
  assert.doesNotMatch(xml, /<pAliq>/);
  assert.doesNotMatch(xml, /<regApTribSN>/);
  assert.doesNotMatch(xml, /<tribFed>/);
  assert.match(xml, /<tpRetISSQN>1<\/tpRetISSQN>/);
  assert.match(xml, /<totTrib><indTotTrib>0<\/indTotTrib><\/totTrib>/);
  assert.match(xml, /<IBSCBS><finNFSe>0<\/finNFSe>/);
  assert.deepEqual(validateDpsXml(xml), []);

  const semEndereco = xml.replace(/<end>[\s\S]*?<\/end>/, '');
  assert.ok(validateDpsXml(semEndereco).some(issue => issue.code === 'TOMADOR_PF_ENDERECO_AUSENTE'));
  assert.throws(() => new NacionalAdapter().toXml({
    ...base,
    tomador: { ...base.tomador, semEndereco: true, endereco: { ...base.tomador.endereco, cep: '', logradouro: '' } },
  }), /Endereco do tomador incompleto/);
});
