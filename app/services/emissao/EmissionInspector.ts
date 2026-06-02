import { prisma } from '@/app/utils/prisma';
import { getTributacaoPorCnae } from '@/app/utils/tributacao';
import { NacionalAdapter } from '@/app/services/emissor/adapters/NacionalAdapter';
import { MeiHandler } from '@/app/services/emissor/handlers/MeiHandler';
import { SimplesNacionalHandler } from '@/app/services/emissor/handlers/SimplesNacionalHandler';
import { ICanonicalRps } from '@/app/services/emissor/interfaces/ICanonicalRps';
import { stripEmpresaSecrets } from '@/app/utils/safe-data';

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
  numeroDPS?: number | string;
  serieDPS?: string;
  dataCompetencia?: string;
  aliquota?: number | string;
  issRetido?: boolean;
  retencoes?: any;
}

function onlyDigits(value?: string | null) {
  return String(value || '').replace(/\D/g, '');
}

function asNumber(value: any, fallback = 0) {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
  const parsed = Number(String(value).replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : fallback;
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

  const cnaeFinal = onlyDigits(String(overrides.cnae || notaAtual?.cnae || cnaePrincipal?.codigo || ''));
  const valorFinal = asNumber(overrides.valor, Number(venda.valor));
  const descricaoFinal = String(overrides.descricao ?? venda.descricao ?? '').trim();
  const serieFinal = String(overrides.serieDPS || prestador.serieDPS || '900');
  const numeroDPSFinal = overrides.numeroDPS ? asNumber(overrides.numeroDPS) : (prestador.ultimoDPS || 0) + 1;

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
    status: prestador.inscricaoMunicipal ? 'ok' : 'warn',
    message: prestador.inscricaoMunicipal ? 'Inscricao Municipal informada.' : 'Sem Inscricao Municipal. Alguns municipios rejeitam a DPS.',
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

  const isExterior = tomador.tipo === 'EXT' || (tomador.pais && tomador.pais !== 'Brasil' && tomador.pais !== 'BR');
  const omitirEnderecoTomador = tomador.tipo === 'PF' && (tomador as any).semEndereco === true;
  addCheck(checks, {
    id: 'tomador-documento',
    group: 'Tomador',
    label: 'Documento do tomador',
    status: isExterior || onlyDigits(tomador.documento).length === 11 || onlyDigits(tomador.documento).length === 14 ? 'ok' : 'error',
    message: isExterior ? 'Tomador exterior identificado.' : 'CPF/CNPJ nacional validado para montagem do XML.',
    tag: 'toma/CPF ou toma/CNPJ',
    field: 'cliente.documento',
  });

  addCheck(checks, {
    id: 'tomador-nome',
    group: 'Tomador',
    label: 'Nome/Razao social do tomador',
    status: tomador.nome ? 'ok' : 'error',
    message: tomador.nome ? 'Nome do tomador informado.' : 'Nome/Razao social do tomador e obrigatorio.',
    tag: 'toma/xNome',
    field: 'cliente.nome',
  });

  if (!isExterior && !omitirEnderecoTomador) {
    addCheck(checks, {
      id: 'tomador-ibge',
      group: 'Tomador',
      label: 'Codigo IBGE do tomador',
      status: onlyDigits(tomador.codigoIbge).length >= 7 ? 'ok' : 'warn',
      message: onlyDigits(tomador.codigoIbge).length >= 7 ? `IBGE ${tomador.codigoIbge}.` : 'Sem IBGE do tomador. O sistema usara fallback se a emissao permitir.',
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

  const itemLc = regraGlobal?.itemLc || infoEstatica.itemLC;
  const codigoTribNacional = onlyDigits(regraGlobal?.codigoTributacaoNacional || infoEstatica.codigoTributacaoNacional);
  const codigoNbs = regraMunicipal?.exigeNbs ? (regraGlobal as any)?.codigoNbs || cnaePrincipal?.codigoNbs || '' : '';

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
    status: regraMunicipal ? 'ok' : 'warn',
    message: regraMunicipal ? `Regra municipal encontrada: ${regraMunicipal.codigoTributacaoMunicipal || 'sem codigo municipal'}.` : 'Sem regra municipal especifica. Sera usado apenas o mapeamento nacional/local padrao.',
    tag: 'serv/cServ/cTribMun',
    field: 'tributacaoMunicipal.codigoTributacaoMunicipal',
  });

  if (regraMunicipal?.exigeNbs) {
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
    id: 'dps-numero',
    group: 'DPS',
    label: 'Numero DPS',
    status: numeroDPSFinal > 0 ? 'ok' : 'error',
    message: numeroDPSFinal > 0 ? `DPS ${numeroDPSFinal}, serie ${serieFinal}.` : 'Numero da DPS invalido.',
    tag: 'nDPS / serie',
    field: 'meta.numeroDPS',
  });

  const tomadorAdaptado: ICanonicalRps['tomador'] = {
    razaoSocial: tomador.nome,
    documento: tomador.documento || '',
    inscricaoMunicipal: tomador.inscricaoMunicipal ? String(tomador.inscricaoMunicipal) : undefined,
    email: tomador.email || undefined,
    telefone: tomador.telefone || undefined,
    tipo: tomador.tipo || undefined,
    nif: tomador.nif || undefined,
    pais: tomador.pais || undefined,
    moeda: tomador.moeda || undefined,
    semEndereco: omitirEnderecoTomador,
    endereco: {
      cep: omitirEnderecoTomador ? '' : tomador.cep || '',
      logradouro: omitirEnderecoTomador ? '' : tomador.logradouro || '',
      numero: omitirEnderecoTomador ? '' : tomador.numero || '',
      complemento: tomador.complemento || undefined,
      bairro: omitirEnderecoTomador ? '' : tomador.bairro || '',
      cidade: omitirEnderecoTomador ? '' : tomador.cidade || '',
      codigoIbge: omitirEnderecoTomador ? '' : tomador.codigoIbge || '9999999',
      uf: omitirEnderecoTomador ? '' : tomador.uf || '',
    },
  };

  const servico = {
    valor: valorFinal,
    codigoNbs,
    codigoTributacaoMunicipal: regraMunicipal?.codigoTributacaoMunicipal,
    aliquotaMunicipio: regraMunicipal?.aliquotaIss ? Number(regraMunicipal.aliquotaIss) : null,
    descricao: descricaoFinal,
    cnae: cnaeFinal,
    itemLc,
    codigoTribNacional,
    aliquota: overrides.aliquota !== undefined ? asNumber(overrides.aliquota) : 0,
    issRetido: !!overrides.issRetido,
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
      inscricaoMunicipal: prestador.inscricaoMunicipal || undefined,
      regimeTributario: prestador.regimeTributario as any,
      endereco: {
        codigoIbge: prestador.codigoIbge || '',
        uf: prestador.uf || '',
      },
      configuracoes: {
        aliquotaPadrao: Number(prestador.aliquotaPadrao),
        issRetido: (dadosTributarios as any).issRetido,
        tipoTributacao: prestador.tipoTributacaoPadrao || undefined,
        regimeEspecial: prestador.regimeEspecialTributacao || undefined,
      },
    },
    tomador: tomadorAdaptado,
    servico: {
      ...servico,
      ...dadosTributarios,
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
      codigoTributacaoMunicipal: regraMunicipal?.codigoTributacaoMunicipal || null,
      exigeNbs: !!regraMunicipal?.exigeNbs,
      codigoNbs: codigoNbs || null,
      ambiente: prestador.ambiente,
      serieDPS: serieFinal,
      numeroDPS: numeroDPSFinal,
    },
  };
}
