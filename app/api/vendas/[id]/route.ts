import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { validateRequest } from '@/app/utils/api-security';
import { hasEmpresaAccess } from '@/app/utils/access-control';

export const dynamic = 'force-dynamic';

const prisma = new PrismaClient();

function parseJsonObject(value: unknown) {
    if (!value) return null;
    if (typeof value === 'object') return value as any;
    if (typeof value !== 'string') return null;

    try {
        const parsed = JSON.parse(value);
        if (typeof parsed === 'string') return parseJsonObject(parsed);
        return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
        return null;
    }
}

function firstDefined(...values: any[]) {
    return values.find((value) => value !== undefined && value !== null && value !== '');
}

function extractRecoveryFields(payload: any) {
    if (!payload || typeof payload !== 'object') return {};
    const servico = payload.servico || {};
    const retencoes = payload.retencoes || servico.retencoes || {};

    return {
        cnae: firstDefined(payload.codigoCnae, servico.codigoCnae, servico.cnae),
        valorMoedaEstrangeira: firstDefined(payload.valorMoedaEstrangeira, servico.valorMoedaEstrangeira),
        issRetido: firstDefined(payload.issRetido, servico.issRetido),
        aliquota: firstDefined(payload.aliquota, servico.aliquota),
        inssRetido: firstDefined(retencoes.inss?.retido, servico.inssRetido),
        dataCompetencia: firstDefined(payload.dataCompetencia, servico.dataCompetencia),
        numeroDPS: firstDefined(payload.numeroDPS, payload.meta?.numeroDPS, payload.meta?.numero),
        serieDPS: firstDefined(payload.serieDPS, payload.meta?.serieDPS, payload.meta?.serie),
    };
}

function applyRecoveredFields(current: any, payload: any) {
    const recovered = extractRecoveryFields(payload);
    return {
        cnaeRecuperado: firstDefined(current.cnaeRecuperado, recovered.cnae) || null,
        valorMoedaEstrangeira: firstDefined(current.valorMoedaEstrangeira, recovered.valorMoedaEstrangeira) || null,
        issRetido: firstDefined(current.issRetido, recovered.issRetido) ?? null,
        inssRetido: firstDefined(current.inssRetido, recovered.inssRetido) ?? null,
        aliquota: firstDefined(current.aliquota, recovered.aliquota) || null,
        dataCompetencia: firstDefined(current.dataCompetencia, recovered.dataCompetencia) || null,
        numeroDPS: firstDefined(current.numeroDPS, recovered.numeroDPS) || null,
        serieDPS: firstDefined(current.serieDPS, recovered.serieDPS) || null,
    };
}

