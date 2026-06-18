import { prisma } from '@/app/utils/prisma';
import { getTributacaoPorCnae } from '@/app/utils/tributacao';
import { NacionalAdapter } from '@/app/services/emissor/adapters/NacionalAdapter';
import { MeiHandler } from '@/app/services/emissor/handlers/MeiHandler';
import { SimplesNacionalHandler } from '@/app/services/emissor/handlers/SimplesNacionalHandler';
import { ICanonicalRps } from '@/app/services/emissor/interfaces/ICanonicalRps';
import { stripEmpresaSecrets } from '@/app/utils/safe-data';
import { isPercentualFiscalValido, parseDecimalInput } from '@/app/utils/number-format';

type CheckStatus = 'ok' | 'warn' | 'error' | 'info';

interface CheckItem {
  id: string;
  label: string;
  status: CheckStatus;
  message: string;
  tag?: string;
  field?: string;
  group?: string;
}

interface InspectorOverrides {
  descricao?: string;
  valor?: number | string;
  cnae?: string;
  codigoCnae?: string;
  numeroDPS?: number | string;
  serieDPS?: string;
  dataCompetencia?: string;
  aliquota?: number | string;
  aliquotaMunicipio?: number | string;
  issRetido?: boolean | string;
  retencoes?: any;
  valorMoedaEstrangeira?: number | string;
  codigoTributacaoNacional?: string;
  codigoTribNacional?: string;
  codigoTributacaoMunicipal?: string;
  codigoNbs?: string;
  itemLc?: string;
  tipoTributacao?: string;
  inscricaoMunicipalPrestador?: string;
  regimeEspecialTributacao?: string;
  localPrestacaoIbge?: string;
  tomadorDocumento?: string;
  tomadorNome?: string;
  tomadorInscricaoMunicipal?: string;
  tomadorEmail?: string;
  tomadorTelefone?: string;
  tomadorTipo?: string;
  tomadorNif?: string;
  tomadorPais?: string;
  tomadorMoeda?: string;
  tomadorSemEndereco?: boolean | string;
  tomadorCep?: string;
  tomadorLogradouro?: string;
  tomadorNumero?: string;
  tomadorComplemento?: string;
  tomadorBairro?: string;
  tomadorCidade?: string;
  tomadorUf?: string;
  tomadorCodigoIbge?: string;
}

function onlyDigits(value?: string | null) {
  return String(value || '').replace(/\D/g, '');
}

function firstDefined(...values: any[]) {
  return values.find((value) => value !== undefined && value !== null && value !== '');
}

function asText(value: any, fallback = '') {
  const resolved = firstDefined(value, fallback);
  return resolved === undefined || resolved === null ? '' : String(resolved);
}

function optionalText(value: any) {
  const text = asText(value).trim();
  return text ? text : undefined;
}

function asNumber(value: any, fallback = 0) {
  return parseDecimalInput(value, fallback);
}

function asBoolean(value: any, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'sim', 's', 'yes'].includes(normalized)) return true;
  if (['false', '0', 'nao', 'não', 'n', 'no'].includes(normalized)) return false;
  return fallback;
}

function addCheck(checks: CheckItem[], item: CheckItem) {
  checks.push(item);
}

function statusResumo(checks: CheckItem[]) {
  if (checks.some((check) => check.status === 'error')) return 'BLOQUEADO';
  if (checks.some((check) => check.status === 'warn')) return 'COM_ALERTAS';
  return 'APTO';
}

function stripForPayload(value: any): any {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(stripForPayload);

  const unsafe = new Set(['certificadoA1', 'senhaCertificado']);
  const output: any = {};
  for (const key of Object.keys(value)) {
    output[key] = unsafe.has(key) ? undefined : stripForPayload(value[key]);
  }
  return output;
}

