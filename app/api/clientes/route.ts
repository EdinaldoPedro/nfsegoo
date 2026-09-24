import { withApiGuard } from '@/app/utils/api-route';
import { NextResponse } from 'next/server';
import { prisma } from '@/app/utils/prisma';
import { checkPlanLimits, resolveBillingUserId } from '@/app/services/planService';
import { commercialTransaction } from '@/app/services/commercialService';
import { validateRequest } from "@/app/utils/api-security";
import { resolveEmpresaContexto } from '@/app/utils/access-control';
import { validateNationalAddress } from '@/app/utils/customer-address';
import { validateJsonContentLength } from '@/app/utils/request-guards';
import { findTenantCustomer } from '@/app/services/tenantCustomerService';
import { normalizeCustomerDocument } from '@/app/utils/customer-document';
import {
    consultarEntidadeFiscalPublica, effectiveFiscalEntity, ensureCanonicalFiscalEntity,
    loadCanonicalFiscalEntity, mergeTenantCustomer, tenantCustomerFiscalInclude,
    type FiscalRegistryResult,
} from '@/app/services/fiscalEntityService';

const MOEDAS_EXTERIOR_SUPORTADAS = new Set(['BRL', 'USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'CHF', 'CNY', 'MXN', 'ARS', 'CLP', 'COP', 'PYG', 'UYU']);

// === NOVA INTELIGÊNCIA: AUTO-BUSCA DE IBGE ===
async function buscarIbgePorCep(cep: string): Promise<string | null> {
    try {
        const cepLimpo = cep.replace(/\D/g, '');
        if (cepLimpo.length !== 8) return null;
        const res = await fetch(`https://viacep.com.br/ws/${cepLimpo}/json/`, { next: { revalidate: 3600 } });
        const data = await res.json();
        if (!data.erro && data.ibge) return data.ibge;
        return null;
    } catch (e) {
        return null;
    }
}

function validarEnderecoMinimoParaEmissao(body: any, codigoIbgeFinal: string | null | undefined) {
    const validation = validateNationalAddress({ ...body, codigoIbge: codigoIbgeFinal });
    return validation.valid ? null : validation.message || 'Endereço incompleto para emissão.';
}

function validarTomadorExterior(body: any) {
    const faltantes = [
        ['país', body.pais], ['moeda', body.moeda], ['código postal', body.cep], ['logradouro', body.logradouro],
        ['número', body.numero], ['bairro', body.bairro], ['cidade', body.cidade], ['estado/província/região', body.uf],
    ].filter(([, value]) => !String(value || '').trim()).map(([label]) => label);
    if (faltantes.length) return `Informe os dados do tomador exterior: ${faltantes.join(', ')}.`;
    if (!MOEDAS_EXTERIOR_SUPORTADAS.has(String(body.moeda).toUpperCase())) return 'Moeda exterior não suportada pelo leiaute atual.';
    if (String(body.cep).trim().length > 11) return 'Código postal exterior deve possuir no máximo 11 caracteres.';
    return null;
}

export const GET = withApiGuard(async function GET(request: Request) {
    const { targetId, errorResponse } = await validateRequest(request);
    if (errorResponse) return errorResponse;
    
    const user = await prisma.user.findUnique({ where: { id: targetId } });
    if (!user) return NextResponse.json({ error: 'Proibido' }, { status: 401 });

    const contextId = request.headers.get('x-empresa-id');
    const { searchParams } = new URL(request.url);
    const search = (searchParams.get('search') || '').slice(0, 120);
    const page = Math.max(1, Math.min(100_000, parseInt(searchParams.get('page') || '1') || 1));
    const limit = Math.max(1, Math.min(100, parseInt(searchParams.get('limit') || '10') || 10));

    try {
        const empresaIdAlvo = await resolveEmpresaContexto(user, contextId);
        if (!empresaIdAlvo) return NextResponse.json({ data: [], meta: { total: 0 } });

        const whereClause = {
            empresaId: empresaIdAlvo,
            arquivadoEm: null,
            vinculos: { some: { empresaId: empresaIdAlvo, arquivadoEm: null } },
            ...(search && {
                OR: [
                    { nome: { contains: search, mode: 'insensitive' as const } },
                    { documento: { contains: search } },
                    { email: { contains: search, mode: 'insensitive' as const } },
                    { entidadeFiscal: { is: { OR: [
                        { razaoSocial: { contains: search, mode: 'insensitive' as const } },
                        { nomeFantasia: { contains: search, mode: 'insensitive' as const } },
                        { documento: { contains: search } },
                        { correcoes: { some: { campo: { in: ['razaoSocial', 'nomeFantasia'] }, valor: { contains: search, mode: 'insensitive' as const } } } },
                    ] } } }
                ]
            })
        };

        const skip = (page - 1) * limit;

        const [clientes, total] = await prisma.$transaction([
            prisma.cliente.findMany({
                where: whereClause,
                skip: skip,
                take: limit,
                orderBy: { createdAt: 'desc' },
                include: { _count: { select: { vendas: true } }, entidadeFiscal: { include: tenantCustomerFiscalInclude } }
            }),
            prisma.cliente.count({ where: whereClause })
        ]);

        const dadosFormatados = clientes.map((c: any) => {
            const merged = mergeTenantCustomer(c);
            return { ...merged, vendas: c._count?.vendas || 0, _count: undefined };
        });

        return NextResponse.json({
            data: dadosFormatados,
            meta: { total, page, limit, totalPages: Math.ceil(total / limit) }
        });
    } catch (error: any) {
        return NextResponse.json({ error: 'Erro ao buscar clientes' }, { status: 500 });
    }
});

export const POST = withApiGuard(async function POST(request: Request) {
    const { targetId, errorResponse } = await validateRequest(request);
    if (errorResponse) return errorResponse;

    const user = await prisma.user.findUnique({ where: { id: targetId } });
    if (!user) return NextResponse.json({ error: 'Proibido' }, { status: 401 });

    const contextId = request.headers.get('x-empresa-id');
    const sizeError = validateJsonContentLength(request, 128 * 1024);
    if (sizeError) return sizeError;
    const body = await request.json();
    if (typeof body.nome !== 'string' || !body.nome.trim() || body.nome.length > 160 || (body.documento != null && (typeof body.documento !== 'string' || body.documento.length > 64))) {
        return NextResponse.json({ error: 'Nome ou documento invalido.' }, { status: 400 });
    }

    try {
        const empresaIdAlvo = await resolveEmpresaContexto(user, contextId);
        if (!empresaIdAlvo) return NextResponse.json({ error: 'Acesso negado a esta empresa' }, { status: 403 });

        const prestador = await prisma.empresa.findUnique({ where: { id: empresaIdAlvo } });
        if (!prestador) throw new Error("Empresa não encontrada.");

        const donoFaturamentoId = await resolveBillingUserId({ empresaId: empresaIdAlvo, actorUserId: user.id, acao: 'CADASTRAR_CLIENTE' });

        // === 1. FORÇA O TIPO CORRETO E LIMPA O DOCUMENTO COM SUPORTE A NULO E EXT ===
        const normalizedDocument = normalizeCustomerDocument(body.tipo, body.documento);
        const tipoFinal = normalizedDocument.tipo;
        const docLimpo = normalizedDocument.documento;

        // Campo mantido no banco apenas por compatibilidade com cadastros antigos.
        // Novos cadastros e edições nacionais sempre persistem endereço completo.
        const semEndereco = false;
        const cepLimpo = body.cep
            ? (tipoFinal === 'EXT' ? String(body.cep).trim() : body.cep.replace(/\D/g, ''))
            : null;

        // A PJ shares one public identity by CNPJ. A public lookup is attempted
        // on every new registration, while private contact/IM remain in Cliente.
        let registry: FiscalRegistryResult | null = null;
        let canonicalPreview: Record<string, any> = { ...body, cep: cepLimpo };
        if (tipoFinal === 'PJ' && docLimpo) {
            const [lookup, known] = await Promise.all([
                consultarEntidadeFiscalPublica(docLimpo),
                loadCanonicalFiscalEntity(docLimpo),
            ]);
            registry = lookup;
            const existing = known ? effectiveFiscalEntity(known) : null;
            const publicData = lookup?.data;
            canonicalPreview = {
                ...canonicalPreview,
                nome: body.nome || publicData?.razaoSocial || existing?.razaoSocial,
                nomeFantasia: body.nomeFantasia ?? publicData?.nomeFantasia ?? existing?.nomeFantasia,
                cep: cepLimpo || publicData?.cep || existing?.cep,
                logradouro: body.logradouro || publicData?.logradouro || existing?.logradouro,
                numero: body.numero ?? publicData?.numero ?? existing?.numero,
                complemento: body.complemento ?? publicData?.complemento ?? existing?.complemento,
                bairro: body.bairro || publicData?.bairro || existing?.bairro,
                cidade: body.cidade || publicData?.cidade || existing?.cidade,
                uf: body.uf || publicData?.uf || existing?.uf,
                codigoIbge: body.codigoIbge || publicData?.codigoIbge || existing?.codigoIbge,
            };
        }

        // === 2. RECUPERA IBGE FALTANTE PARA PF/LEGADO ===
        let codigoIbgeFinal = body.codigoIbge;
        if (tipoFinal === 'PJ') codigoIbgeFinal = canonicalPreview.codigoIbge;
        if (tipoFinal !== 'EXT' && canonicalPreview.cep && (!codigoIbgeFinal || codigoIbgeFinal.length < 7)) {
            const ibgeEncontrado = await buscarIbgePorCep(canonicalPreview.cep);
            if (ibgeEncontrado) codigoIbgeFinal = ibgeEncontrado;
        }

        canonicalPreview.codigoIbge = codigoIbgeFinal;
        if (tipoFinal !== 'EXT') {
            const erroEndereco = validarEnderecoMinimoParaEmissao(canonicalPreview, codigoIbgeFinal);
            if (erroEndereco) return NextResponse.json({ error: erroEndereco }, { status: 400 });
        }
        if (tipoFinal === 'EXT') {
            const erroExterior = validarTomadorExterior({ ...body, cep: cepLimpo });
            if (erroExterior) return NextResponse.json({ error: erroExterior }, { status: 400 });
            codigoIbgeFinal = null;
        }

        return await commercialTransaction(donoFaturamentoId, async (tx) => {
          await tx.$queryRaw`SELECT "id" FROM "Empresa" WHERE "id" = ${empresaIdAlvo} FOR UPDATE`;
          const currentOwner = await resolveBillingUserId({ empresaId: empresaIdAlvo, actorUserId: user.id }, tx);
          if (currentOwner !== donoFaturamentoId) return NextResponse.json({ error: 'Responsável financeiro alterado. Tente novamente.' }, { status: 409 });
          const planCheck = await checkPlanLimits(donoFaturamentoId, 'CADASTRAR_CLIENTE', tx);
          if (!planCheck.allowed) return NextResponse.json({ error: planCheck.reason || 'Limite de clientes atingido.', code: planCheck.status }, { status: 403 });
        const entidadeFiscal = tipoFinal === 'PJ' && docLimpo
            ? await ensureCanonicalFiscalEntity(tx, docLimpo, canonicalPreview, registry, user.id, { origin: 'CADASTRO_CLIENTE' })
            : null;
        const entidadeEfetiva = entidadeFiscal ? effectiveFiscalEntity(entidadeFiscal) : null;
        const cadastroPublico = entidadeEfetiva ? {
            nome: entidadeEfetiva.razaoSocial,
            nomeFantasia: entidadeEfetiva.nomeFantasia,
            cep: entidadeEfetiva.cep,
            logradouro: entidadeEfetiva.logradouro,
            numero: entidadeEfetiva.numero,
            complemento: entidadeEfetiva.complemento,
            bairro: entidadeEfetiva.bairro,
            cidade: entidadeEfetiva.cidade,
            uf: entidadeEfetiva.uf,
            codigoIbge: entidadeEfetiva.codigoIbge,
        } : null;
        let clienteGlobal = null;
        if (docLimpo) {
            clienteGlobal = await tx.cliente.findUnique({
                where: { empresaId_documento: { empresaId: empresaIdAlvo, documento: docLimpo } },
                include: { vinculos: { where: { empresaId: empresaIdAlvo } } }
            });
        }

        if (clienteGlobal) {
            const vinculoExistente = clienteGlobal.vinculos?.[0];
            if (vinculoExistente && !(vinculoExistente as any).arquivadoEm) {
                return NextResponse.json({ error: 'Já existe um cliente com este CPF/CNPJ na sua carteira.' }, { status: 400 });
            }

            // Atualiza tipo se estiver errado na base antiga e vincula
            const clienteVinculado = await tx.cliente.update({
                where: { id: clienteGlobal.id },
                data: {
                    tipo: tipoFinal,
                    entidadeFiscalId: entidadeFiscal?.id,
                    nome: cadastroPublico?.nome || body.nome || clienteGlobal.nome,
                    nomeFantasia: cadastroPublico?.nomeFantasia ?? body.nomeFantasia ?? clienteGlobal.nomeFantasia,
                    email: body.email || clienteGlobal.email,
                    telefone: body.telefone ? String(body.telefone).replace(/\D/g, '') : clienteGlobal.telefone,
                    semEndereco: false,
                    cep: cadastroPublico?.cep || cepLimpo,
                    logradouro: cadastroPublico?.logradouro || body.logradouro || null,
                    numero: cadastroPublico?.numero || body.numero || null,
                    complemento: cadastroPublico?.complemento ?? body.complemento ?? null,
                    bairro: cadastroPublico?.bairro || body.bairro || null,
                    cidade: cadastroPublico?.cidade || body.cidade || null,
                    uf: cadastroPublico?.uf || body.uf || null,
                    codigoIbge: cadastroPublico?.codigoIbge || codigoIbgeFinal,
                    inscricaoMunicipal: body.inscricaoMunicipal || clienteGlobal.inscricaoMunicipal,
                    inscricaoEstadual: body.inscricaoEstadual || clienteGlobal.inscricaoEstadual,
                    arquivadoEm: null,
                    arquivadoPor: null,
                    motivoArquivamento: null,
                    vinculos: vinculoExistente
                        ? { update: { where: { id: vinculoExistente.id }, data: { arquivadoEm: null, arquivadoPor: null, motivoArquivamento: null } as any } }
                        : { create: {} }
                } as any
            });

            await tx.systemLog.create({ data: { level: 'INFO', action: 'CLIENTE_VINCULADO', userId: user.id, message: 'Cliente reativado na carteira.', empresaId: empresaIdAlvo, details: JSON.stringify({ clienteId: clienteVinculado.id, billingUserId: donoFaturamentoId }) } });
            return NextResponse.json({ success: true, cliente: clienteVinculado }, { status: 201 });
        }

        // Cliente is intentionally one private relationship per issuer. The
        // heavy/public PJ identity above is shared globally by CNPJ.
        const novoCliente = await tx.cliente.create({
            data: {
                empresaId: empresaIdAlvo,
                entidadeFiscalId: entidadeFiscal?.id,
                nome: cadastroPublico?.nome || body.nome,
                nomeFantasia: cadastroPublico?.nomeFantasia ?? body.nomeFantasia ?? null,
                documento: docLimpo, // Passa null em vez de '' se for vazio
                tipo: tipoFinal,
                email: body.email || null,
                telefone: body.telefone ? body.telefone.replace(/\D/g, '') : null,
                semEndereco,
                cep: cadastroPublico?.cep || cepLimpo,
                logradouro: cadastroPublico?.logradouro || body.logradouro || null,
                numero: cadastroPublico?.numero || body.numero || null,
                complemento: cadastroPublico?.complemento ?? body.complemento ?? null,
                bairro: cadastroPublico?.bairro || body.bairro || null,
                cidade: cadastroPublico?.cidade || body.cidade || null,
                uf: cadastroPublico?.uf || body.uf || null,
                codigoIbge: cadastroPublico?.codigoIbge || codigoIbgeFinal,
                inscricaoMunicipal: body.inscricaoMunicipal || null,
                inscricaoEstadual: body.inscricaoEstadual || null,
                nif: body.nif || null,
                pais: tipoFinal === 'EXT' ? body.pais : (body.pais || 'Brasil'),
                moeda: tipoFinal === 'EXT' ? String(body.moeda).toUpperCase() : (body.moeda || 'BRL'),
                vinculos: { create: {} }
            }
        });

        await tx.systemLog.create({ data: { level: 'INFO', action: 'CLIENTE_CRIADO', userId: user.id, message: 'Cliente cadastrado na carteira.', empresaId: empresaIdAlvo, details: JSON.stringify({ clienteId: novoCliente.id, billingUserId: donoFaturamentoId }) } });
        return NextResponse.json({ success: true, cliente: novoCliente }, { status: 201 });
        });
    } catch (error: any) {
        return NextResponse.json({ error: error.message || 'Erro ao salvar cliente.' }, { status: 500 });
    }
}, { maxBodyBytes: 128 * 1024 });

export const PUT = withApiGuard(async function PUT(request: Request) {
    const { targetId, errorResponse } = await validateRequest(request);
    if (errorResponse) return errorResponse;

    const user = await prisma.user.findUnique({ where: { id: targetId } });
    if (!user) return NextResponse.json({ error: 'Proibido' }, { status: 401 });

    const contextId = request.headers.get('x-empresa-id');
    const sizeError = validateJsonContentLength(request, 128 * 1024);
    if (sizeError) return sizeError;
    const body = await request.json();
    const id = typeof body.id === 'string' ? body.id : '';
    const allowedFields = [
        'tipo', 'documento', 'nome', 'nomeFantasia', 'email', 'telefone', 'inscricaoMunicipal',
        'inscricaoEstadual', 'cep', 'logradouro', 'numero', 'complemento', 'bairro', 'cidade',
        'uf', 'pais', 'codigoIbge', 'moeda', 'nif',
    ];
    const dadosAtualizacao: Record<string, any> = {};
    for (const field of allowedFields) {
        if (body[field] === undefined) continue;
        if (body[field] !== null && (typeof body[field] !== 'string' || body[field].length > 1000)) {
            return NextResponse.json({ error: `Campo ${field} invalido.` }, { status: 400 });
        }
        dadosAtualizacao[field] = body[field];
    }

    try {
        const empresaIdAlvo = await resolveEmpresaContexto(user, contextId);
        if (!empresaIdAlvo) return NextResponse.json({ error: 'Acesso negado' }, { status: 403 });

        const clienteAtual = await findTenantCustomer(id, empresaIdAlvo);

        if (!clienteAtual) return NextResponse.json({ error: 'Cliente não encontrado.' }, { status: 404 });

        if (clienteAtual.tipo === 'PJ' && clienteAtual.entidadeFiscalId) {
            if (body.tipo !== undefined && String(body.tipo).toUpperCase() !== 'PJ') {
                return NextResponse.json({ error: 'O tipo de uma identidade fiscal vinculada não pode ser alterado.' }, { status: 409 });
            }
            if (body.documento !== undefined) {
                const submitted = normalizeCustomerDocument('PJ', body.documento).documento;
                if (submitted !== clienteAtual.documento) return NextResponse.json({ error: 'O CNPJ da identidade fiscal não pode ser substituído.' }, { status: 409 });
            }
            const privateData: Record<string, string | null> = {};
            for (const [field, max] of [['email', 254], ['telefone', 30], ['inscricaoMunicipal', 30], ['inscricaoEstadual', 30]] as const) {
                if (body[field] === undefined) continue;
                // eslint-disable-next-line no-control-regex -- campos fiscais rejeitam bytes de controle.
                if (body[field] !== null && (typeof body[field] !== 'string' || body[field].length > max || /[\u0000-\u001f\u007f]/.test(body[field]))) {
                    return NextResponse.json({ error: `Campo ${field} inválido.` }, { status: 400 });
                }
                privateData[field] = typeof body[field] === 'string' && body[field].trim() ? body[field].trim() : null;
            }
            if (privateData.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(privateData.email)) return NextResponse.json({ error: 'E-mail de emissão inválido.' }, { status: 400 });
            if (privateData.email) privateData.email = privateData.email.toLowerCase();
            if (privateData.telefone) privateData.telefone = privateData.telefone.replace(/\D/g, '') || null;
            const saved = await prisma.cliente.update({ where: { id: clienteAtual.id, empresaId: empresaIdAlvo }, data: privateData,
                include: { entidadeFiscal: { include: tenantCustomerFiscalInclude } } });
            return NextResponse.json({ success: true, cliente: mergeTenantCustomer(saved) });
        }

        if (dadosAtualizacao.documento !== undefined || dadosAtualizacao.tipo !== undefined) {
            const normalizedDocument = normalizeCustomerDocument(
                dadosAtualizacao.tipo ?? clienteAtual.tipo,
                dadosAtualizacao.documento ?? clienteAtual.documento,
            );
            dadosAtualizacao.tipo = normalizedDocument.tipo;
            dadosAtualizacao.documento = normalizedDocument.documento;
        }
        
        if (dadosAtualizacao.telefone) dadosAtualizacao.telefone = dadosAtualizacao.telefone.replace(/\D/g, '');
        
        const tipoAtualizado = dadosAtualizacao.tipo || clienteAtual.tipo;
        dadosAtualizacao.semEndereco = false;

        if (dadosAtualizacao.cep) {
            dadosAtualizacao.cep = tipoAtualizado === 'EXT' ? String(dadosAtualizacao.cep).trim() : dadosAtualizacao.cep.replace(/\D/g, '');
            // Auto-recupera IBGE no PUT se tiver vindo vazio
            if (tipoAtualizado !== 'EXT' && (!dadosAtualizacao.codigoIbge || dadosAtualizacao.codigoIbge.length < 7)) {
                const ibgeEncontrado = await buscarIbgePorCep(dadosAtualizacao.cep);
                if (ibgeEncontrado) dadosAtualizacao.codigoIbge = ibgeEncontrado;
            }
        }
        
        // === LIMPEZA DE CAMPOS INVÁLIDOS PARA O BANCO ===
        const dadosEfetivos = { ...clienteAtual, ...dadosAtualizacao };
        if (tipoAtualizado !== 'EXT') {
            const erroEndereco = validarEnderecoMinimoParaEmissao(dadosEfetivos, dadosEfetivos.codigoIbge);
            if (erroEndereco) return NextResponse.json({ error: erroEndereco }, { status: 400 });
        }
        if (tipoAtualizado === 'EXT') {
            const erroExterior = validarTomadorExterior(dadosEfetivos);
            if (erroExterior) return NextResponse.json({ error: erroExterior }, { status: 400 });
            dadosAtualizacao.codigoIbge = null;
            dadosAtualizacao.moeda = String(dadosEfetivos.moeda).toUpperCase();
        }

        if ('exterior' in dadosAtualizacao) delete dadosAtualizacao.exterior;
        if ('vendas' in dadosAtualizacao) delete dadosAtualizacao.vendas;
        if ('createdAt' in dadosAtualizacao) delete dadosAtualizacao.createdAt;
        if ('updatedAt' in dadosAtualizacao) delete dadosAtualizacao.updatedAt;
        if ('_count' in dadosAtualizacao) delete dadosAtualizacao._count;
        if ('nomeValidadoPortal' in dadosAtualizacao) delete dadosAtualizacao.nomeValidadoPortal;

        // Só verifica duplicidade se o documento NÃO for nulo
        if (dadosAtualizacao.documento && dadosAtualizacao.documento !== clienteAtual.documento) {
             const clienteGlobalExistente = await prisma.cliente.findUnique({ where: { empresaId_documento: { empresaId: empresaIdAlvo, documento: dadosAtualizacao.documento } } });
            if (clienteGlobalExistente && clienteGlobalExistente.id !== clienteAtual.id) return NextResponse.json({ error: 'Este documento ja pertence a outro cadastro desta empresa.' }, { status: 409 });
        }

        const clienteAtualizado = await prisma.cliente.update({
            where: { id: clienteAtual.id, empresaId: empresaIdAlvo },
            data: dadosAtualizacao
        });

        return NextResponse.json({ success: true, cliente: clienteAtualizado });
    } catch (error: any) {
        return NextResponse.json({ error: error.message || 'Erro ao atualizar.' }, { status: 500 });
    }
}, { maxBodyBytes: 128 * 1024 });
