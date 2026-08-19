import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { getAuthenticatedUser, forbidden, unauthorized } from '@/app/utils/api-middleware';

const prisma = new PrismaClient();

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

export async function GET(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return unauthorized();
  if (!['MASTER', 'ADMIN', 'CONTADOR'].includes(user.role)) return forbidden();
  const { searchParams } = new URL(request.url);
  const page = parseInt(searchParams.get('page') || '1');
  const limit = parseInt(searchParams.get('limit') || '10');
  const search = searchParams.get('search') || '';
  
  const skip = (page - 1) * limit;

  const whereClause = search ? {
    OR: [
        { cnae: { contains: search } },
        { codigoIbge: { contains: search } },
        { codigoTributacaoMunicipal: { contains: search } }
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

    return NextResponse.json({
      data: lista,
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
}

// POST: Cria Nova Regra
export async function POST(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user || !['MASTER', 'ADMIN'].includes(user.role)) return forbidden();
  try {
    const body = await request.json();
    const validationError = validateFiscalRuleBody(body);
    if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });

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

    const novo = await prisma.tributacaoMunicipal.create({
      data: {
        cnae: body.cnae,
        codigoIbge: body.codigoIbge,
        codigoTributacaoMunicipal: codigoMunicipal,
        ...fiscalRuleData(body),
      }
    });

    return NextResponse.json(novo, { status: 201 });

  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: 'Erro ao processar requisição.' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user || !['MASTER', 'ADMIN'].includes(user.role)) return forbidden();
  try {
    const body = await request.json();
    const validationError = validateFiscalRuleBody(body);
    if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });
    
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

    const atualizado = await prisma.tributacaoMunicipal.update({
        where: { id: body.id },
        data: {
            codigoTributacaoMunicipal: body.codigoTributacaoMunicipal || '',
            ...fiscalRuleData(body),
        }
    });

    return NextResponse.json(atualizado);
    
  } catch (e) {
    return NextResponse.json({ error: 'Erro ao atualizar' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
    const user = await getAuthenticatedUser(request);
    if (!user || !['MASTER', 'ADMIN'].includes(user.role)) return forbidden();
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if(id) {
        await prisma.tributacaoMunicipal.delete({ where: { id }});
        return NextResponse.json({success: true});
    }
    return NextResponse.json({error: "ID required"}, { status: 400 });
}
