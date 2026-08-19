import { prisma } from '@/app/utils/prisma';
import { getFederalRetentionEligibility, getIbsCbsMandatoryDate, getIbsCbsPilotControl, getPisCofinsDueDefaults, isIbsCbsMandatory, meetsFederalRetentionMinimum, roundHalfEven, shouldEnableIbsCbs } from './FiscalMath';
export { getFederalRetentionEligibility, getIbsCbsMandatoryDate, getIbsCbsPilotControl, getPisCofinsDueDefaults, isIbsCbsMandatory, meetsFederalRetentionMinimum, retentionType, roundHalfEven, shouldEnableIbsCbs } from './FiscalMath';

export type FiscalSeverity = 'WARN' | 'ERROR';

export interface FiscalIssue {
  code: string;
  severity: FiscalSeverity;
  message: string;
  userAction?: string;
}

export interface RetentionValue {
  retido: boolean;
  aliquota: number;
  valor: number;
}

export interface FiscalRetentionSet {
  pis: RetentionValue;
  cofins: RetentionValue;
  csll: RetentionValue;
  ir: RetentionValue;
  inss: RetentionValue;
}

export interface FiscalDecision {
  ruleIds: { global?: string; municipal?: string };
  source: string[];
  competence: string;
  layoutVersion: string;
  codigoNbs?: string;
  codigoTributacaoMunicipal?: string;
  exigeNbs: boolean;
  exigeCodigoTributacaoMunicipal: boolean;
  aliquotaIssMunicipal?: number;
  aliquotaTotTribSN: number;
  aliquotaTotTribFederal?: number;
  cstPisCofins: string;
  retencoes: FiscalRetentionSet;
  tributosFederaisDevidos?: {
    cst: string;
    baseCalculo: number;
    pis?: { aliquota: number; valor: number };
    cofins?: { aliquota: number; valor: number };
  };
  ibscbs: {
    enabled: boolean;
    mandatory: boolean;
    mandatoryFrom: string;
    pilot: {
      masterEnabled: boolean;
      regimeEnabled: boolean;
      ruleOverride?: boolean;
      emissionOverride?: boolean;
    };
    finNFSe?: string;
    indFinal?: string;
    cIndOp?: string;
    indDest?: string;
    cst?: string;
    cClassTrib?: string;
  };
  issues: FiscalIssue[];
}

interface ResolveInput {
  cnae: string;
  itemLc?: string;
  codigoIbge: string;
  regimeTributario: string;
  dataCompetencia?: string;
  valor: number;
  codigoNbs?: string;
  codigoTributacaoMunicipal?: string;
  tomadorTipo?: string;
  tomadorPais?: string;
  retencoes?: any;
  tributosFederaisDevidos?: any;
  ibscbs?: any;
}

const onlyDigits = (value: unknown) => String(value || '').replace(/\D/g, '');
const asNumber = (value: unknown, fallback = 0) => {
  const result = Number(value);
  return Number.isFinite(result) ? result : fallback;
};
const asOptionalNumber = (value: unknown) => value === null || value === undefined || value === '' ? undefined : asNumber(value);
const asBoolean = (value: unknown, fallback = false) => {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  return ['1', 'true', 'sim', 's', 'yes'].includes(String(value).trim().toLowerCase());
};

function isRuleInForce(rule: any, competence: Date) {
  if (!rule || rule.ativo === false) return false;
  if (rule.inicioVigencia && new Date(rule.inicioVigencia) > competence) return false;
  if (rule.fimVigencia && new Date(rule.fimVigencia) < competence) return false;
  return true;
}

function normalizeRetention(value: any): RetentionValue {
  const amount = roundHalfEven(asNumber(value?.valor));
  const rate = asNumber(value?.aliquota);
  return { retido: asBoolean(value?.retido, amount > 0) && amount > 0, aliquota: rate, valor: amount };
}

