import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { getAuthenticatedUser, forbidden } from '@/app/utils/api-middleware';
import { stripUserSecrets } from '@/app/utils/safe-data';

const prisma = new PrismaClient();

// GET: Buscar detalhes completos (incluindo empresas vinculadas se for contador)
export async function GET(request: Request, { params }: { params: { id: string } }) {
    const admin = await getAuthenticatedUser(request);
    if (!admin || !['MASTER', 'ADMIN'].includes(admin.role)) return forbidden();

    try {
        const user = await prisma.user.findUnique({
            where: { id: params.id },
            include: {
                empresa: true,
                empresasContabeis: {
                    include: { empresa: true }
                },
                // === CORREÇÃO 1: O nome correto da relação no seu schema é historicoPlanos ===
                historicoPlanos: {
                    where: { status: 'ATIVO' },
                    include: { plan: true }
                }
            }
        });
        
        if (!user) return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 });
        
        // @ts-ignore
        const { historicoPlanos, ...safeUser } = user;
        
        // Mapeamos de volta para planHistories para o seu Frontend não quebrar
        return NextResponse.json({ ...stripUserSecrets(safeUser), planHistories: historicoPlanos });
    } catch (error) {
        return NextResponse.json({ error: 'Erro ao buscar' }, { status: 500 });
    }
}

// PATCH: Atualizar dados específicos e Auto-Gerar Plano Parceiro
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
    const admin = await getAuthenticatedUser(request);
    if (!admin || !['MASTER', 'ADMIN'].includes(admin.role)) return forbidden();

    try {
        const body = await request.json();
        const { limiteEmpresas, role, limiteNotas, limiteClientes } = body;

        const userAtual = await prisma.user.findUnique({ where: { id: params.id } });
        if (!userAtual) return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 });

        const data: any = {};
        if (role) data.role = role;
        if (limiteEmpresas !== undefined) data.limiteEmpresas = parseInt(limiteEmpresas);

        const updated = await prisma.user.update({
            where: { id: params.id },
            data
        });

        // === AUTO-VÍNCULO DA EMPRESA PRÓPRIA ===
        if (role === 'CONTADOR' && userAtual.role !== 'CONTADOR' && userAtual.empresaId) {
            const vinculoExiste = await prisma.contadorVinculo.findUnique({
                where: { contadorId_empresaId: { contadorId: updated.id, empresaId: userAtual.empresaId } }
            });
            if (!vinculoExiste) {
                await prisma.contadorVinculo.create({
                    data: { contadorId: updated.id, empresaId: userAtual.empresaId, status: 'APROVADO' }
                });
            }
        }

        // === AUTO-GERAÇÃO DO PLANO PARCEIRO ===
        if (role === 'CONTADOR' && (limiteNotas !== undefined || limiteClientes !== undefined)) {
            
            let planoParceiro = await prisma.plan.findFirst({
                where: { slug: 'parceiro-contabil', tipo: 'CUSTOM' }
            });

            if (!planoParceiro) {
                planoParceiro = await prisma.plan.create({
                    data: {
                        name: 'Parceiro Contábil',
                        slug: 'parceiro-contabil',
                        description: 'Plano customizado para contadores parceiros.',
                        priceMonthly: 0,
                        priceYearly: 0,
                        features: '[]',
                        maxNotasMensal: 0, 
                        maxClientes: 0,    
                        tipo: 'CUSTOM',
                        active: false       // <--- AQUI ESTAVA 'ativo', MUDE PARA 'active'
                    }
                });
            }

            const historyExistente = await prisma.planHistory.findFirst({
                where: { userId: updated.id, planId: planoParceiro.id, status: 'ATIVO' }
            });

            const novoLimiteNotas = limiteNotas !== undefined ? parseInt(limiteNotas) : planoParceiro.maxNotasMensal;
            const novoLimiteClientes = limiteClientes !== undefined ? parseInt(limiteClientes) : planoParceiro.maxClientes;

            if (historyExistente) {
                await prisma.plan.update({
                    where: { id: planoParceiro.id },
                    data: { maxNotasMensal: novoLimiteNotas, maxClientes: novoLimiteClientes }
                });
            } else {
                await prisma.planHistory.updateMany({
                    where: { userId: updated.id, status: 'ATIVO' },
                    data: { status: 'CANCELADO' }
                });

                await prisma.plan.update({
                    where: { id: planoParceiro.id },
                    data: { maxNotasMensal: novoLimiteNotas, maxClientes: novoLimiteClientes }
                });

                const dataFim = new Date();
                dataFim.setFullYear(dataFim.getFullYear() + 10); 

                await prisma.planHistory.create({
                    data: {
                        userId: updated.id,
                        planId: planoParceiro.id,
                        status: 'ATIVO',
                        dataInicio: new Date(),
                        dataFim: dataFim,
                        notasEmitidas: 0
                        // === CORREÇÃO 3: Removido 'valorPago' que não existe no seu Schema ===
                    }
                });
            }
        }

        return NextResponse.json(stripUserSecrets(updated));
    } catch (error) {
        console.error("Erro no PATCH:", error);
        return NextResponse.json({ error: 'Erro ao atualizar' }, { status: 500 });
    }
}

