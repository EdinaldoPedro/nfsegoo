import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { getAuthenticatedUser, forbidden, unauthorized } from '@/app/utils/api-middleware';

const prisma = new PrismaClient();

const decimalOrNull = (value: unknown) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

// GET: Lista paginada e com busca
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
      { codigo: { contains: search } },
      { descricao: { contains: search } } 
    ]
  } : {};

  try {
    const [cnaes, total] = await prisma.$transaction([
      prisma.globalCnae.findMany({
        where: whereClause,
        skip: skip,
        take: limit,
        orderBy: { codigo: 'asc' }
      }),
      prisma.globalCnae.count({ where: whereClause })
    ]);

    return NextResponse.json({
      data: cnaes,
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

// PUT: Atualiza dados tributários
export async function PUT(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return unauthorized();
  if (!['MASTER', 'ADMIN', 'CONTADOR'].includes(user.role)) return forbidden();

  try {
    const body = await request.json();
    
    // ATUALIZADO: Recebendo todas as novas regras de retenção
    const { 
        id, 
        itemLc, 
        codigoTributacaoNacional, 
        codigoNbs, 
        temRetencaoInss,
        retemCrsf,
        modoRetencoes,
        aliquotaCrsf,
        retemIr,
        aliquotaIr,
        aliquotaPisRetencao,
        aliquotaCofinsRetencao,
        aliquotaCsllRetencao,
        valorMinimoRetencaoCrsf,
        valorMinimoRetencaoIr,
        aliquotaInss,
        calculaPisCofinsDevido,
        aliquotaPisDevido,
        aliquotaCofinsDevido,
        cstPisCofins,
        aliquotaTotTribSN,
        aliquotaTotTribFederal,
        habilitaIbsCbs,
        inicioObrigatoriedadeIbsCbs,
        codigoIndicadorOperacao,
        cstIbsCbs,
        classeTribIbsCbs,
        fonteNormativa,
        inicioVigencia,
        fimVigencia
    } = body;

    const percentuais = [
      aliquotaCrsf, aliquotaIr, aliquotaPisRetencao, aliquotaCofinsRetencao, aliquotaCsllRetencao,
      aliquotaInss, aliquotaPisDevido, aliquotaCofinsDevido, aliquotaTotTribSN, aliquotaTotTribFederal,
    ].filter(value => value !== null && value !== undefined && value !== '');
    if (percentuais.some(value => !Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > 100)) {
      return NextResponse.json({ error: 'Percentuais fiscais devem estar entre 0 e 100.' }, { status: 400 });
    }
    if (valorMinimoRetencaoCrsf !== null && valorMinimoRetencaoCrsf !== undefined && valorMinimoRetencaoCrsf !== '' && Number(valorMinimoRetencaoCrsf) < 0) {
      return NextResponse.json({ error: 'O valor mínimo de retenção não pode ser negativo.' }, { status: 400 });
    }
    if (valorMinimoRetencaoIr !== null && valorMinimoRetencaoIr !== undefined && valorMinimoRetencaoIr !== '' && Number(valorMinimoRetencaoIr) < 0) {
      return NextResponse.json({ error: 'O valor mínimo de IRRF não pode ser negativo.' }, { status: 400 });
    }
    if (modoRetencoes && !['SUGERIR', 'AUTOMATICO'].includes(modoRetencoes)) {
      return NextResponse.json({ error: 'Modo de retenção inválido.' }, { status: 400 });
    }
    if (inicioVigencia && fimVigencia && inicioVigencia > fimVigencia) {
      return NextResponse.json({ error: 'O fim da vigência deve ser posterior ao início.' }, { status: 400 });
    }
    if (cstPisCofins && !/^\d{2}$/.test(String(cstPisCofins).replace(/\D/g, ''))) {
      return NextResponse.json({ error: 'O CST de PIS/COFINS deve possuir 2 dígitos.' }, { status: 400 });
    }
    if (codigoIndicadorOperacao && !/^\d{6}$/.test(String(codigoIndicadorOperacao).replace(/\D/g, ''))) {
      return NextResponse.json({ error: 'cIndOp deve possuir 6 dígitos.' }, { status: 400 });
    }
    const cstLimpo = String(cstIbsCbs || '').replace(/\D/g, '');
    const classeLimpa = String(classeTribIbsCbs || '').replace(/\D/g, '');
    if ((cstIbsCbs && cstLimpo.length !== 3) || (classeTribIbsCbs && classeLimpa.length !== 6) || (cstLimpo && classeLimpa && classeLimpa.slice(0, 3) !== cstLimpo)) {
      return NextResponse.json({ error: 'CST/cClassTrib do IBS/CBS estão incompletos ou incompatíveis.' }, { status: 400 });
    }

    const crsfAtiva = retemCrsf === true || retemCrsf === 'true';
    const irAtiva = retemIr === true || retemIr === 'true';
    const pisRetencao = crsfAtiva ? decimalOrNull(aliquotaPisRetencao) ?? 0.65 : decimalOrNull(aliquotaPisRetencao);
    const cofinsRetencao = crsfAtiva ? decimalOrNull(aliquotaCofinsRetencao) ?? 3 : decimalOrNull(aliquotaCofinsRetencao);
    const csllRetencao = crsfAtiva ? decimalOrNull(aliquotaCsllRetencao) ?? 1 : decimalOrNull(aliquotaCsllRetencao);
    const totalCrsf = crsfAtiva ? Number((pisRetencao! + cofinsRetencao! + csllRetencao!).toFixed(2)) : null;

    const atualizado = await prisma.globalCnae.update({
      where: { id },
      data: {
        itemLc,
        codigoTributacaoNacional,
        codigoNbs,
        temRetencaoInss,
        retemCrsf,
        modoRetencoes: modoRetencoes || 'SUGERIR',
        aliquotaCrsf: totalCrsf,
        retemIr: irAtiva,
        aliquotaIr: decimalOrNull(aliquotaIr),
        aliquotaPisRetencao: pisRetencao,
        aliquotaCofinsRetencao: cofinsRetencao,
        aliquotaCsllRetencao: csllRetencao,
        valorMinimoRetencaoCrsf: crsfAtiva ? decimalOrNull(valorMinimoRetencaoCrsf) ?? 10.01 : decimalOrNull(valorMinimoRetencaoCrsf),
        valorMinimoRetencaoIr: irAtiva ? decimalOrNull(valorMinimoRetencaoIr) ?? 10.01 : decimalOrNull(valorMinimoRetencaoIr),
        aliquotaInss: decimalOrNull(aliquotaInss),
        calculaPisCofinsDevido: calculaPisCofinsDevido === null || calculaPisCofinsDevido === undefined || calculaPisCofinsDevido === '' ? null : calculaPisCofinsDevido === true || calculaPisCofinsDevido === 'true',
        aliquotaPisDevido: decimalOrNull(aliquotaPisDevido),
        aliquotaCofinsDevido: decimalOrNull(aliquotaCofinsDevido),
        cstPisCofins: cstPisCofins || null,
        aliquotaTotTribSN: aliquotaTotTribSN !== '' && aliquotaTotTribSN !== null ? parseFloat(aliquotaTotTribSN) : null,
        aliquotaTotTribFederal: decimalOrNull(aliquotaTotTribFederal),
        habilitaIbsCbs: habilitaIbsCbs === null || habilitaIbsCbs === undefined || habilitaIbsCbs === '' ? null : habilitaIbsCbs === true || habilitaIbsCbs === 'true',
        inicioObrigatoriedadeIbsCbs: inicioObrigatoriedadeIbsCbs ? new Date(`${inicioObrigatoriedadeIbsCbs}T00:00:00.000Z`) : null,
        codigoIndicadorOperacao: codigoIndicadorOperacao || null,
        cstIbsCbs: cstIbsCbs || null,
        classeTribIbsCbs: classeTribIbsCbs || null,
        fonteNormativa: fonteNormativa || null,
        inicioVigencia: inicioVigencia ? new Date(`${inicioVigencia}T00:00:00.000Z`) : null,
        fimVigencia: fimVigencia ? new Date(`${fimVigencia}T23:59:59.999Z`) : null
      }
    });

    return NextResponse.json(atualizado);
  } catch (error) {
    return NextResponse.json({ error: 'Erro ao atualizar' }, { status: 500 });
  }
}
