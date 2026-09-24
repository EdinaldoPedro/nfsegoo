import { withApiGuard } from '@/app/utils/api-route';
import { NextResponse } from 'next/server';
import { prisma } from '@/app/utils/prisma';
import { Prisma } from '@prisma/client';
import { unauthorized } from '@/app/utils/api-middleware';
import { validateRequest } from '@/app/utils/api-security';
import { criarEmissaoJob } from '@/app/services/emissaoJobService';
import { fiscalOperationSelect } from '@/app/services/fiscalNoteService';
import { resolveEmpresaContexto } from '@/app/utils/access-control';
import { getMensagemErroFiscalCliente } from '@/app/utils/fiscal-error-messages';
import { formatTributacaoNacional } from '@/app/utils/nota-fiscal-xml';
import { validateNfseDocument } from '@/app/services/emissor/validation/AuthorizedNfseValidator';


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

export const POST = withApiGuard(async function POST(request: Request) {
    const { targetId, errorResponse } = await validateRequest(request);
    if (errorResponse) return errorResponse;

    const contextId = request.headers.get('x-empresa-id');
    const idempotencyKey = request.headers.get('x-idempotency-key');

    try {
        const body = await request.json();
        const { job, venda } = await criarEmissaoJob({
            userId: targetId,
            contextId,
            body,
            idempotencyKey,
            source: 'WEB',
        });

        return NextResponse.json({
            success: true,
            async: true,
            emissaoJobId: job.id,
            status: job.status,
            statusMessage: job.statusMessage,
            vendaId: venda?.id || job.vendaId,
        }, { status: 202 });
    } catch (error: any) {
        if (!error.status || error.status >= 500) throw error;
        return NextResponse.json({
            error: error.message || 'Erro ao registrar emissao.',
            userAction: error.userAction,
            code: error.code,
        }, { status: error.status || 500 });
    }
});

