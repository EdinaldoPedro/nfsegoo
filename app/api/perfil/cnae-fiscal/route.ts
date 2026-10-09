import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { withApiGuard } from '@/app/utils/api-route';
import { validateRequest } from '@/app/utils/api-security';
import { hasCustomerCompanyAccess, resolveEmpresaContexto } from '@/app/utils/access-control';
import { prisma } from '@/app/utils/prisma';
import { normalizarRegimeTributario, type RegimeTributarioSuportado } from '@/app/utils/regime-tributario';

const optionalText = (value: unknown, max: number) => value === null || value === undefined || value === '' ? null : String(value).trim().slice(0, max);
const optionalNumber = (value: unknown) => value === null || value === undefined || value === '' ? null : Number(value);
const optionalBoolean = (value: unknown) => typeof value === 'boolean' ? value : null;

function normalize(body: any, regime: RegimeTributarioSuportado) {
  const config = {
    codigoTributacaoNacional: optionalText(body.codigoTributacaoNacional, 6)?.replace(/\D/g, '') || null,
    itemLc: optionalText(body.itemLc, 10), codigoTributacaoMunicipal: optionalText(body.codigoTributacaoMunicipal, 20),
    descricaoServicoMunicipal: optionalText(body.descricaoServicoMunicipal, 500), tipoTributacao: optionalText(body.tipoTributacao, 1),
    aliquotaIss: optionalNumber(body.aliquotaIss), exigeCodigoTributacaoMunicipal: body.exigeCodigoTributacaoMunicipal === true,
    exigeNbs: body.exigeNbs === true, nbsPadrao: optionalText(body.nbsPadrao, 9)?.replace(/\D/g, '') || null,
    modoRetencoes: ['SUGERIR', 'AUTOMATICO'].includes(body.modoRetencoes) ? body.modoRetencoes : 'SUGERIR',
    retemCrsf: optionalBoolean(body.retemCrsf), aliquotaPisRetencao: optionalNumber(body.aliquotaPisRetencao),
    aliquotaCofinsRetencao: optionalNumber(body.aliquotaCofinsRetencao), aliquotaCsllRetencao: optionalNumber(body.aliquotaCsllRetencao),
    retemIr: optionalBoolean(body.retemIr), aliquotaIr: optionalNumber(body.aliquotaIr), retemInss: optionalBoolean(body.retemInss),
    aliquotaInss: optionalNumber(body.aliquotaInss), habilitaIbsCbs: optionalBoolean(body.habilitaIbsCbs),
    codigoIndicadorOperacao: optionalText(body.codigoIndicadorOperacao, 20), cstIbsCbs: optionalText(body.cstIbsCbs, 10),
    classeTribIbsCbs: optionalText(body.classeTribIbsCbs, 20), finNfsePadrao: optionalText(body.finNfsePadrao, 2),
    indFinalPadrao: optionalText(body.indFinalPadrao, 2), indDestPadrao: optionalText(body.indDestPadrao, 2),
    complementares: Array.isArray(body.complementares) ? body.complementares.filter((item: unknown) => item === 'EVENTO') : [],
  };
  for (const rate of ['aliquotaIss', 'aliquotaPisRetencao', 'aliquotaCofinsRetencao', 'aliquotaCsllRetencao', 'aliquotaIr', 'aliquotaInss'] as const) {
    if (config[rate] !== null && (!Number.isFinite(config[rate]) || config[rate]! < 0 || config[rate]! > 100)) throw Object.assign(new Error('As alíquotas devem estar entre 0 e 100.'), { status: 400 });
  }
  if (config.tipoTributacao && !/^[1-4]$/.test(config.tipoTributacao)) throw Object.assign(new Error('Tributação do ISSQN inválida.'), { status: 400 });
  if (regime === 'MEI') {
    config.codigoTributacaoMunicipal = null;
    config.descricaoServicoMunicipal = null;
    config.aliquotaIss = null;
    config.exigeCodigoTributacaoMunicipal = false;
    config.modoRetencoes = 'SUGERIR';
    config.retemCrsf = false;
    config.aliquotaPisRetencao = null;
    config.aliquotaCofinsRetencao = null;
    config.aliquotaCsllRetencao = null;
    config.retemIr = false;
    config.aliquotaIr = null;
    config.retemInss = false;
    config.aliquotaInss = null;
  } else if (regime === 'SIMPLES') {
    config.retemCrsf = false;
    config.aliquotaPisRetencao = null;
    config.aliquotaCofinsRetencao = null;
    config.aliquotaCsllRetencao = null;
    config.retemIr = false;
    config.aliquotaIr = null;
  }
  return config;
}