export async function inspecionarEmissaoVenda(vendaId: string, overrides: InspectorOverrides = {}) {
  const venda = await prisma.venda.findUnique({
    where: { id: vendaId },
    include: {
      empresa: true,
      cliente: true,
      notas: { orderBy: { createdAt: 'desc' }, take: 1 },
      logs: { orderBy: { createdAt: 'desc' }, take: 10 },
    },
  });

  if (!venda) {
    throw new Error('Venda nao encontrada.');
  }

  const checks: CheckItem[] = [];
  const prestador = venda.empresa;
  const tomador = venda.cliente;
  const notaAtual = venda.notas?.[0];

  const cnaePrincipal = await prisma.cnae.findFirst({
    where: { empresaId: prestador.id, principal: true },
  });

  const cnaeFinal = onlyDigits(String(firstDefined(overrides.codigoCnae, overrides.cnae, notaAtual?.cnae, cnaePrincipal?.codigo, '')));
  const valorFinal = asNumber(overrides.valor, Number(venda.valor));
  const descricaoFinal = String(overrides.descricao ?? venda.descricao ?? '').trim();
  const serieFinal = String(firstDefined(overrides.serieDPS, prestador.serieDPS, '900'));
  const numeroDPSFinal = firstDefined(overrides.numeroDPS) ? asNumber(overrides.numeroDPS) : (prestador.ultimoDPS || 0) + 1;
  const prestadorInscricaoMunicipal = optionalText(firstDefined(overrides.inscricaoMunicipalPrestador, prestador.inscricaoMunicipal));
  const prestadorRegimeEspecial = optionalText(firstDefined(overrides.regimeEspecialTributacao, prestador.regimeEspecialTributacao));
  const tipoTributacaoFinal = asText(firstDefined(overrides.tipoTributacao, prestador.tipoTributacaoPadrao, '1'), '1');

  const tomadorTipo = asText(firstDefined(overrides.tomadorTipo, tomador.tipo), tomador.tipo || '');
  const tomadorPais = asText(firstDefined(overrides.tomadorPais, tomador.pais), tomador.pais || '');
  const tomadorSemEndereco = asBoolean(overrides.tomadorSemEndereco, (tomador as any).semEndereco === true);
  const isExterior = tomadorTipo === 'EXT' || (tomadorPais && tomadorPais !== 'Brasil' && tomadorPais !== 'BR');
  const omitirEnderecoTomador = tomadorTipo === 'PF' && tomadorSemEndereco === true;
  const tomadorDocumento = asText(firstDefined(overrides.tomadorDocumento, tomador.documento), tomador.documento || '');
  const tomadorNome = asText(firstDefined(overrides.tomadorNome, tomador.nome), tomador.nome || '');
  const tomadorCodigoIbge = omitirEnderecoTomador ? '' : asText(firstDefined(overrides.tomadorCodigoIbge, tomador.codigoIbge, '9999999'), '9999999');

  addCheck(checks, {
    id: 'prestador-cnpj',
    group: 'Prestador',
    label: 'CNPJ do prestador',
    status: onlyDigits(prestador.documento).length === 14 ? 'ok' : 'error',
    message: onlyDigits(prestador.documento).length === 14 ? 'CNPJ do prestador informado.' : 'CNPJ do prestador ausente ou invalido.',
    tag: 'prest/CNPJ',
    field: 'empresa.documento',
  });

  addCheck(checks, {
    id: 'prestador-ibge',
    group: 'Prestador',
    label: 'Codigo IBGE do prestador',
    status: onlyDigits(prestador.codigoIbge).length >= 7 ? 'ok' : 'error',
    message: onlyDigits(prestador.codigoIbge).length >= 7 ? `IBGE ${prestador.codigoIbge}.` : 'Codigo IBGE do prestador e obrigatorio.',
    tag: 'cLocEmi / locPrest/cLocPrestacao',
    field: 'empresa.codigoIbge',
  });

  addCheck(checks, {
    id: 'prestador-im',
    group: 'Prestador',
    label: 'Inscricao Municipal',
    status: prestadorInscricaoMunicipal ? 'ok' : 'warn',
    message: prestadorInscricaoMunicipal ? 'Inscricao Municipal informada.' : 'Sem Inscricao Municipal. Alguns municipios rejeitam a DPS.',
    tag: 'prest/IM',
    field: 'empresa.inscricaoMunicipal',
  });

  addCheck(checks, {
    id: 'certificado',
    group: 'Prestador',
    label: 'Certificado A1',
    status: prestador.certificadoA1 ? 'ok' : 'error',
    message: prestador.certificadoA1 ? 'Certificado configurado.' : 'Certificado A1 ausente.',
    field: 'empresa.certificadoA1',
  });

  if (prestador.certificadoVencimento) {
    const vencido = new Date(prestador.certificadoVencimento) < new Date();
    addCheck(checks, {
      id: 'certificado-validade',
      group: 'Prestador',
      label: 'Validade do certificado',
      status: vencido ? 'error' : 'ok',
      message: vencido ? 'Certificado vencido.' : `Certificado valido ate ${new Date(prestador.certificadoVencimento).toLocaleDateString('pt-BR')}.`,
      field: 'empresa.certificadoVencimento',
    });
  }

  addCheck(checks, {
    id: 'tomador-documento',
    group: 'Tomador',
    label: 'Documento do tomador',
    status: isExterior || onlyDigits(tomadorDocumento).length === 11 || onlyDigits(tomadorDocumento).length === 14 ? 'ok' : 'error',
    message: isExterior ? 'Tomador exterior identificado.' : 'CPF/CNPJ nacional validado para montagem do XML.',
    tag: 'toma/CPF ou toma/CNPJ',
    field: 'cliente.documento',
  });

  addCheck(checks, {
    id: 'tomador-nome',
    group: 'Tomador',
    label: 'Nome/Razao social do tomador',
    status: tomadorNome ? 'ok' : 'error',
    message: tomadorNome ? 'Nome do tomador informado.' : 'Nome/Razao social do tomador e obrigatorio.',
    tag: 'toma/xNome',
    field: 'cliente.nome',
  });

  if (!isExterior && !omitirEnderecoTomador) {
    addCheck(checks, {
      id: 'tomador-ibge',
      group: 'Tomador',
      label: 'Codigo IBGE do tomador',
      status: onlyDigits(tomadorCodigoIbge).length >= 7 ? 'ok' : 'warn',
      message: onlyDigits(tomadorCodigoIbge).length >= 7 ? `IBGE ${tomadorCodigoIbge}.` : 'Sem IBGE do tomador. O sistema usara fallback se a emissao permitir.',
      tag: 'toma/end/endNac/cMun',
      field: 'cliente.codigoIbge',
    });
  } else if (omitirEnderecoTomador) {
    addCheck(checks, {
      id: 'tomador-sem-endereco',
      group: 'Tomador',
      label: 'Endereco do tomador',
      status: 'ok',
      message: 'PF marcada para emissao sem endereco; o bloco toma/end sera omitido.',
      tag: 'toma',
      field: 'cliente.semEndereco',
    });
  }

  addCheck(checks, {
    id: 'servico-valor',
    group: 'Servico',
    label: 'Valor do servico',
    status: valorFinal > 0 ? 'ok' : 'error',
    message: valorFinal > 0 ? `Valor R$ ${valorFinal.toFixed(2)}.` : 'Valor deve ser maior que zero.',
    tag: 'valores/vServPrest/vServ',
    field: 'venda.valor',
  });

  addCheck(checks, {
    id: 'servico-descricao',
    group: 'Servico',
    label: 'Descricao do servico',
    status: descricaoFinal ? 'ok' : 'error',
    message: descricaoFinal ? 'Descricao preenchida.' : 'Descricao do servico e obrigatoria.',
    tag: 'serv/cServ/xDescServ',
    field: 'venda.descricao',
  });

  addCheck(checks, {
    id: 'servico-cnae',
    group: 'Servico',
    label: 'CNAE',
    status: cnaeFinal ? 'ok' : 'error',
    message: cnaeFinal ? `CNAE ${cnaeFinal}.` : 'CNAE e obrigatorio para resolver a tributacao.',
    field: 'servico.cnae',
  });

  const infoEstatica = getTributacaoPorCnae(cnaeFinal);
  const regraGlobal = cnaeFinal ? await prisma.globalCnae.findUnique({ where: { codigo: cnaeFinal } }) : null;
  const regraMunicipal = cnaeFinal
    ? await prisma.tributacaoMunicipal.findFirst({
        where: { cnae: cnaeFinal, codigoIbge: prestador.codigoIbge || '' },
      })
    : null;

  const itemLc = asText(firstDefined(overrides.itemLc, regraGlobal?.itemLc, infoEstatica.itemLC), infoEstatica.itemLC);
  const codigoTribNacional = onlyDigits(asText(firstDefined(
    overrides.codigoTributacaoNacional,
    overrides.codigoTribNacional,
    regraGlobal?.codigoTributacaoNacional,
    infoEstatica.codigoTributacaoNacional,
  )));
  const codigoTributacaoMunicipal = optionalText(firstDefined(overrides.codigoTributacaoMunicipal, regraMunicipal?.codigoTributacaoMunicipal));
  const codigoNbsResolvido = regraMunicipal?.exigeNbs ? (regraGlobal as any)?.codigoNbs || cnaePrincipal?.codigoNbs || '' : '';
  const codigoNbs = optionalText(firstDefined(overrides.codigoNbs, codigoNbsResolvido));
  const aliquotaMunicipio = firstDefined(overrides.aliquotaMunicipio, regraMunicipal?.aliquotaIss);
  const aliquotaIss = (overrides.aliquota !== undefined ? asNumber(overrides.aliquota) : 0) || asNumber(prestador.aliquotaPadrao);
  const aliquotaMunicipioNumero = aliquotaMunicipio ? asNumber(aliquotaMunicipio) : null;

  addCheck(checks, {
    id: 'tributacao-nacional',
    group: 'Tributacao',
    label: 'Codigo tributacao nacional',
    status: codigoTribNacional ? 'ok' : 'error',
    message: codigoTribNacional ? `cTribNac ${codigoTribNacional}.` : 'Codigo de tributacao nacional nao resolvido.',
    tag: 'serv/cServ/cTribNac',
    field: 'servico.codigoTributacaoNacional',
  });

  addCheck(checks, {
    id: 'tributacao-municipal',
    group: 'Tributacao',
    label: 'Regra municipal',
    status: regraMunicipal || codigoTributacaoMunicipal ? 'ok' : 'warn',
    message: regraMunicipal || codigoTributacaoMunicipal ? `cTribMun ${codigoTributacaoMunicipal || 'nao informado pela regra'}.` : 'Sem regra municipal especifica. Sera usado apenas o mapeamento nacional/local padrao.',
    tag: 'serv/cServ/cTribMun',
    field: 'tributacaoMunicipal.codigoTributacaoMunicipal',
  });

  if (regraMunicipal?.exigeNbs || codigoNbs) {
    addCheck(checks, {
      id: 'tributacao-nbs',
      group: 'Tributacao',
      label: 'Codigo NBS',
      status: codigoNbs ? 'ok' : 'error',
      message: codigoNbs ? `NBS ${codigoNbs}.` : 'Municipio exige NBS, mas nenhum codigo foi resolvido.',
      tag: 'serv/cServ/cNBS',
      field: 'servico.codigoNbs',
    });
  }

  addCheck(checks, {
    id: 'tributacao-aliquota-iss',
    group: 'Tributacao',
    label: 'Aliquota ISS',
    status: isPercentualFiscalValido(aliquotaIss, { allowZero: true }) ? 'ok' : 'error',
    message: isPercentualFiscalValido(aliquotaIss, { allowZero: true })
      ? `Aliquota ISS ${aliquotaIss.toFixed(2)}%.`
      : 'Aliquota ISS invalida. Use percentual entre 0 e 100, como 2,01 ou 2.01.',
    tag: 'trib/tribMun/pAliq',
    field: 'servico.aliquota',
  });

  if (aliquotaMunicipioNumero !== null) {
    addCheck(checks, {
      id: 'tributacao-aliquota-municipal',
      group: 'Tributacao',
      label: 'Aliquota municipal',
      status: isPercentualFiscalValido(aliquotaMunicipioNumero, { allowZero: true }) ? 'ok' : 'error',
      message: isPercentualFiscalValido(aliquotaMunicipioNumero, { allowZero: true })
        ? `Aliquota municipal ${aliquotaMunicipioNumero.toFixed(2)}%.`
        : 'Aliquota municipal invalida. Use percentual entre 0 e 100.',
      tag: 'totTrib/pTotTribMun',
      field: 'servico.aliquotaMunicipio',
    });
  }

  addCheck(checks, {
    id: 'dps-numero',
    group: 'DPS',
    label: 'Numero DPS',
    status: numeroDPSFinal > 0 ? 'ok' : 'error',
    message: numeroDPSFinal > 0 ? `DPS ${numeroDPSFinal}, serie ${serieFinal}.` : 'Numero da DPS invalido.',
    tag: 'nDPS / serie',
    field: 'meta.numeroDPS',
  });

  const tomadorAdaptado: ICanonicalRps['tomador'] = {
    razaoSocial: tomadorNome,
    documento: tomadorDocumento || '',
    inscricaoMunicipal: optionalText(firstDefined(overrides.tomadorInscricaoMunicipal, tomador.inscricaoMunicipal)),
    email: optionalText(firstDefined(overrides.tomadorEmail, tomador.email)),
    telefone: optionalText(firstDefined(overrides.tomadorTelefone, tomador.telefone)),
    tipo: optionalText(tomadorTipo),
    nif: optionalText(firstDefined(overrides.tomadorNif, tomador.nif)),
    pais: optionalText(tomadorPais),
    moeda: optionalText(firstDefined(overrides.tomadorMoeda, tomador.moeda)),
    semEndereco: omitirEnderecoTomador,
    endereco: {
      cep: omitirEnderecoTomador ? '' : asText(firstDefined(overrides.tomadorCep, tomador.cep), ''),
      logradouro: omitirEnderecoTomador ? '' : asText(firstDefined(overrides.tomadorLogradouro, tomador.logradouro), ''),
      numero: omitirEnderecoTomador ? '' : asText(firstDefined(overrides.tomadorNumero, tomador.numero), ''),
      complemento: optionalText(firstDefined(overrides.tomadorComplemento, tomador.complemento)),
      bairro: omitirEnderecoTomador ? '' : asText(firstDefined(overrides.tomadorBairro, tomador.bairro), ''),
      cidade: omitirEnderecoTomador ? '' : asText(firstDefined(overrides.tomadorCidade, tomador.cidade), ''),
      codigoIbge: tomadorCodigoIbge,
      uf: omitirEnderecoTomador ? '' : asText(firstDefined(overrides.tomadorUf, tomador.uf), ''),
    },
  };

  const servico = {
    valor: valorFinal,
    valorMoedaEstrangeira: firstDefined(overrides.valorMoedaEstrangeira) ? asNumber(overrides.valorMoedaEstrangeira) : undefined,
    codigoNbs,
    codigoTributacaoMunicipal,
    aliquotaMunicipio: aliquotaMunicipioNumero,
    descricao: descricaoFinal,
    cnae: cnaeFinal,
    itemLc,
    itemListaServico: itemLc,
    codigoTribNacional,
    codigoTributacaoNacional: codigoTribNacional,
    aliquota: aliquotaIss,
    issRetido: asBoolean(overrides.issRetido, false),
    tipoTributacao: tipoTributacaoFinal,
    retencoes: overrides.retencoes,
  };

  const handler = String(prestador.regimeTributario).toUpperCase() === 'MEI'
    ? new MeiHandler()
    : new SimplesNacionalHandler();
  const dadosTributarios = await handler.getDadosTributarios(servico, prestador);

  const rps: ICanonicalRps = {
    prestador: {
      id: prestador.id,
      documento: prestador.documento,
      inscricaoMunicipal: prestadorInscricaoMunicipal,
      regimeTributario: prestador.regimeTributario as any,
      endereco: {
        codigoIbge: asText(firstDefined(overrides.localPrestacaoIbge, prestador.codigoIbge), ''),
        uf: prestador.uf || '',
      },
      configuracoes: {
        aliquotaPadrao: Number(prestador.aliquotaPadrao),
        issRetido: servico.issRetido,
        tipoTributacao: tipoTributacaoFinal,
        regimeEspecial: prestadorRegimeEspecial,
      },
    },
    tomador: tomadorAdaptado,
    servico: {
      ...dadosTributarios,
      ...servico,
    } as ICanonicalRps['servico'],
    meta: {
      ambiente: prestador.ambiente as 'HOMOLOGACAO' | 'PRODUCAO',
      serie: serieFinal,
      numero: numeroDPSFinal,
      dataEmissao: new Date(),
      dataCompetencia: overrides.dataCompetencia,
    },
  };

  let xmlPreview: string | null = null;
  try {
    xmlPreview = new NacionalAdapter().toXml(rps);
  } catch (error: any) {
    addCheck(checks, {
      id: 'xml-preview',
      group: 'XML',
      label: 'Geracao da previa XML',
      status: 'error',
      message: error.message || 'Nao foi possivel gerar a previa do XML.',
    });
  }

  return {
    venda: {
      id: venda.id,
      status: venda.status,
      valor: Number(venda.valor),
      descricao: venda.descricao,
    },
    empresa: stripEmpresaSecrets(prestador),
    cliente: tomador,
    resumo: {
      status: statusResumo(checks),
      erros: checks.filter((check) => check.status === 'error').length,
      alertas: checks.filter((check) => check.status === 'warn').length,
      oks: checks.filter((check) => check.status === 'ok').length,
    },
    checks,
    payloadCanonico: stripForPayload(rps),
    xmlPreview,
    regras: {
      cnae: cnaeFinal,
      itemLc,
      codigoTributacaoNacional: codigoTribNacional,
      codigoTributacaoMunicipal: codigoTributacaoMunicipal || null,
      exigeNbs: !!regraMunicipal?.exigeNbs,
      codigoNbs: codigoNbs || null,
      ambiente: prestador.ambiente,
      serieDPS: serieFinal,
      numeroDPS: numeroDPSFinal,
    },
  };
}