// === GET: LISTAGEM DE NOTAS ===
export const GET = withApiGuard(async function GET(request: Request) {
    const { targetId, errorResponse } = await validateRequest(request);
    if (errorResponse) return errorResponse;

    const user = await prisma.user.findUnique({ where: { id: targetId } });
    if (!user) return unauthorized();

    const contextId = request.headers.get('x-empresa-id');
    const { searchParams } = new URL(request.url);
    const page = Number(searchParams.get('page') || '1');
    const limit = Number(searchParams.get('limit') || '10');
    const search = searchParams.get('search') || '';
    const typeFilter = searchParams.get('type') || 'all';
    if (!Number.isSafeInteger(page) || page < 1 || page > 100_000 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100 || search.length > 200) {
        return NextResponse.json({ error: 'Paginação ou busca inválida.' }, { status: 400 });
    }

    try {
        const empresaIdAlvo = await resolveEmpresaContexto(user, contextId);
        if (!empresaIdAlvo) return NextResponse.json({ data: [], meta: { total: 0 } });

        const skip = (page - 1) * limit;
        const productionNoteFilter: Prisma.NotaFiscalWhereInput = { ambiente: 'PRODUCAO', status: { in: ['AUTORIZADA', 'CANCELADA'] } };

        const whereClause: any = {
            empresaId: empresaIdAlvo,
            arquivadoEm: null,
            ...(search && {
                OR: [
                    { cliente: { nome: { contains: search, mode: 'insensitive' } } },
                    { cliente: { documento: { contains: search } } },
                    ...(/^\d{1,13}$/.test(search) ? [{ notas: { some: { OR: [
                        { numeroOficial: String(Number(search)) },
                        ...(Number(search) <= 2_147_483_647 ? [{ numero: Number(search) }] : []),
                    ], ...(typeFilter === 'valid' ? productionNoteFilter : {}) } } }] : [])
                ]
            })
        };

        if (typeFilter === 'valid') {
            whereClause.status = { in: ['CONCLUIDA', 'CANCELADA', 'AUTORIZADA'] };
            whereClause.notas = { some: productionNoteFilter };
        }

        const [vendas, total] = await prisma.$transaction([
            prisma.venda.findMany({
                where: whereClause, take: limit, skip: skip, orderBy: { createdAt: 'desc' },
                include: {
                    cliente: { select: { nome: true, documento: true } },
                    notas: { ...(typeFilter === 'valid' ? { where: productionNoteFilter } : {}), orderBy: { createdAt: 'desc' }, select: { id: true, numero: true, numeroOficial: true, ambiente: true, status: true, vendaId: true, valor: true, cnae: true, codigoServico: true, fiscalSnapshotJson: true, dataEmissao: true, descricao: true, tomadorNome: true, tomadorCnpj: true, metadadosVerificadosEm: true,
                        fiscalOperations: { where: { tipo: 'CANCELAR' }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 1, select: fiscalOperationSelect },
                        documentTask: { select: { status: true } },
                    } },
                    logs: { where: { level: 'ERRO' }, orderBy: { createdAt: 'desc' }, take: 1, select: { message: true, details: true } }
                }
            }),
            prisma.venda.count({ where: whereClause })
        ]);

        const jobs = vendas.length ? await prisma.$queryRaw<Array<{ vendaId: string; status: string; statusMessage: string | null; ambiente: string }>>`
            SELECT DISTINCT ON ("vendaId") "vendaId", "status", "statusMessage", "ambiente" FROM "EmissaoJob"
            WHERE "empresaId" = ${empresaIdAlvo} AND "vendaId" IN (${Prisma.join(vendas.map(v => v.id))})
            ORDER BY "vendaId", "createdAt" DESC, "id" DESC
        ` : [];
        const latestJob = new Map(jobs.map(job => [job.vendaId, job]));
        const noteIds = vendas.flatMap(v => v.notas.map(n => n.id));
        const availability = noteIds.length ? await prisma.$queryRaw<Array<{ id: string; hasXml: boolean; hasCancellationEvent: boolean; hasPdf: boolean }>>`
          SELECT "id",
            (COALESCE(octet_length("xmlAutorizadoBase64"), 0) > 0 OR COALESCE(octet_length("xmlBase64"), 0) > 0) AS "hasXml",
            (COALESCE(octet_length("xmlCancelamentoEventoBase64"), 0) > 0) AS "hasCancellationEvent",
            (COALESCE(octet_length("pdfBase64"), 0) > 0) AS "hasPdf"
          FROM "NotaFiscal" WHERE "empresaId" = ${empresaIdAlvo} AND "id" IN (${Prisma.join(noteIds)})
        ` : [];
        const files = new Map(availability.map(row => [row.id, row]));

        // Restored legacy notes may retain their signed official XML while the
        // derived display columns are empty. Rebuild only this page in memory;
        // never change fiscal records or trust unverified XML on a GET request.
        const missingMetadataIds = vendas.flatMap(v => v.notas
            .filter(n => files.get(n.id)?.hasXml
                && ['AUTORIZADA', 'CANCELADA'].includes(n.status)
                && ['PRODUCAO', 'HOMOLOGACAO'].includes(n.ambiente || '')
                && (!n.metadadosVerificadosEm || !n.codigoServico || !n.tomadorNome || !n.tomadorCnpj))
            .map(n => n.id));
        const xmlMetadata = new Map<string, Awaited<ReturnType<typeof validateNfseDocument>>>();
        if (missingMetadataIds.length) {
            const legacyNotes = await prisma.notaFiscal.findMany({ where: { id: { in: missingMetadataIds }, empresaId: empresaIdAlvo },
                select: { id: true, ambiente: true, chaveAcesso: true, prestadorCnpj: true, xmlAutorizadoBase64: true, xmlBase64: true } });
            await Promise.all(legacyNotes.map(async note => {
                const xml = note.xmlAutorizadoBase64 || note.xmlBase64;
                if (!xml || !note.chaveAcesso || !note.ambiente) return;
                try {
                    xmlMetadata.set(note.id, await validateNfseDocument(xml, note.ambiente, note.chaveAcesso, note.prestadorCnpj));
                } catch {
                    // A missing or unverifiable source must never be presented
                    // as an official XML-derived value.
                }
            }));
        }

        const classificacoes = new Map<string, { codigo: string; descricaoInformada: string; origem: string }>();
        for (const venda of vendas) {
            for (const nota of venda.notas as any[]) {
                const fromXml = xmlMetadata.get(nota.id);
                const snapshot = fiscalServiceSnapshot(nota.fiscalSnapshotJson);
                const snapshotCode = String(snapshot.codigoTributacaoNacional || snapshot.codigoTribNacional || '').replace(/\D/g, '');
                const legacyCode = String(nota.codigoServico || '').replace(/\D/g, '');
                const codigo = fromXml?.codigoServico || (nota.metadadosVerificadosEm ? legacyCode : snapshotCode || legacyCode);
                classificacoes.set(nota.id, {
                    codigo,
                    descricaoInformada: nota.descricao || venda.descricao || '',
                    origem: fromXml || nota.metadadosVerificadosEm ? 'XML_VERIFICADO' : snapshotCode ? 'SNAPSHOT_FISCAL' : legacyCode ? 'LEGADO' : 'NAO_INFORMADO',
                });
            }
        }

        const codigos = [...new Set([...classificacoes.values()].map(item => item.codigo).filter(code => code.length === 6))];
        const catalogoCompleto = codigos.length
            ? await prisma.$queryRaw<Array<{ codigoNumerico: string; codigoFormatado: string; descricao: string }>>`
                SELECT "codigoNumerico", "codigoFormatado", "descricao"
                FROM "TributacaoNacionalCatalogo"
                WHERE "ativo" = true AND "codigoNumerico" IN (${Prisma.join(codigos)})
            `
            : [];
        const codigosNecessarios = new Set(codigos);
        const catalogo = catalogoCompleto.filter(item => codigosNecessarios.has(item.codigoNumerico));
        const catalogoPorCodigo = new Map<string, any>(catalogo.map((item: any) => [item.codigoNumerico, item]));

        const dadosFinais = vendas.map(v => {

            const erroCliente = resolverErroCliente(v.logs[0]);
            const { logs: _logs, ...sale } = v;

            return {
                ...sale,
                emissaoStatus: latestJob.get(v.id)?.status || null,
                emissaoAmbiente: latestJob.get(v.id)?.ambiente || null,
                emissaoMensagem: latestJob.get(v.id)?.statusMessage || null,
                cliente: {
                    ...v.cliente,
                    razaoSocial: v.cliente?.nome || 'Consumidor'
                },
                notas: v.notas.map((n: any) => {
                    const { fiscalSnapshotJson: _snapshot, ...metadata } = n;
                    const classificacao = classificacoes.get(n.id) || { codigo: '', descricaoInformada: v.descricao || '', origem: 'NAO_INFORMADO' };
                    const oficial = catalogoPorCodigo.get(classificacao.codigo);
                    return {
                        ...metadata,
                        tomadorNome: xmlMetadata.get(n.id)?.tomadorNome || n.tomadorNome,
                        tomadorCnpj: xmlMetadata.get(n.id)?.tomadorDocumento || n.tomadorCnpj,
                        hasXml: Boolean(files.get(n.id)?.hasXml),
                        hasCancellationEvent: Boolean(files.get(n.id)?.hasCancellationEvent),
                        hasPdf: Boolean(files.get(n.id)?.hasPdf && n.documentTask?.status === 'CONCLUIDA'),
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
});
