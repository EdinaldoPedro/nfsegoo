import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { validateRequest } from '@/app/utils/api-security';

export const dynamic = 'force-dynamic';

const prisma = new PrismaClient();

export async function GET(request: Request, { params }: { params: { id: string } }) {
  // 1. Usa a validação padrão de segurança do sistema
  const { targetId, errorResponse } = await validateRequest(request);
  if (errorResponse) return errorResponse;

  const contextId = request.headers.get('x-empresa-id');

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
    const isStaff = ['MASTER', 'ADMIN', 'SUPORTE', 'SUPORTE_TI'].includes(user?.role || '');

    let hasAccess = false;
    if (isStaff) {
        hasAccess = true;
    } else if (contextId && venda.empresaId === contextId) {
        const vinculo = await prisma.contadorVinculo.findUnique({
            where: { contadorId_empresaId: { contadorId: targetId, empresaId: contextId } }
        });
        if (vinculo && vinculo.status === 'APROVADO') hasAccess = true;
    } else if (venda.empresaId === user?.empresaId) {
        hasAccess = true;
    }

    if (!hasAccess) {
        return NextResponse.json({ error: 'Não autorizado a ver esta venda.' }, { status: 403 });
    }

    // --- LÓGICA DE RECUPERAÇÃO DE DADOS (CORREÇÃO 2: Puxar TUDO) ---
    let cnaeRecuperado = null;
    let valorMoedaEstrangeira = null;
    let issRetido = null;
    let inssRetido = null;
    let aliquota = null;
    let dataCompetencia = null;
    
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

            // Extrai todos os campos extras que não ficam na tabela Venda
            if (payload?.servico) {
                if (!cnaeRecuperado) cnaeRecuperado = payload.servico.cnae || payload.servico.codigoCnae || null;
                valorMoedaEstrangeira = payload.servico.valorMoedaEstrangeira || null;
                issRetido = payload.servico.issRetido;
                aliquota = payload.servico.aliquota;
                
                // PIS, COFINS, CSLL e IR (Adicionando a recuperação para o Corrigir)
                // Se esses campos existirem no seu payload original, eles serão restaurados aqui
                if (payload.servico.retencoes) {
                    inssRetido = payload.servico.retencoes.inss?.retido || payload.servico.inssRetido;
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
        dataCompetencia
    });

  } catch (error) {
    return NextResponse.json({ error: 'Erro ao buscar venda' }, { status: 500 });
  }
}
