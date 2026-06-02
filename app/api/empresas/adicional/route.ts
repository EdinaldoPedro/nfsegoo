import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { validateRequest } from '@/app/utils/api-security';

const prisma = new PrismaClient();

export async function POST(request: Request) {
    const { targetId, errorResponse } = await validateRequest(request);
    if (errorResponse) return errorResponse;

    const userId = targetId;
    if (!userId) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });

    try {
        const body = await request.json();
        const { razaoSocial, documento } = body;

        if (!razaoSocial || !documento) {
            return NextResponse.json({ error: 'Razão Social e CNPJ são obrigatórios.' }, { status: 400 });
        }

        const cnpjLimpo = documento.replace(/\D/g, '');
        if (cnpjLimpo.length !== 14) {
            return NextResponse.json({ error: 'CNPJ inválido.' }, { status: 400 });
        }

        // 1. Validar se o utilizador tem limite de "PJs Adicionais" disponível
        const user = await prisma.user.findUnique({
            where: { id: userId },
            include: { empresasFaturadas: true }
        });

        if (!user) return NextResponse.json({ error: 'Utilizador não encontrado' }, { status: 404 });

        // Quantas empresas ele já tem como "Dono" (excluindo a primária para cálculo mais seguro)
        const empresasExtrasUsadas = user.empresasFaturadas.filter(e => e.id !== user.empresaId).length;

        if (empresasExtrasUsadas >= user.empresasAdicionais) {
            return NextResponse.json({ 
                error: 'Limite de empresas atingido. Compre mais um pacote PJ Adicional para vincular novos CNPJs.' 
            }, { status: 403 });
        }

        // 2. Verificar se a empresa já existe no sistema
        const empresaExistente = await prisma.empresa.findUnique({
            where: { documento: cnpjLimpo }
        });

        if (empresaExistente) {
            if ((empresaExistente as any).proprietarioUserId === userId || empresaExistente.donoFaturamentoId === userId) {
                 return NextResponse.json({ error: 'Você já possui esta empresa vinculada à sua conta.' }, { status: 400 });
            }
            if ((empresaExistente as any).proprietarioUserId || empresaExistente.donoFaturamentoId) {
                return NextResponse.json({ error: 'Este CNPJ já está vinculado a outro utilizador no sistema.' }, { status: 400 });
            }
            
            // Se existir mas for orfã, assume a autoria
            await prisma.empresa.update({
                where: { id: empresaExistente.id },
                data: {
                    donoFaturamentoId: userId,
                    proprietarioUserId: userId,
                    statusPropriedade: 'PROPRIETARIA'
                } as any
            });

            return NextResponse.json({ success: true, message: 'Empresa vinculada com sucesso!' }, { status: 200 });
        }

        // 3. Criar a nova empresa e amarrá-la ao Faturamento do Utilizador (Umbrella Billing)
        const novaEmpresa = await prisma.empresa.create({
            data: {
                documento: cnpjLimpo,
                razaoSocial: razaoSocial,
                donoFaturamentoId: userId,
                proprietarioUserId: userId,
                statusPropriedade: 'PROPRIETARIA',
                cadastroCompleto: false
            } as any
        });

        return NextResponse.json({ success: true, empresa: novaEmpresa }, { status: 201 });

    } catch (error: any) {
        console.error("Erro ao vincular empresa adicional:", error);
        return NextResponse.json({ error: 'Erro interno ao tentar vincular a empresa.' }, { status: 500 });
    }
}
