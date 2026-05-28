import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export type TipoAcao = 'EMITIR' | 'VISUALIZAR' | 'CADASTRAR_CLIENTE';

export async function checkPlanLimits(userId: string, acao: TipoAcao = 'EMITIR') {
    // 0. Verifica se é ADMIN/STAFF (Acesso total sempre)
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { role: true, empresaId: true }
    });

    if (user && ['MASTER', 'ADMIN', 'SUPORTE', 'SUPORTE_TI'].includes(user.role)) {
        return { 
            allowed: true, historyId: 'ADMIN_BYPASS', status: 'ATIVO', 
            limiteNotas: 99999, notasUsadas: 0, limiteClientes: 99999 
        };
    }

    // 1. Busca TODOS os históricos ATIVOS (Plano Base + Pacotes Extras)
    const historicosAtivos = await prisma.planHistory.findMany({
        where: { userId, status: 'ATIVO' },
        include: { plan: true },
        orderBy: { createdAt: 'asc' } // Dá prioridade de consumo aos mais antigos
    });

    const historicosValidos = [];
    let hasBasePlanExpired = false;

    // 2. Limpeza e Validação de Expiração Automática
    for (const hist of historicosAtivos) {
        if (hist.dataFim && new Date() > hist.dataFim) {
            console.log(`[PLAN] Item ${hist.plan.name} do usuário ${userId} venceu. Expirando...`);
            
            await prisma.planHistory.update({ 
                where: { id: hist.id }, 
                data: { status: 'EXPIRADO' } 
            });
            
            if (hist.plan.tipo === 'PLANO') {
                hasBasePlanExpired = true;
            }
        } else {
            historicosValidos.push(hist);
        }
    }

    // Se o plano base expirou, atualiza o status principal do user
    if (hasBasePlanExpired) {
        await prisma.user.update({
            where: { id: userId },
            data: { planoStatus: 'expired' }
        });
    }

    // Se não sobrar NADA válido, verifica se expirou ou se nunca teve plano
    if (historicosValidos.length === 0) {
        const expirado = await prisma.planHistory.findFirst({
            where: { userId, status: 'EXPIRADO' },
            orderBy: { createdAt: 'desc' }
        });
        
        if (expirado) {
            return { allowed: false, reason: 'Seu plano expirou. Renove sua assinatura para acessar o sistema.', status: 'EXPIRADO', limiteNotas: 0, notasUsadas: 0, limiteClientes: 0 };
        }
        return { allowed: false, reason: 'Nenhum plano ou pacote ativo. Escolha um plano para começar.', status: 'INATIVO', limiteNotas: 0, notasUsadas: 0, limiteClientes: 0 };
    }

    // 3. O GRANDE CÉREBRO MATEMÁTICO (Agregação de Limites)
    let limiteNotas = 0;
    let notasUsadas = 0;
    let limiteClientes = 0;
    
    let historyIdDisponivel = historicosValidos[0].id; 
    let encontrouEspaco = false;

    for (const hist of historicosValidos) {
        limiteNotas += hist.plan.maxNotasMensal;
        notasUsadas += hist.notasEmitidas;
        limiteClientes += (hist.plan.maxClientes || 0);

        // Define qual pacote vai receber o "+1" na próxima emissão
        if (!encontrouEspaco && hist.notasEmitidas < hist.plan.maxNotasMensal) {
            historyIdDisponivel = hist.id;
            encontrouEspaco = true;
        }
    }

    // 4. Validação Fina por Ação
    if (acao === 'EMITIR') {
        if (notasUsadas >= limiteNotas) {
            return { 
                allowed: false, 
                reason: `Você atingiu o limite de ${limiteNotas} emissões mensais. Faça um upgrade ou compre um pacote extra de notas.`,
                status: 'LIMITE_ATINGIDO',
                limiteNotas,
                notasUsadas,
                limiteClientes
            };
        }
    }

    if (acao === 'CADASTRAR_CLIENTE' && limiteClientes > 0) {
        // Conta a quantidade real de clientes nas carteiras que pertencem a este utilizador
        const countClientes = await prisma.vinculoCarteira.count({
            where: {
                arquivadoEm: null,
                empresa: {
                    OR: [
                        { donoFaturamentoId: userId },
                        { id: user?.empresaId || '' }
                    ]
                }
            }
        });

        if (countClientes >= limiteClientes) {
            return { 
                allowed: false, 
                reason: `Você atingiu o limite de ${limiteClientes} clientes cadastrados na sua carteira.`,
                status: 'LIMITE_ATINGIDO',
                limiteNotas,
                notasUsadas,
                limiteClientes
            };
        }
    }

    return { 
        allowed: true, 
        historyId: historyIdDisponivel, 
        status: 'ATIVO',
        limiteNotas,
        notasUsadas,
        limiteClientes
    };
}

export async function incrementUsage(historyId: string) {
    if (historyId === 'ADMIN_BYPASS') return;
    await prisma.planHistory.update({
        where: { id: historyId },
        data: { notasEmitidas: { increment: 1 } }
    });
}
