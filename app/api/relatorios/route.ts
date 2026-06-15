import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { checkPlanLimits } from '@/app/services/planService'; 
import { validateRequest } from '@/app/utils/api-security';
import { getAccessibleEmpresaIds } from '@/app/utils/access-control';
import { getTributacaoPorCnae } from '@/app/utils/tributacao'; // <--- ADICIONE ESTA LINHA AQUI


export const dynamic = 'force-dynamic';

const prisma = new PrismaClient();

export async function GET(request: Request) {
  const { targetId, errorResponse } = await validateRequest(request);
  if (errorResponse) return errorResponse;

  const userId = targetId;
  const contextId = request.headers.get('x-empresa-id');
  
  if (!userId) return NextResponse.json({ error: 'Auth required' }, { status: 401 });

  // Validação de Plano
  const planCheck = await checkPlanLimits(userId, 'EMITIR');
  if (!planCheck.allowed) {
      return NextResponse.json({ 
          error: 'Acesso bloqueado: ' + planCheck.reason,
          code: planCheck.status 
      }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const page = parseInt(searchParams.get('page') || '1');
  const limit = parseInt(searchParams.get('limit') || '20');
  
  const search = searchParams.get('search') || '';
  const startDate = searchParams.get('startDate');
  const endDate = searchParams.get('endDate');
  const incluirCanceladas = searchParams.get('incluirCanceladas') === 'true';

  try {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    let empresaId = user?.empresaId;
    if (!user) return NextResponse.json({ error: 'Usuario nao encontrado' }, { status: 404 });

    const accessibleEmpresaIds = await getAccessibleEmpresaIds(user);

    if (contextId && contextId !== 'null') {
       if (accessibleEmpresaIds !== null && !accessibleEmpresaIds.includes(contextId)) {
          return NextResponse.json({ error: 'Empresa nao autorizada para este usuario.' }, { status: 403 });
       }
       empresaId = contextId;
    } else if (accessibleEmpresaIds !== null && empresaId && !accessibleEmpresaIds.includes(empresaId)) {
       return NextResponse.json({ error: 'Empresa nao autorizada para este usuario.' }, { status: 403 });
    }

    if (!empresaId) return NextResponse.json({ data: [], summary: {} });

    const empresa = await prisma.empresa.findUnique({
      where: { id: empresaId },
      select: {
        razaoSocial: true,
        nomeFantasia: true,
        documento: true,
        inscricaoMunicipal: true,
        cidade: true,
        uf: true,
        codigoIbge: true,
      },
    });

    // Filtros
    const whereClause: any = {
      empresaId,
      arquivadoEm: null,
      status: incluirCanceladas 
        ? { in: ['AUTORIZADA', 'CANCELADA'] } 
        : 'AUTORIZADA',
      AND: [
        search ? {
            OR: [
                { tomadorCnpj: { contains: search } },
                // === CORREÇÃO 1: 'nome' é o campo correto no schema do Cliente ===
                { cliente: { nome: { contains: search, mode: 'insensitive' } } },
                // Busca também pelo código do serviço (ex: 17.03)
                { codigoServico: { contains: search } },
                ...( !isNaN(Number(search)) ? [{ numero: Number(search) }] : [])
            ]
        } : {}
      ]
    };

    if (startDate && endDate) {
        // O sufixo -03:00 força o Vercel a calcular as 23:59 de Brasília, 
        // evitando que notas emitidas depois das 21h sumam.
        const start = new Date(`${startDate}T00:00:00-03:00`); 
        const end = new Date(`${endDate}T23:59:59.999-03:00`);
        whereClause.dataEmissao = { gte: start, lte: end };
    }

    const skip = (page - 1) * limit;
    
    // === AQUI QUE A MÁGICA ACONTECE (LISTA DE NOTAS) ===
    const [notas, total] = await prisma.$transaction([
        prisma.notaFiscal.findMany({
            where: whereClause,
            include: { 
                cliente: { 
                    select: { 
                        // === CORREÇÃO 2: Selecionamos apenas campos que existem ===
                        nome: true,       // No seu banco, 'nome' faz o papel de Razão Social
                        nomeFantasia: true 
                    } 
                } 
            },
            orderBy: { dataEmissao: 'desc' },
            skip,
            take: limit
        }),
        prisma.notaFiscal.count({ where: whereClause })
    ]);

    // === NOVA PADRONIZAÇÃO DO CÓDIGO E DESCRIÇÃO DO SERVIÇO ===
    const notasFormatadas = notas.map(n => {
        let codigoTribDisplay = n.cnae || '---';
        let nomeServicoDisplay = n.descricao || '';

        if (n.cnae) {
            const info = getTributacaoPorCnae(n.cnae);
            if (info && info.codigoTributacaoNacional) {
                codigoTribDisplay = info.codigoTributacaoNacional;
                nomeServicoDisplay = info.descricao;
            }
        }
        
        return {
            ...n,
            codigoTribNacional: codigoTribDisplay,
            nomeServico: nomeServicoDisplay
        };
    });

    // === AQUI É SÓ O RESUMO (TOTALIZADORES) ===
    const whereClauseSummary = { ...whereClause };
    whereClauseSummary.status = 'AUTORIZADA'; 
    
    const summary = await prisma.notaFiscal.aggregate({
        where: whereClauseSummary,
        _sum: { valor: true },
        _count: { id: true }
    });

    const totalCanceladas = await prisma.notaFiscal.count({
        where: { ...whereClause, status: 'CANCELADA' }
    });

    return NextResponse.json({
        data: notasFormatadas, // <--- ATENÇÃO AQUI: Enviando a variável formatada!
        meta: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit)
        },
        summary: {
            totalValor: summary._sum.valor || 0,
            qtdAutorizadas: summary._count.id || 0,
            qtdCanceladas: totalCanceladas,
            periodo: { start: startDate, end: endDate }
        },
        prestador: empresa
    });

  } catch (e: any) {
      console.error(e);
      return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