export const PUT = withApiGuard(async function PUT(request: Request) {
  const auth = await validateRequest(request);
  if (auth.errorResponse) return auth.errorResponse;
  const body = await request.json();
  const empresaId = auth.user ? await resolveEmpresaContexto(auth.user, request.headers.get('x-empresa-id')) : null;
  if (!auth.user || !empresaId || !await hasCustomerCompanyAccess(auth.user, empresaId)) return NextResponse.json({ error: 'Empresa indisponível.' }, { status: 403 });
  if (typeof body.cnaeId !== 'string' || typeof body.ativo !== 'boolean') return NextResponse.json({ error: 'Configuração inválida.' }, { status: 400 });
  try {
    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Empresa" WHERE "id" = ${empresaId} FOR UPDATE`;
      const empresa = await tx.empresa.findUnique({ where: { id: empresaId }, select: { regimeTributario: true } });
      const regime = normalizarRegimeTributario(empresa?.regimeTributario);
      if (!regime) throw Object.assign(new Error('Selecione um regime tributário atendido antes de configurar o CNAE.'), { status: 400 });
      const config = normalize(body, regime);
      if (body.ativo) {
        if (!/^\d{6}$/.test(config.codigoTributacaoNacional || '') || !/^\d{1,2}\.\d{1,2}$/.test(config.itemLc || '')) throw Object.assign(new Error('Para ativar, informe o código tributário nacional (6 dígitos) e o item da LC 116.'), { status: 400 });
        const itemDigits = String(config.itemLc).replace(/\D/g, '').padStart(4, '0');
        if (itemDigits !== String(config.codigoTributacaoNacional).slice(0, 4)) throw Object.assign(new Error('O item da LC 116 não corresponde ao código tributário nacional selecionado.'), { status: 400 });
        if (config.exigeCodigoTributacaoMunicipal && !config.codigoTributacaoMunicipal) throw Object.assign(new Error('Informe o código municipal exigido.'), { status: 400 });
        if (config.exigeNbs && !/^\d{9}$/.test(config.nbsPadrao || '')) throw Object.assign(new Error('Informe um NBS válido com 9 dígitos.'), { status: 400 });
      }
      const cnae = await tx.cnae.findFirst({ where: { id: body.cnaeId, empresaId } });
      if (!cnae) throw Object.assign(new Error('CNAE não pertence à empresa.'), { status: 404 });
      const prior = await tx.$queryRaw<Array<{ id: string; versao: number; configuracao: any; ativo: boolean }>>`SELECT "id", "versao", "configuracao", "ativo" FROM "EmpresaCnaeConfiguracaoFiscal" WHERE "cnaeId" = ${cnae.id} FOR UPDATE`;
      const id = prior[0]?.id || randomUUID(); const version = (prior[0]?.versao || 0) + 1;
      await tx.$executeRaw`INSERT INTO "EmpresaCnaeConfiguracaoFiscal" ("id","empresaId","cnaeId","ativo","configuracao","versao","atualizadoPor","createdAt","updatedAt") VALUES (${id},${empresaId},${cnae.id},${body.ativo},${JSON.stringify(config)}::jsonb,${version},${auth.user!.id},clock_timestamp(),clock_timestamp()) ON CONFLICT ("cnaeId") DO UPDATE SET "ativo"=${body.ativo},"configuracao"=${JSON.stringify(config)}::jsonb,"versao"=${version},"atualizadoPor"=${auth.user!.id},"updatedAt"=clock_timestamp()`;
      await tx.systemLog.create({ data: { level: 'ALERTA', action: 'COMPANY_CNAE_FISCAL_CONFIG_UPDATED', module: 'FISCAL', userId: auth.user!.id, empresaId, message: `Configuração fiscal própria do CNAE ${cnae.codigo} ${body.ativo ? 'ativada' : 'salva como rascunho'}.`, details: JSON.stringify({ cnaeId: cnae.id, cnae: cnae.codigo, version, active: body.ativo, before: prior[0] || null, after: config }) } });
      return { id, versao: version, ativo: body.ativo, configuracao: config };
    });
    return NextResponse.json(result);
  } catch (error) { const failure = error as Error & { status?: number }; if (failure.status) return NextResponse.json({ error: failure.message }, { status: failure.status }); throw error; }
}, { maxBodyBytes: 32 * 1024 });