function automaticRetention(rate: number | undefined, base: number): RetentionValue {
  const aliquota = asNumber(rate);
  const valor = roundHalfEven(base * aliquota / 100);
  return { retido: aliquota > 0 && valor > 0, aliquota, valor };
}

function isSpecialOperation(itemLc?: string) {
  const item = String(itemLc || '').replace(/[^\d.]/g, '');
  return /^(6\.|7\.|12\.|16\.|99\.)/.test(item);
}

export async function resolveFiscalDecision(input: ResolveInput): Promise<FiscalDecision> {
  const cnae = onlyDigits(input.cnae);
  const normalizedRegime = String(input.regimeTributario || '').toUpperCase();
  const isMei = normalizedRegime === 'MEI';
  const retentionEligibility = getFederalRetentionEligibility(normalizedRegime, input.tomadorTipo, input.tomadorPais);
  const competenceText = input.dataCompetencia || new Date().toISOString().slice(0, 10);
  const competence = new Date(`${competenceText.slice(0, 10)}T12:00:00.000Z`);
  const [globalCandidate, municipalCandidates, systemConfig] = await Promise.all([
    prisma.globalCnae.findFirst({ where: { codigo: cnae } }),
    prisma.tributacaoMunicipal.findMany({
      where: { codigoIbge: onlyDigits(input.codigoIbge), ativo: true },
      orderBy: [{ prioridade: 'desc' }, { updatedAt: 'desc' }],
    }),
    prisma.configuracaoSistema.findUnique({ where: { id: 'config' } }),
  ]);

  const globalRule = isRuleInForce(globalCandidate, competence) ? globalCandidate : null;
  const municipalRule = municipalCandidates.find((rule: any) => onlyDigits(rule.cnae) === cnae && isRuleInForce(rule, competence));
  const issues: FiscalIssue[] = [];
  const source = [
    globalRule ? `CNAE:${globalRule.id}` : 'CNAE:SEM_REGRA',
    municipalRule ? `MUNICIPIO:${municipalRule.id}` : 'MUNICIPIO:SEM_REGRA',
  ];

  const exigeNbs = municipalRule?.exigeNbs === true;
  const codigoNbs = onlyDigits(input.codigoNbs || municipalRule?.nbsPadrao || globalRule?.codigoNbs) || undefined;
  if (exigeNbs && !codigoNbs) {
    issues.push({
      code: 'NBS_OBRIGATORIO', severity: 'ERROR',
      message: 'A regra municipal exige NBS, mas nenhum codigo foi configurado.',
      userAction: 'Cadastre o NBS no CNAE ou na regra municipal antes de emitir.',
    });
  }
  if (codigoNbs && codigoNbs.length !== 9) {
    issues.push({
      code: 'NBS_INVALIDO', severity: 'ERROR',
      message: 'O codigo NBS deve possuir 9 digitos.',
      userAction: 'Corrija o NBS na regra fiscal antes de emitir.',
    });
  }

  const exigeCodigoTributacaoMunicipal = !isMei && municipalRule?.exigeCodigoTributacaoMunicipal === true;
  const codigoTributacaoMunicipal = isMei
    ? undefined
    : onlyDigits(input.codigoTributacaoMunicipal || municipalRule?.codigoTributacaoMunicipal) || undefined;
  if (isMei) source.push('CTM:DISPENSADO_MEI');
  if (exigeCodigoTributacaoMunicipal && !codigoTributacaoMunicipal) {
    issues.push({
      code: 'CODIGO_MUNICIPAL_OBRIGATORIO', severity: 'ERROR',
      message: 'A regra exige codigo de tributacao municipal, mas ele nao foi resolvido.',
      userAction: 'Complete a regra municipal no painel administrativo.',
    });
  }
  if (codigoTributacaoMunicipal && codigoTributacaoMunicipal.length > 20) {
    issues.push({
      code: 'CODIGO_MUNICIPAL_INVALIDO', severity: 'ERROR',
      message: 'O codigo de tributacao municipal excede o tamanho suportado pelo leiaute.',
      userAction: 'Revise o codigo municipal na pilotagem fiscal.',
    });
  }

  const pisRate = asOptionalNumber(municipalRule?.aliquotaPisRetencao ?? globalRule?.aliquotaPisRetencao)
    ?? (globalRule?.retemCrsf ? 0.65 : 0);
  const cofinsRate = asOptionalNumber(municipalRule?.aliquotaCofinsRetencao ?? globalRule?.aliquotaCofinsRetencao)
    ?? (globalRule?.retemCrsf ? 3 : 0);
  const csllRate = asOptionalNumber(municipalRule?.aliquotaCsllRetencao ?? globalRule?.aliquotaCsllRetencao)
    ?? (globalRule?.retemCrsf ? 1 : 0);
  const irRate = asOptionalNumber(municipalRule?.aliquotaIr ?? globalRule?.aliquotaIr) ?? 0;
  const inssRate = asOptionalNumber(municipalRule?.aliquotaInss ?? globalRule?.aliquotaInss)
    ?? (globalRule?.temRetencaoInss ? 11 : 0);
  const socialMinimum = asOptionalNumber(municipalRule?.valorMinimoRetencaoCrsf ?? globalRule?.valorMinimoRetencaoCrsf) ?? 10.01;
  const irMinimum = asOptionalNumber(municipalRule?.valorMinimoRetencaoIr ?? globalRule?.valorMinimoRetencaoIr) ?? 10.01;
  const retencoes: FiscalRetentionSet = {
    pis: normalizeRetention(input.retencoes?.pis),
    cofins: normalizeRetention(input.retencoes?.cofins),
    csll: normalizeRetention(input.retencoes?.csll),
    ir: normalizeRetention(input.retencoes?.ir),
    inss: normalizeRetention(input.retencoes?.inss),
  };

  const retentionMode = municipalRule?.modoRetencoes && municipalRule.modoRetencoes !== 'HERDAR'
    ? municipalRule.modoRetencoes
    : globalRule?.modoRetencoes || 'SUGERIR';
  if (retentionMode === 'AUTOMATICO') {
    const retemCrsf = municipalRule?.retemCrsf ?? globalRule?.retemCrsf ?? false;
    const retemIr = municipalRule?.retemIr ?? globalRule?.retemIr ?? false;
    const retemInss = municipalRule?.retemInss ?? globalRule?.temRetencaoInss ?? false;
    const socialTotal = roundHalfEven(input.valor * (pisRate + cofinsRate + csllRate) / 100);
    if (retemCrsf && meetsFederalRetentionMinimum(socialTotal, socialMinimum)) {
      if (!input.retencoes?.pis) retencoes.pis = automaticRetention(pisRate, input.valor);
      if (!input.retencoes?.cofins) retencoes.cofins = automaticRetention(cofinsRate, input.valor);
      if (!input.retencoes?.csll) retencoes.csll = automaticRetention(csllRate, input.valor);
    }
    if (retemIr && meetsFederalRetentionMinimum(input.valor * irRate / 100, irMinimum) && !input.retencoes?.ir) retencoes.ir = automaticRetention(irRate, input.valor);
    if (retemInss && !input.retencoes?.inss) retencoes.inss = automaticRetention(inssRate, input.valor);
    source.push('RETENCOES:AUTOMATICO');
  } else {
    source.push('RETENCOES:SUGERIR');
  }

  if (!retentionEligibility.crsfAndIrrf) {
    for (const tax of ['pis', 'cofins', 'csll', 'ir'] as Array<keyof FiscalRetentionSet>) {
      retencoes[tax] = { retido: false, aliquota: 0, valor: 0 };
    }
  }
  if (!retentionEligibility.inss) {
    retencoes.inss = { retido: false, aliquota: 0, valor: 0 };
  }
  const informedSocialTotal = roundHalfEven(retencoes.pis.valor + retencoes.cofins.valor + retencoes.csll.valor);
  if (informedSocialTotal > 0 && !meetsFederalRetentionMinimum(informedSocialTotal, socialMinimum)) {
    for (const tax of ['pis', 'cofins', 'csll'] as Array<keyof FiscalRetentionSet>) {
      retencoes[tax] = { retido: false, aliquota: retencoes[tax].aliquota, valor: 0 };
    }
    source.push('CRSF:ABAIXO_MINIMO');
  }
  if (retencoes.ir.valor > 0 && !meetsFederalRetentionMinimum(retencoes.ir.valor, irMinimum)) {
    retencoes.ir = { retido: false, aliquota: retencoes.ir.aliquota, valor: 0 };
    source.push('IRRF:ABAIXO_MINIMO');
  }
  if (isMei) {
    source.push('RETENCOES:DISPENSADAS_MEI');
  } else if (retentionEligibility.reason === 'PF') {
    source.push('RETENCOES:INAPLICAVEIS_PF');
  } else if (retentionEligibility.reason === 'EXTERIOR') {
    source.push('RETENCOES:INAPLICAVEIS_EXTERIOR');
  } else if (retentionEligibility.reason === 'REGIME_SIMPLES') {
    source.push('CRSF_IRRF:DISPENSADOS_SIMPLES');
  }

  for (const [tax, retention] of Object.entries(retencoes)) {
    if (retention.retido && (retention.aliquota <= 0 || retention.aliquota > 100 || retention.valor <= 0)) {
      issues.push({
        code: `RETENCAO_${tax.toUpperCase()}_INVALIDA`, severity: 'ERROR',
        message: `A retencao de ${tax.toUpperCase()} possui aliquota ou valor invalido.`,
        userAction: 'Revise os valores da retencao antes de transmitir.',
      });
    }
  }

  const federalDueDefaults = getPisCofinsDueDefaults(normalizedRegime);
  const cstPisCofins = onlyDigits(input.tributosFederaisDevidos?.cst || globalRule?.cstPisCofins || federalDueDefaults.cst).padStart(2, '0');
  const defaultCalculateDue = federalDueDefaults.enabled;
  const calculateDue = municipalRule?.calculaPisCofinsDevido ?? globalRule?.calculaPisCofinsDevido ?? defaultCalculateDue;
  let tributosFederaisDevidos: FiscalDecision['tributosFederaisDevidos'];
  if (!isMei && (calculateDue || input.tributosFederaisDevidos)) {
    const base = asNumber(input.tributosFederaisDevidos?.baseCalculo, input.valor);
    const pPis = asOptionalNumber(input.tributosFederaisDevidos?.pis?.aliquota ?? municipalRule?.aliquotaPisDevido ?? globalRule?.aliquotaPisDevido) ?? federalDueDefaults.pis;
    const pCofins = asOptionalNumber(input.tributosFederaisDevidos?.cofins?.aliquota ?? municipalRule?.aliquotaCofinsDevido ?? globalRule?.aliquotaCofinsDevido) ?? federalDueDefaults.cofins;
    tributosFederaisDevidos = {
      cst: cstPisCofins,
      baseCalculo: roundHalfEven(base),
      pis: pPis > 0 ? { aliquota: pPis, valor: roundHalfEven(asNumber(input.tributosFederaisDevidos?.pis?.valor, base * pPis / 100)) } : undefined,
      cofins: pCofins > 0 ? { aliquota: pCofins, valor: roundHalfEven(asNumber(input.tributosFederaisDevidos?.cofins?.valor, base * pCofins / 100)) } : undefined,
    };
    if (!tributosFederaisDevidos.pis && !tributosFederaisDevidos.cofins) {
      issues.push({
        code: 'PISCOFINS_DEVIDO_SEM_ALIQUOTA', severity: 'ERROR',
        message: 'A regra determina PIS/COFINS de apuracao propria, mas nao possui aliquotas.',
        userAction: 'Configure as aliquotas devidas na regra do CNAE ou do municipio.',
      });
    }
    if (base <= 0 || pPis < 0 || pPis > 100 || pCofins < 0 || pCofins > 100) {
      issues.push({
        code: 'PISCOFINS_DEVIDO_INVALIDO', severity: 'ERROR',
        message: 'Base de calculo ou aliquotas de PIS/COFINS devidos sao invalidas.',
        userAction: 'Revise a base e os percentuais da apuracao propria antes de emitir.',
      });
    }
    source.push(defaultCalculateDue && municipalRule?.calculaPisCofinsDevido == null && globalRule?.calculaPisCofinsDevido == null
      ? 'PISCOFINS_DEVIDO:PADRAO_LUCRO_PRESUMIDO'
      : 'PISCOFINS_DEVIDO:REGRA_PILOTADA');
  }
  if (cstPisCofins.length !== 2) {
    issues.push({
      code: 'CST_PISCOFINS_INVALIDO', severity: 'ERROR',
      message: 'O CST de PIS/COFINS deve possuir 2 digitos.',
      userAction: 'Corrija o CST na regra nacional do CNAE.',
    });
  }

  const mandatoryDate = municipalRule?.inicioObrigatoriedadeIbsCbs ?? globalRule?.inicioObrigatoriedadeIbsCbs;
  const mandatoryFrom = getIbsCbsMandatoryDate(input.regimeTributario, input.itemLc, mandatoryDate);
  const mandatory = isIbsCbsMandatory(input.regimeTributario, competenceText, input.itemLc, mandatoryDate);
  const pilot = getIbsCbsPilotControl(normalizedRegime, systemConfig);
  const ruleOverride = municipalRule?.habilitaIbsCbs ?? globalRule?.habilitaIbsCbs ?? undefined;
  const emissionOverride = input.ibscbs?.enabled === undefined || input.ibscbs?.enabled === null || input.ibscbs?.enabled === ''
    ? undefined
    : asBoolean(input.ibscbs.enabled);
  const ruleEnabled = emissionOverride ?? ruleOverride ?? true;
  const reformPeriod = competenceText.slice(0, 10) >= '2026-01-01';
  const enabled = shouldEnableIbsCbs({
    mandatory,
    competence: competenceText,
    pilotEnabled: pilot.enabled,
    ruleEnabled,
  });
  if (mandatory) source.push(`IBSCBS:OBRIGATORIO_DESDE_${mandatoryFrom}`);
  else if (!reformPeriod) source.push('IBSCBS:FORA_DO_PERIODO_DA_REFORMA');
  else if (!pilot.masterEnabled) source.push('IBSCBS:PILOTO_GLOBAL_DESLIGADO');
  else if (!pilot.regimeEnabled) source.push(`IBSCBS:REGIME_${normalizedRegime || 'NAO_INFORMADO'}_DESLIGADO`);
  else if (!ruleEnabled) source.push(emissionOverride === false ? 'IBSCBS:EMISSAO_DESLIGADA' : 'IBSCBS:EXCECAO_DA_REGRA_DESLIGADA');
  else source.push('IBSCBS:TRANSICAO_HABILITADA');
  const cIndOp = onlyDigits(input.ibscbs?.cIndOp || municipalRule?.codigoIndicadorOperacao || globalRule?.codigoIndicadorOperacao)
    || (!isSpecialOperation(input.itemLc) ? '100301' : undefined);
  const cst = onlyDigits(input.ibscbs?.cst || municipalRule?.cstIbsCbs || globalRule?.cstIbsCbs)
    || (!isSpecialOperation(input.itemLc) ? '000' : undefined);
  const cClassTrib = onlyDigits(input.ibscbs?.cClassTrib || municipalRule?.classeTribIbsCbs || globalRule?.classeTribIbsCbs)
    || (!isSpecialOperation(input.itemLc) ? '000001' : undefined);

  if (enabled && (!cIndOp || !cst || !cClassTrib)) {
    issues.push({
      code: 'IBSCBS_CLASSIFICACAO_PENDENTE', severity: 'ERROR',
      message: 'A operacao exige classificacao IBS/CBS especifica e nao pode usar o padrao geral.',
      userAction: 'Configure cIndOp, CST e cClassTrib para este CNAE/municipio no painel administrativo.',
    });
  }
  if (enabled && cst && cClassTrib && cClassTrib.slice(0, 3) !== cst) {
    issues.push({
      code: 'IBSCBS_CLASSE_INCOMPATIVEL', severity: 'ERROR',
      message: 'Os tres primeiros digitos de cClassTrib devem corresponder ao CST do IBS/CBS.',
      userAction: 'Corrija a classificacao IBS/CBS na pilotagem fiscal.',
    });
  }
  const finNFSe = enabled ? String(input.ibscbs?.finNFSe ?? municipalRule?.finNfsePadrao ?? '0') : undefined;
  if (enabled && finNFSe !== '0') {
    issues.push({
      code: 'IBSCBS_FINALIDADE_NAO_SUPORTADA', severity: 'ERROR',
      message: 'O leiaute de producao 1.01 vigente aceita somente NFS-e regular (finNFSe=0).',
      userAction: 'Use finalidade regular ate a Receita disponibilizar o leiaute da NT 009 nos ambientes oficiais.',
    });
  }

  if (!municipalRule) {
    issues.push({
      code: 'REGRA_MUNICIPAL_AUSENTE', severity: 'WARN',
      message: 'Nao ha regra municipal vigente para o CNAE e municipio da emissao.',
      userAction: 'Homologue o municipio e cadastre a regra antes da liberacao em producao.',
    });
  }

  return {
    ruleIds: { global: globalRule?.id, municipal: municipalRule?.id },
    source,
    competence: competenceText.slice(0, 10),
    layoutVersion: municipalRule?.versaoLayout || '1.01',
    codigoNbs,
    codigoTributacaoMunicipal,
    exigeNbs,
    exigeCodigoTributacaoMunicipal,
    aliquotaIssMunicipal: isMei ? undefined : asOptionalNumber(municipalRule?.aliquotaIss),
    aliquotaTotTribSN: asOptionalNumber(globalRule?.aliquotaTotTribSN) ?? 6,
    aliquotaTotTribFederal: asOptionalNumber(globalRule?.aliquotaTotTribFederal)
      ?? (globalRule?.retemCrsf ? asOptionalNumber(globalRule?.aliquotaCrsf) : undefined),
    cstPisCofins,
    retencoes,
    tributosFederaisDevidos,
    ibscbs: {
      enabled,
      mandatory,
      mandatoryFrom,
      pilot: {
        masterEnabled: pilot.masterEnabled,
        regimeEnabled: pilot.regimeEnabled,
        ruleOverride,
        emissionOverride,
      },
      finNFSe,
      indFinal: enabled ? String(input.ibscbs?.indFinal ?? municipalRule?.indFinalPadrao ?? '0') : undefined,
      cIndOp: enabled ? cIndOp : undefined,
      indDest: enabled ? String(input.ibscbs?.indDest ?? municipalRule?.indDestPadrao ?? '0') : undefined,
      cst: enabled ? cst : undefined,
      cClassTrib: enabled ? cClassTrib : undefined,
    },
    issues,
  };
}

export function assertFiscalDecision(decision: FiscalDecision) {
  const errors = decision.issues.filter((issue) => issue.severity === 'ERROR');
  if (!errors.length) return;
  const error = Object.assign(new Error(errors.map((item) => item.message).join(' ')), {
    status: 400,
    code: errors[0].code,
    userAction: errors[0].userAction,
    fiscalIssues: errors,
  });
  throw error;
}