// PUT: Atualizar dados gerais do Usuário Comum (Vindo do Modal de Usuários)
export async function PUT(request: Request, { params }: { params: { id: string } }) {
    const admin = await getAuthenticatedUser(request);
    if (!admin || !['MASTER', 'ADMIN'].includes(admin.role)) return forbidden();

    try {
        const body = await request.json();

        const dataToUpdate: any = {};
        if (body.nome !== undefined) dataToUpdate.nome = body.nome;
        if (body.email !== undefined) dataToUpdate.email = body.email;
        if (body.status !== undefined) dataToUpdate.status = body.status;
        if (body.role !== undefined) dataToUpdate.role = body.role;

        // === ADAPTAÇÃO: INJEÇÃO AUTOMÁTICA DE PLANO PELO ADMIN ===
        // O modal (imagem) envia o campo "plano"
        if (body.plano) {
            // 1. Busca o plano real no banco (pelo ID ou pelo slug)
            const plan = await prisma.plan.findFirst({
                where: { OR: [{ id: body.plano }, { slug: body.plano }] }
            });

            if (plan) {
                // Guarda o slug no cache legado do user (opcional, para não quebrar tabelas antigas)
                dataToUpdate.plano = plan.slug; 

                // 2. Verifica se o usuário já tem EXATAMENTE este plano ativo
                const historyExistente = await prisma.planHistory.findFirst({
                    where: { userId: params.id, planId: plan.id, status: 'ATIVO' }
                });

                // Se não tiver, cria o novo histórico!
                if (!historyExistente) {
                    
                    // Como é um plano base, inativa os planos anteriores para não somar 2 planos básicos
                    if (plan.tipo === 'PLANO') {
                        const historicosAntigos = await prisma.planHistory.findMany({
                            where: { userId: params.id, status: 'ATIVO' },
                            include: { plan: true }
                        });

                        for (const hist of historicosAntigos) {
                            if (hist.plan?.tipo === 'PLANO') {
                                await prisma.planHistory.update({
                                    where: { id: hist.id },
                                    data: { status: 'CANCELADO' }
                                });
                            }
                        }
                    }

                    // Define a validade (Ex: 1 mês para planos mensais)
                    const dataFim = new Date();
                    dataFim.setMonth(dataFim.getMonth() + 1);

                    // Cria a "assinatura"
                    await prisma.planHistory.create({
                        data: {
                            userId: params.id,
                            planId: plan.id,
                            status: 'ATIVO',
                            dataInicio: new Date(),
                            dataFim: dataFim,
                            notasEmitidas: 0
                        }
                    });

                    // Reativa o status do cliente caso ele estivesse bloqueado/expirado
                    dataToUpdate.planoStatus = 'active';
                }
            } else {
                // Fallback caso seja um plano antigo não migrado
                dataToUpdate.plano = body.plano;
            }
        }

        const updatedUser = await prisma.user.update({
            where: { id: params.id },
            data: dataToUpdate
        });

        return NextResponse.json(stripUserSecrets(updatedUser));
    } catch (error) {
        console.error("Erro no PUT User:", error);
        return NextResponse.json({ error: 'Erro ao atualizar' }, { status: 500 });
    }
}
