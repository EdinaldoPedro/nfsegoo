import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { unauthorized } from '@/app/utils/api-middleware';
import { validateRequest } from '@/app/utils/api-security';
import { criarEmissaoJob, dispararProcessamentoEmissaoJob } from '@/app/services/emissaoJobService';
import { resolveEmpresaContexto } from '@/app/utils/access-control';
import { getMensagemErroFiscalCliente } from '@/app/utils/fiscal-error-messages';
import { extractFiscalServiceFromStoredXml, formatTributacaoNacional } from '@/app/utils/nota-fiscal-xml';

const prisma = new PrismaClient();

function parseLogDetails(details?: string | null) {
    if (!details) return null;

    try {
        return JSON.parse(details);
    } catch {
        return null;
    }
}

function resolverErroCliente(log?: { message: string; details?: string | null }) {
    if (!log) return { motivoErro: null, erroPrecisaSuporte: false };

    const details = parseLogDetails(log.details);
    const erroFiscal = getMensagemErroFiscalCliente({ message: log.message, details });
    if (erroFiscal) {
        return { motivoErro: erroFiscal.message, erroPrecisaSuporte: erroFiscal.needsSupport };
    }

    const userAction = details?.userAction || details?.erro?.userAction;
    if (typeof userAction === 'string' && userAction.trim()) {
        return { motivoErro: userAction, erroPrecisaSuporte: false };
    }

    return { motivoErro: log.message || null, erroPrecisaSuporte: false };
}

function fiscalServiceSnapshot(value?: string | null) {
    if (!value) return {} as Record<string, any>;
    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {} as Record<string, any>;
    }
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
        const empresaIdAlvo = await resolveEmpresaContexto(user, contextId);
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
                    notas: { orderBy: { createdAt: 'desc' }, select: { id: true, numero: true, status: true, vendaId: true, valor: true, cnae: true, codigoServico: true, fiscalSnapshotJson: true, dataEmissao: true, xmlBase64: true, xmlAutorizadoBase64: true, xmlCancelamentoEventoBase64: true, pdfBase64: true } as any },
                    logs: { where: { level: 'ERRO' }, orderBy: { createdAt: 'desc' }, take: 1, select: { message: true, details: true } }
                }
            }),
            prisma.venda.count({ where: whereClause })
        ]);

        const classificacoes = new Map<string, { codigo: string; descricaoInformada: string; origem: string }>();
        for (const venda of vendas) {
            for (const nota of venda.notas as any[]) {
                const xml = extractFiscalServiceFromStoredXml(nota.xmlAutorizadoBase64 || nota.xmlBase64);
                const snapshot = fiscalServiceSnapshot(nota.fiscalSnapshotJson);
                const snapshotCode = String(snapshot.codigoTributacaoNacional || snapshot.codigoTribNacional || '').replace(/\D/g, '');
                const legacyCode = String(nota.codigoServico || '').replace(/\D/g, '');
                const codigo = xml.codigoTributacaoNacional || snapshotCode || legacyCode;
                classificacoes.set(nota.id, {
                    codigo,
                    descricaoInformada: xml.descricaoInformada || venda.descricao || '',
                    origem: xml.codigoTributacaoNacional ? 'XML_OFICIAL' : snapshotCode ? 'SNAPSHOT_FISCAL' : legacyCode ? 'LEGADO' : 'NAO_INFORMADO',
                });
            }
        }

        const codigos = [...new Set([...classificacoes.values()].map(item => item.codigo).filter(code => code.length === 6))];
        const catalogoCompleto = codigos.length
            ? await prisma.$queryRaw<Array<{ codigoNumerico: string; codigoFormatado: string; descricao: string }>>`
                SELECT "codigoNumerico", "codigoFormatado", "descricao"
                FROM "TributacaoNacionalCatalogo"
                WHERE "ativo" = true
            `
            : [];
        const codigosNecessarios = new Set(codigos);
        const catalogo = catalogoCompleto.filter(item => codigosNecessarios.has(item.codigoNumerico));
        const catalogoPorCodigo = new Map<string, any>(catalogo.map((item: any) => [item.codigoNumerico, item]));

        const dadosFinais = vendas.map(v => {

            const erroCliente = resolverErroCliente(v.logs[0]);

            return {
                ...v,
                cliente: {
                    ...v.cliente,
                    razaoSocial: v.cliente?.nome || 'Consumidor'
                },
                notas: v.notas.map((n: any) => {
                    const classificacao = classificacoes.get(n.id) || { codigo: '', descricaoInformada: v.descricao || '', origem: 'NAO_INFORMADO' };
                    const oficial = catalogoPorCodigo.get(classificacao.codigo);
                    return {
                        ...n,
                        codigoTribNacional: oficial?.codigoFormatado || formatTributacaoNacional(classificacao.codigo),
                        nomeServico: oficial?.descricao || classificacao.descricaoInformada,
                        descricaoServicoInformada: classificacao.descricaoInformada,
                        origemCodigoTributacao: classificacao.origem,
                    };
                }),
                motivoErro: v.status === 'ERRO_EMISSAO' ? erroCliente.motivoErro : null,
                erroPrecisaSuporte: v.status === 'ERRO_EMISSAO' ? erroCliente.erroPrecisaSuporte : false
            };
        });

        return NextResponse.json({ data: dadosFinais, meta: { total, page, totalPages: Math.ceil(total / limit) } });
    } catch (error) {
        return NextResponse.json({ error: 'Erro ao buscar notas' }, { status: 500 });
    }
}
