import { withApiGuard } from '@/app/utils/api-route';
import { NextResponse } from 'next/server';
import { prisma } from '@/app/utils/prisma';
import { getAuthenticatedUser, forbidden, unauthorized } from '@/app/utils/api-middleware';
import { validateSelectableNbs } from '@/app/utils/nbs';
import { canReadFiscalCatalog, canWriteFiscalCatalog } from '@/app/utils/fiscal-admin-access';
import { requireAdminReauthentication } from '@/app/utils/admin-security';
import {
  assertFiscalRuleVersion, changedFiscalRuleFields, FiscalRuleGovernanceError, fiscalRuleSnapshot,
  parseFiscalRuleGovernance, validateNormativeSource,
} from '@/app/utils/fiscal-rule-governance';

type Municipality = { ibge: string; cidade: string; uf: string; nome: string };

function municipalityName(cidade: string, uf: string) {
  const formatted = cidade.toLocaleLowerCase('pt-BR').replace(/(^|[\s'-])\p{L}/gu, letter => letter.toLocaleUpperCase('pt-BR'));
  return `${formatted} - ${uf.toUpperCase()}`;
}

async function loadMunicipalities(codes?: string[]): Promise<Municipality[]> {
  const where = { codigoIbge: { ...(codes ? { in: codes } : {}), not: null }, cidade: { not: null }, uf: { not: null } };
  const [companies, entities, customers] = await Promise.all([
    prisma.empresa.findMany({ where, select: { codigoIbge: true, cidade: true, uf: true }, take: 5000 }),
    prisma.entidadeFiscal.findMany({ where, select: { codigoIbge: true, cidade: true, uf: true }, take: 5000 }),
    prisma.cliente.findMany({ where, select: { codigoIbge: true, cidade: true, uf: true }, take: 5000 }),
  ]);
  const municipalities = new Map<string, Municipality>();
  for (const row of [...companies, ...entities, ...customers]) {
    if (!row.codigoIbge || !row.cidade || !row.uf || municipalities.has(row.codigoIbge)) continue;
    municipalities.set(row.codigoIbge, { ibge: row.codigoIbge, cidade: row.cidade, uf: row.uf,
      nome: municipalityName(row.cidade, row.uf) });
  }
  return [...municipalities.values()].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

async function municipalityCodesForSearch(search: string) {
  if (!search) return [];
  const where = { OR: [{ cidade: { contains: search, mode: 'insensitive' as const } },
    { uf: { equals: search, mode: 'insensitive' as const } }] };
  const [companies, entities, customers] = await Promise.all([
    prisma.empresa.findMany({ where, select: { codigoIbge: true }, take: 500 }),
    prisma.entidadeFiscal.findMany({ where, select: { codigoIbge: true }, take: 500 }),
    prisma.cliente.findMany({ where, select: { codigoIbge: true }, take: 500 }),
  ]);
  return [...new Set([...companies, ...entities, ...customers].map(row => row.codigoIbge).filter((code): code is string => !!code))];
}


function nullableBoolean(value: unknown) {
  if (value === null || value === undefined || value === '') return null;
  return value === true || value === 'true' || value === 1 || value === '1';
}

function nullableDecimal(value: unknown) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function validateFiscalRuleBody(body: any) {
  const percentuais = [
    body.aliquotaIss, body.aliquotaPisRetencao, body.aliquotaCofinsRetencao, body.aliquotaCsllRetencao,
    body.aliquotaIr, body.aliquotaInss, body.aliquotaPisDevido, body.aliquotaCofinsDevido,
  ].filter(value => value !== null && value !== undefined && value !== '');
  if (percentuais.some(value => !Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > 100)) return 'Percentuais fiscais devem estar entre 0 e 100.';
  if (body.valorMinimoRetencaoCrsf !== null && body.valorMinimoRetencaoCrsf !== undefined && body.valorMinimoRetencaoCrsf !== '' && Number(body.valorMinimoRetencaoCrsf) < 0) return 'O valor mínimo de retenção não pode ser negativo.';
  if (body.valorMinimoRetencaoIr !== null && body.valorMinimoRetencaoIr !== undefined && body.valorMinimoRetencaoIr !== '' && Number(body.valorMinimoRetencaoIr) < 0) return 'O valor mínimo de IRRF não pode ser negativo.';
  if (body.inicioVigencia && body.fimVigencia && body.inicioVigencia > body.fimVigencia) return 'O fim da vigência deve ser posterior ao início.';
  if (body.exigeCodigoTributacaoMunicipal !== false && !/^\d+$/.test(String(body.codigoTributacaoMunicipal || ''))) return 'O código municipal obrigatório deve conter somente dígitos.';
  if (body.nbsPadrao && !/^\d{9}$/.test(String(body.nbsPadrao).replace(/\D/g, ''))) return 'O NBS municipal deve possuir 9 dígitos.';
  const indOp = String(body.codigoIndicadorOperacao || '').replace(/\D/g, '');
  const cst = String(body.cstIbsCbs || '').replace(/\D/g, '');
  const classe = String(body.classeTribIbsCbs || '').replace(/\D/g, '');
  if (body.codigoIndicadorOperacao && indOp.length !== 6) return 'cIndOp deve possuir 6 dígitos.';
  if ((body.cstIbsCbs && cst.length !== 3) || (body.classeTribIbsCbs && classe.length !== 6) || (cst && classe && classe.slice(0, 3) !== cst)) return 'CST/cClassTrib do IBS/CBS estão incompletos ou incompatíveis.';
  if (body.versaoLayout && body.versaoLayout !== '1.01') return 'Somente o leiaute de produção 1.01 está liberado.';
  return null;
}

function fiscalRuleData(body: any) {
  return {
    descricaoServicoMunicipal: body.descricaoServicoMunicipal || null,
    aliquotaIss: nullableDecimal(body.aliquotaIss),
    exigeNbs: Boolean(body.exigeNbs),
    exigeCodigoTributacaoMunicipal: body.exigeCodigoTributacaoMunicipal !== false,
    nbsPadrao: body.nbsPadrao || null,
    ativo: body.ativo !== false,
    prioridade: Number.isFinite(Number(body.prioridade)) ? Number(body.prioridade) : 0,
    inicioVigencia: body.inicioVigencia ? new Date(`${body.inicioVigencia}T00:00:00.000Z`) : null,
    fimVigencia: body.fimVigencia ? new Date(`${body.fimVigencia}T23:59:59.999Z`) : null,
    modoRetencoes: ['HERDAR', 'SUGERIR', 'AUTOMATICO'].includes(body.modoRetencoes) ? body.modoRetencoes : 'HERDAR',
    retemCrsf: nullableBoolean(body.retemCrsf),
    aliquotaPisRetencao: nullableDecimal(body.aliquotaPisRetencao),
    aliquotaCofinsRetencao: nullableDecimal(body.aliquotaCofinsRetencao),
    aliquotaCsllRetencao: nullableDecimal(body.aliquotaCsllRetencao),
    valorMinimoRetencaoCrsf: nullableDecimal(body.valorMinimoRetencaoCrsf),
    valorMinimoRetencaoIr: nullableDecimal(body.valorMinimoRetencaoIr),
    retemIr: nullableBoolean(body.retemIr),
    aliquotaIr: nullableDecimal(body.aliquotaIr),
    retemInss: nullableBoolean(body.retemInss),
    aliquotaInss: nullableDecimal(body.aliquotaInss),
    calculaPisCofinsDevido: nullableBoolean(body.calculaPisCofinsDevido),
    aliquotaPisDevido: nullableDecimal(body.aliquotaPisDevido),
    aliquotaCofinsDevido: nullableDecimal(body.aliquotaCofinsDevido),
    habilitaIbsCbs: nullableBoolean(body.habilitaIbsCbs),
    inicioObrigatoriedadeIbsCbs: body.inicioObrigatoriedadeIbsCbs ? new Date(`${body.inicioObrigatoriedadeIbsCbs}T00:00:00.000Z`) : null,
    codigoIndicadorOperacao: body.codigoIndicadorOperacao || null,
    cstIbsCbs: body.cstIbsCbs || null,
    classeTribIbsCbs: body.classeTribIbsCbs || null,
    finNfsePadrao: '0',
    indFinalPadrao: body.indFinalPadrao === '' ? null : body.indFinalPadrao,
    indDestPadrao: body.indDestPadrao || null,
    versaoLayout: body.versaoLayout || '1.01',
    fonteNormativa: body.fonteNormativa || null,
    observacoesFiscal: body.observacoesFiscal || null,
  };
}

export const GET = withApiGuard(async function GET(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return unauthorized();
  if (!canReadFiscalCatalog(user.role)) return forbidden();
  const { searchParams } = new URL(request.url);
  if (searchParams.get('municipios') === 'true') return NextResponse.json({ data: await loadMunicipalities() });
  const page = parseInt(searchParams.get('page') || '1');
  const limit = parseInt(searchParams.get('limit') || '10');
  const search = searchParams.get('search') || '';
  
  const skip = (page - 1) * limit;

  const municipalityCodes = await municipalityCodesForSearch(search);
  const whereClause = search ? {
    OR: [
        { cnae: { contains: search } },
        { codigoIbge: { contains: search } },
        { codigoTributacaoMunicipal: { contains: search } },
        ...(municipalityCodes.length ? [{ codigoIbge: { in: municipalityCodes } }] : []),
    ]
  } : {};

  try {
    const [lista, total] = await prisma.$transaction([
      prisma.tributacaoMunicipal.findMany({
        where: whereClause, 
        skip: skip,
        take: limit,
        orderBy: { createdAt: 'desc' }
      }),
      prisma.tributacaoMunicipal.count({ where: whereClause }) 
    ]);

    const municipalities = new Map((await loadMunicipalities([...new Set(lista.map(item => item.codigoIbge))]))
      .map(item => [item.ibge, item]));
    return NextResponse.json({
      data: lista.map(item => ({ ...item, municipio: municipalities.get(item.codigoIbge) || null })),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    return NextResponse.json({ error: 'Erro ao buscar dados.' }, { status: 500 });
  }
});

// POST: Cria Nova Regra
export const POST = withApiGuard(async function POST(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return unauthorized();
  if (!canWriteFiscalCatalog(user.role)) return forbidden();
  try {
    const body = await request.json();
    const governance = parseFiscalRuleGovernance(body, false);
    const reauthenticationError = await requireAdminReauthentication({
      actorId: user.id, password: governance.adminPassword, justification: governance.justification,
      action: 'MUNICIPAL_RULE_CREATE',
    });
    if (reauthenticationError) return reauthenticationError;
    body.fonteNormativa = validateNormativeSource(body.fonteNormativa);
    const validationError = validateFiscalRuleBody(body);
    if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });
    const nbsValidation = await validateSelectableNbs(body.nbsPadrao);
    if (nbsValidation.error) return NextResponse.json({ error: nbsValidation.error }, { status: 400 });
    body.nbsPadrao = nbsValidation.code;

    if (!body.cnae || !body.codigoIbge || (body.exigeCodigoTributacaoMunicipal !== false && !body.codigoTributacaoMunicipal)) {
      return NextResponse.json({ error: 'CNAE, municipio e codigo municipal obrigatorio devem ser informados.' }, { status: 400 });
    }
    const codigoMunicipal = body.codigoTributacaoMunicipal || '';

    const existe = await prisma.tributacaoMunicipal.findUnique({
      where: {
        cnae_codigoIbge_codigoTributacaoMunicipal: { 
            cnae: body.cnae,
            codigoIbge: body.codigoIbge,
            codigoTributacaoMunicipal: codigoMunicipal
        }
      }
    });

    if (existe) {
      return NextResponse.json(
        { error: 'Esta regra exata (CNAE + Cidade + Cód. Municipal) já existe.' }, 
        { status: 409 } 
      );
    }

    const novo = await prisma.$transaction(async (tx) => {
      const criado = await tx.tributacaoMunicipal.create({ data: {
          cnae: body.cnae, codigoIbge: body.codigoIbge, codigoTributacaoMunicipal: codigoMunicipal,
          ...fiscalRuleData(body),
        } });
      const after = fiscalRuleSnapshot(criado);
      await tx.systemLog.create({ data: {
        level: 'ALERTA', module: 'REGRAS_FISCAIS', action: 'MUNICIPAL_RULE_CREATED', userId: user.id,
        message: 'Regra municipal criada com reautenticação e justificativa.',
        details: JSON.stringify({ ruleType: 'MUNICIPAL', ruleId: criado.id, cnae: criado.cnae,
          codigoIbge: criado.codigoIbge, justification: governance.justification,
          changedFields: changedFiscalRuleFields(null, after), before: null, after }),
      } });
      return criado;
    });

    return NextResponse.json(novo, { status: 201 });

  } catch (e) {
    if (e instanceof FiscalRuleGovernanceError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error(e);
    return NextResponse.json({ error: 'Erro ao processar requisição.' }, { status: 500 });
  }
});

export const PUT = withApiGuard(async function PUT(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return unauthorized();
  if (!canWriteFiscalCatalog(user.role)) return forbidden();
  try {
    const body = await request.json();
    const governance = parseFiscalRuleGovernance(body, true);
    const reauthenticationError = await requireAdminReauthentication({
      actorId: user.id, password: governance.adminPassword, justification: governance.justification,
      action: 'MUNICIPAL_RULE_UPDATE',
    });
    if (reauthenticationError) return reauthenticationError;
    body.fonteNormativa = validateNormativeSource(body.fonteNormativa);
    const validationError = validateFiscalRuleBody(body);
    if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });
    const nbsValidation = await validateSelectableNbs(body.nbsPadrao);
    if (nbsValidation.error) return NextResponse.json({ error: nbsValidation.error }, { status: 400 });
    body.nbsPadrao = nbsValidation.code;
    
    if (body.codigoTributacaoMunicipal) {
        const conflito = await prisma.tributacaoMunicipal.findFirst({
            where: {
                cnae: body.cnae,
                codigoIbge: body.codigoIbge,
                codigoTributacaoMunicipal: body.codigoTributacaoMunicipal,
                NOT: { id: body.id } 
            }
        });

        if (conflito) {
            return NextResponse.json({ error: 'Já existe outra regra com este Código Municipal.' }, { status: 409 });
        }
    }

    const atualizado = await prisma.$transaction(async (tx) => {
      const anterior = await tx.tributacaoMunicipal.findUnique({ where: { id: body.id } });
      if (!anterior) throw new FiscalRuleGovernanceError('Regra municipal não encontrada.', 404);
      assertFiscalRuleVersion(anterior.updatedAt, governance.expectedUpdatedAt);
      const salvo = await tx.tributacaoMunicipal.update({
        where: { id: body.id },
        data: {
            codigoTributacaoMunicipal: body.codigoTributacaoMunicipal || '',
            ...fiscalRuleData(body),
        },
      });
      const before = fiscalRuleSnapshot(anterior);
      const after = fiscalRuleSnapshot(salvo);
      await tx.systemLog.create({ data: {
        level: 'ALERTA', module: 'REGRAS_FISCAIS', action: 'MUNICIPAL_RULE_UPDATED', userId: user.id,
        message: 'Regra municipal atualizada com reautenticação e histórico.',
        details: JSON.stringify({ ruleType: 'MUNICIPAL', ruleId: salvo.id, cnae: salvo.cnae,
          codigoIbge: salvo.codigoIbge, justification: governance.justification,
          changedFields: changedFiscalRuleFields(before, after), before, after }),
      } });
      return salvo;
    });

    return NextResponse.json(atualizado);
    
  } catch (e) {
    if (e instanceof FiscalRuleGovernanceError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: 'Erro ao atualizar' }, { status: 500 });
  }
});

export const DELETE = withApiGuard(async function DELETE(request: Request) {
    const user = await getAuthenticatedUser(request);
    if (!user) return unauthorized();
    if (!canWriteFiscalCatalog(user.role)) return forbidden();
    try {
      const body = await request.json();
      const governance = parseFiscalRuleGovernance(body, true);
      const reauthenticationError = await requireAdminReauthentication({
        actorId: user.id, password: governance.adminPassword, justification: governance.justification,
        action: 'MUNICIPAL_RULE_SUSPEND',
      });
      if (reauthenticationError) return reauthenticationError;
      const id = typeof body.id === 'string' ? body.id : '';
      if (!id) return NextResponse.json({ error: 'ID required' }, { status: 400 });
      const suspensa = await prisma.$transaction(async (tx) => {
        const anterior = await tx.tributacaoMunicipal.findUnique({ where: { id } });
        if (!anterior) throw new FiscalRuleGovernanceError('Regra municipal não encontrada.', 404);
        assertFiscalRuleVersion(anterior.updatedAt, governance.expectedUpdatedAt);
        const salvo = await tx.tributacaoMunicipal.update({ where: { id }, data: { ativo: false } });
        const before = fiscalRuleSnapshot(anterior);
        const after = fiscalRuleSnapshot(salvo);
        await tx.systemLog.create({ data: {
          level: 'ALERTA', module: 'REGRAS_FISCAIS', action: 'MUNICIPAL_RULE_SUSPENDED', userId: user.id,
          message: 'Regra municipal suspensa; histórico e notas anteriores foram preservados.',
          details: JSON.stringify({ ruleType: 'MUNICIPAL', ruleId: salvo.id, cnae: salvo.cnae,
            codigoIbge: salvo.codigoIbge, justification: governance.justification,
            changedFields: changedFiscalRuleFields(before, after), before, after }),
        } });
        return salvo;
      });
      return NextResponse.json({ success: true, data: suspensa });
    } catch (e) {
      if (e instanceof FiscalRuleGovernanceError) return NextResponse.json({ error: e.message }, { status: e.status });
      return NextResponse.json({ error: 'Erro ao suspender regra.' }, { status: 500 });
    }
});
