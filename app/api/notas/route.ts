import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { getTributacaoPorCnae } from '@/app/utils/tributacao';
import { unauthorized } from '@/app/utils/api-middleware';
import { validateRequest } from '@/app/utils/api-security';
import { criarEmissaoJob, dispararProcessamentoEmissaoJob } from '@/app/services/emissaoJobService';

const prisma = new PrismaClient();

async function getEmpresaContexto(user: any, contextId: string | null) {
    const isStaff = ['MASTER', 'ADMIN', 'SUPORTE', 'SUPORTE_TI'].includes(user.role);

    if (contextId && contextId !== 'null' && contextId !== 'undefined') {
        if (isStaff) return contextId;
        if (contextId === user.empresaId) return contextId;

        const colaborador = await prisma.userCliente.findUnique({
            where: { userId_empresaId: { userId: user.id, empresaId: contextId } }
        });
        if (colaborador) return contextId;

        const vinculo = await prisma.contadorVinculo.findUnique({
            where: { contadorId_empresaId: { contadorId: user.id, empresaId: contextId } }
        });
        if (vinculo && vinculo.status === 'APROVADO' && !(vinculo as any).arquivadoEm) return contextId;

        return null;
    }

    return user.empresaId;
}

export async function POST(request: Request) {
    const { targetId, errorResponse } = await validateRequest(request);
    if (errorResponse) return errorResponse;

    const contextId = request.headers.get('x-empresa-id');
    const idempotencyKey = request.headers.get('x-idempotency-key');

    try {
        const body = await request.json();
        const { job, venda, existing } = await criarEmissaoJob({
            userId: targetId,
            contextId,
            body,
            idempotencyKey,
            source: 'WEB',
        });

        if (!existing) dispararProcessamentoEmissaoJob(job.id);

        return NextResponse.json({
            success: true,
            async: true,
            emissaoJobId: job.id,
            status: job.status,
            statusMessage: job.statusMessage,
            vendaId: venda?.id || job.vendaId,
        }, { status: 202 });
    } catch (error: any) {
        return NextResponse.json({
            error: error.message || 'Erro ao registrar emissao.',
            userAction: error.userAction,
            code: error.code,
        }, { status: error.status || 500 });
    }
}

// === GET: LISTAGEM DE NOTAS ===
export async function GET(request: Request) {
    const { targetId, errorResponse } = await validateRequest(request);
    if (errorResponse) return errorResponse;

    const user = await prisma.user.findUnique({ where: { id: targetId } });
    if (!user) return unauthorized();

    const contextId = request.headers.get('x-empresa-id');
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '10');
    const search = searchParams.get('search') || '';
    const typeFilter = searchParams.get('type') || 'all';

    try {
        const empresaIdAlvo = await getEmpresaContexto(user, contextId);
        if (!empresaIdAlvo) return NextResponse.json({ data: [], meta: { total: 0 } });

        const skip = (page - 1) * limit;

        const whereClause: any = {
            empresaId: empresaIdAlvo,
            arquivadoEm: null,
            ...(search && {
                OR: [
                    { cliente: { nome: { contains: search, mode: 'insensitive' } } },
                    { cliente: { documento: { contains: search } } },
                    ...(!isNaN(Number(search)) ? [{ numero: { equals: Number(search) } }] : [])
                ]
            })
        };

        if (typeFilter === 'valid') {
            whereClause.status = { in: ['CONCLUIDA', 'CANCELADA', 'AUTORIZADA'] };
        }

        const [vendas, total] = await prisma.$transaction([
            prisma.venda.findMany({
                where: whereClause, take: limit, skip: skip, orderBy: { createdAt: 'desc' },
                include: {
                    cliente: { select: { nome: true, documento: true } },
                    notas: { orderBy: { createdAt: 'desc' }, select: { id: true, numero: true, status: true, vendaId: true, valor: true, cnae: true, dataEmissao: true, xmlBase64: true, xmlAutorizadoBase64: true, xmlCancelamentoEventoBase64: true, pdfBase64: true } as any },
                    logs: { where: { level: 'ERRO' }, orderBy: { createdAt: 'desc' }, take: 1, select: { message: true } }
                }
            }),
            prisma.venda.count({ where: whereClause })
        ]);

        const dadosFinais = vendas.map(v => {
            let codigoTribDisplay = '---';
            let nomeServicoDisplay = v.descricao || '';

            if (v.notas.length > 0 && v.notas[0].cnae) {
                const info = getTributacaoPorCnae(v.notas[0].cnae);
                if (info && info.codigoTributacaoNacional) {
                    codigoTribDisplay = info.codigoTributacaoNacional;
                    nomeServicoDisplay = info.descricao;
                }
            }

            return {
                ...v,
                cliente: {
                    ...v.cliente,
                    razaoSocial: v.cliente?.nome || 'Consumidor'
                },
                notas: v.notas.map(n => ({ ...n, codigoTribNacional: codigoTribDisplay, nomeServico: nomeServicoDisplay })),
                motivoErro: v.status === 'ERRO_EMISSAO' && v.logs[0] ? v.logs[0].message : null
            };
        });

        return NextResponse.json({ data: dadosFinais, meta: { total, page, totalPages: Math.ceil(total / limit) } });
    } catch (error) {
        return NextResponse.json({ error: 'Erro ao buscar notas' }, { status: 500 });
    }
}
