import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export type TipoAcao = 'EMITIR' | 'VISUALIZAR' | 'CADASTRAR_CLIENTE';

function inicioDoMes(data = new Date()) {
    return new Date(data.getFullYear(), data.getMonth(), 1);
}

export async function renovarUsoMensalSeNecessario(userId: string) {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { dataRenovacaoCiclo: true, empresaId: true }
    });

    if (!user) return;

    const mesAtual = inicioDoMes();
    const ultimaRenovacao = user.dataRenovacaoCiclo ? inicioDoMes(user.dataRenovacaoCiclo) : null;

    if (ultimaRenovacao && ultimaRenovacao >= mesAtual) return;

    const historicosAtivos = await prisma.planHistory.findMany({
        where: { userId, status: 'ATIVO' },
        include: { plan: true },
        orderBy: { createdAt: 'asc' }
    });

    const notasAutorizadasMes = await prisma.notaFiscal.count({
        where: {
            status: 'AUTORIZADA',
            arquivadoEm: null,
            createdAt: { gte: mesAtual },
            empresa: {
                OR: [
                    { donoFaturamentoId: userId },
                    { proprietarioUserId: userId } as any,
                    { id: user.empresaId || '' },
                    { contadoresLink: { some: { contadorId: userId, status: 'APROVADO', arquivadoEm: null } } }
                ]
            }
        } as any
    });

    let restante = notasAutorizadasMes;
    const updates = historicosAtivos.map((hist) => {
        const limite = hist.plan.maxNotasMensal || 0;
        const uso = limite > 0 ? Math.min(restante, limite) : 0;
        restante = Math.max(0, restante - uso);

        return prisma.planHistory.update({
            where: { id: hist.id },
            data: { notasEmitidas: uso }
        });
    });

    await prisma.$transaction([
        ...updates,
        prisma.user.update({
            where: { id: userId },
            data: { dataRenovacaoCiclo: mesAtual }
        })
    ]);
}

export async function resolveBillingUserId(params: {
    empresaId: string;
    actorUserId: string;
    acao?: TipoAcao;
}) {
    const { empresaId, actorUserId } = params;

    const [empresa, actor] = await Promise.all([
        prisma.empresa.findUnique({
            where: { id: empresaId },
            select: {
                id: true,
                donoFaturamentoId: true,
                proprietarioUserId: true,
                modoCobranca: true,
                contadorCustodianteId: true
            } as any
        }),
        prisma.user.findUnique({
            where: { id: actorUserId },
            select: { id: true, role: true }
        })
    ]);

    if (!empresa) {
        throw new Error('Empresa nÃ£o encontrada para resolver cobranÃ§a.');
    }

    if ((empresa as any).modoCobranca === 'POR_OPERADOR') {
        return actorUserId;
    }

    if ((empresa as any).donoFaturamentoId) {
        return (empresa as any).donoFaturamentoId as string;
    }

    if ((empresa as any).proprietarioUserId) {
        return (empresa as any).proprietarioUserId as string;
    }

    const donoEmpresa = await prisma.user.findFirst({
        where: { empresaId, role: { notIn: ['CONTADOR', 'SUPORTE', 'SUPORTE_TI'] } },
        orderBy: { createdAt: 'asc' },
        select: { id: true }
    });

    if (donoEmpresa) {
        return donoEmpresa.id;
    }

    if ((empresa as any).contadorCustodianteId) {
        return (empresa as any).contadorCustodianteId as string;
    }

    if (actor?.role === 'CONTADOR') {
        return actorUserId;
    }

    return actorUserId;
}

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
    await renovarUsoMensalSeNecessario(userId);

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
                        { proprietarioUserId: userId } as any,
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