export async function GET(request: Request, { params }: { params: { id: string } }) {
  // 1. Usa a validação padrão de segurança do sistema
  const { targetId, errorResponse } = await validateRequest(request);
  if (errorResponse) return errorResponse;

  try {
    const venda = await prisma.venda.findUnique({
      where: { id: params.id },
      include: { 
          cliente: true,
          notas: {
              orderBy: { createdAt: 'desc' },
          },
          logs: {
              where: { action: 'EMISSAO_INICIADA' }, // <--- CORREÇÃO 1: Nome da Ação do Log
              orderBy: { createdAt: 'desc' },
              take: 1
          }
      }
    });

    if (!venda) return NextResponse.json({ error: 'Venda não encontrada' }, { status: 404 });

    // 2. Validação de Acesso Flexível
    const user = await prisma.user.findUnique({ where: { id: targetId }});
    const hasAccess = user ? await hasEmpresaAccess(user, venda.empresaId) : false;

    if (!hasAccess) {
        return NextResponse.json({ error: 'Não autorizado a ver esta venda.' }, { status: 403 });
    }

    // --- LÓGICA DE RECUPERAÇÃO DE DADOS (CORREÇÃO 2: Puxar TUDO) ---
    const jobsRecuperacao = (prisma as any).emissaoJob
        ? await (prisma as any).emissaoJob.findMany({
            where: { vendaId: venda.id },
            orderBy: { createdAt: 'asc' },
            select: { payloadJson: true },
          })
        : [];

    let cnaeRecuperado = null;
    let valorMoedaEstrangeira = null;
    let issRetido = null;
    let inssRetido = null;
    let aliquota = null;
    let dataCompetencia = null;
    let numeroDPS = null;
    let serieDPS = null;

    for (const job of jobsRecuperacao) {
        const jobPayload = parseJsonObject(job?.payloadJson);
        if (!jobPayload) continue;
        const recovered = applyRecoveredFields({
            cnaeRecuperado,
            valorMoedaEstrangeira,
            issRetido,
            inssRetido,
            aliquota,
            dataCompetencia,
            numeroDPS,
            serieDPS,
        }, jobPayload);
        cnaeRecuperado = recovered.cnaeRecuperado;
        valorMoedaEstrangeira = recovered.valorMoedaEstrangeira;
        issRetido = recovered.issRetido;
        inssRetido = recovered.inssRetido;
        aliquota = recovered.aliquota;
        dataCompetencia = recovered.dataCompetencia;
        numeroDPS = recovered.numeroDPS;
        serieDPS = recovered.serieDPS;
    }
    
    if (venda.logs.length > 0 && venda.logs[0].details) {
        try {
            let details: any = venda.logs[0].details; // Forçamos o início como any
            
            if (typeof details === 'string') {
                try { 
                    const parsed = JSON.parse(details); 
                    // Se o resultado do parse for um objeto, usamos ele, senão mantemos o original
                    details = (parsed && typeof parsed === 'object') ? parsed : details;
                    
                    // Tratamento para JSON duplo (comum em alguns bancos de dados)
                    if (typeof details === 'string') {
                        details = JSON.parse(details);
                    }
                } catch(e) {}
            }
            
            // Agora o TypeScript não vai reclamar, pois 'details' é tratado como objeto/any
            const payload = details?.payloadOriginal || details;
            const recovered = applyRecoveredFields({
                cnaeRecuperado,
                valorMoedaEstrangeira,
                issRetido,
                inssRetido,
                aliquota,
                dataCompetencia,
                numeroDPS,
                serieDPS,
            }, payload);
            cnaeRecuperado = recovered.cnaeRecuperado;
            valorMoedaEstrangeira = recovered.valorMoedaEstrangeira;
            issRetido = recovered.issRetido;
            inssRetido = recovered.inssRetido;
            aliquota = recovered.aliquota;
            dataCompetencia = recovered.dataCompetencia;
            numeroDPS = recovered.numeroDPS;
            serieDPS = recovered.serieDPS;

            // Extrai todos os campos extras que não ficam na tabela Venda
            if (payload?.servico) {
                if (!cnaeRecuperado) cnaeRecuperado = payload.servico.cnae || payload.servico.codigoCnae || null;
                valorMoedaEstrangeira = firstDefined(valorMoedaEstrangeira, payload.servico.valorMoedaEstrangeira) || null;
                issRetido = firstDefined(issRetido, payload.servico.issRetido) ?? null;
                aliquota = firstDefined(aliquota, payload.servico.aliquota) || null;
                
                // PIS, COFINS, CSLL e IR (Adicionando a recuperação para o Corrigir)
                // Se esses campos existirem no seu payload original, eles serão restaurados aqui
                if (payload.servico.retencoes) {
                    inssRetido = firstDefined(inssRetido, payload.servico.retencoes.inss?.retido, payload.servico.inssRetido) ?? null;
                    // Você pode adicionar PIS/COFINS aqui se o seu nfData já os suportar
                }
            }
            if (payload?.dataCompetencia) {
                dataCompetencia = payload.dataCompetencia;
            }
        } catch (e) { 
            console.error("Erro ao processar log de recuperação:", e); 
        }
    }

    // Retorna todos os dados "injetados" na venda para o Frontend
    return NextResponse.json({ 
        ...venda, 
        cnaeRecuperado,
        valorMoedaEstrangeira,
        issRetido,
        inssRetido,
        aliquota,
        dataCompetencia,
        numeroDPS,
        serieDPS
    });

  } catch (error) {
    return NextResponse.json({ error: 'Erro ao buscar venda' }, { status: 500 });
  }
}
