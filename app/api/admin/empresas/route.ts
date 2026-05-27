import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { getAuthenticatedUser, forbidden, unauthorized } from '@/app/utils/api-middleware';
import { stripEmpresaSecrets } from '@/app/utils/safe-data';

const prisma = new PrismaClient();

// GET: Lista Empresas (Emissores) ou Clientes (Tomadores Globais)
export async function GET(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return unauthorized();
  if (!['MASTER', 'ADMIN'].includes(user.role)) return forbidden();

  const { searchParams } = new URL(request.url);
  const page = parseInt(searchParams.get('page') || '1');
  const limit = parseInt(searchParams.get('limit') || '10');
  const search = searchParams.get('search') || '';
  const type = searchParams.get('type') || 'PRESTADOR'; // 'PRESTADOR' | 'TOMADOR'

  const skip = (page - 1) * limit;

  try {
    let data = [];
    let total = 0;

    if (type === 'TOMADOR') {
        // === MODO TOMADOR: Busca Global na Tabela CLIENTE ===
        // Agora buscamos DIRETO na tabela Cliente, pois ela é global
        const whereClause: any = search ? {
            OR: [
                { nome: { contains: search, mode: 'insensitive' } },
                { documento: { contains: search } },
                { email: { contains: search, mode: 'insensitive' } }
            ]
        } : {};

        const [clientes, count] = await prisma.$transaction([
            prisma.cliente.findMany({
                where: whereClause,
                skip,
                take: limit,
                include: { 
                    // Mostra quantos vínculos este cliente tem (Quantas empresas o atendem)
                    _count: { select: { vinculos: true } },
                    // Opcional: Traz o primeiro vínculo para exibir "Ex: Vinculado a X"
                    vinculos: {
                        take: 1,
                        include: { empresa: { select: { razaoSocial: true, documento: true } } }
                    }
                },
                orderBy: { nome: 'asc' }
            }),
            prisma.cliente.count({ where: whereClause })
        ]);

        data = clientes.map(c => ({
            ...c,
            id: c.id,
            razaoSocial: c.nome, // Padroniza nome para a tabela visual
            documento: c.documento,
            origem: 'TOMADOR',
            // Mostra a primeira empresa vinculada como referência visual
            vinculo: c.vinculos[0]?.empresa || null,
            totalVinculos: c._count.vinculos
        }));
        total = count;

    } else {
        // === MODO PRESTADOR: Busca na tabela EMPRESA (Seus Assinantes) ===
        const whereClause: any = search ? {
            OR: [
                { razaoSocial: { contains: search, mode: 'insensitive' } }, 
                { documento: { contains: search } },
                { donoUser: { nome: { contains: search, mode: 'insensitive' } } },
                { donoUser: { email: { contains: search, mode: 'insensitive' } } }
            ]
        } : {};

        const [empresas, count] = await prisma.$transaction([
            prisma.empresa.findMany({
                where: whereClause,
                skip,
                take: limit,
                include: { 
                    donoUser: { select: { nome: true, email: true } },
                    // ADICIONE ESTA PARTE:
                    minhaCarteira: {
                        include: { cliente: { select: { id: true, nome: true, documento: true } } }
                    }
                },
                orderBy: { updatedAt: 'desc' }
            }),
            prisma.cliente.count({ where: whereClause }) // Corrija aqui para contar empresas se necessário
        ]);

        data = empresas.map(emp => {
            // Removemos os dados sensíveis antes de enviar para o Frontend Admin
            return {
                ...stripEmpresaSecrets(emp),
                origem: 'PRESTADOR',
                donos: emp.donoUser ? [emp.donoUser] : [],
                clientesVinculados: emp.minhaCarteira.map((v: any) => v.cliente)
            };
        });
        total = count;
    }

    return NextResponse.json({
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      }
    });

  } catch (error) {
    console.error("Erro API Admin Empresas:", error);
    return NextResponse.json({ error: 'Erro ao buscar dados.' }, { status: 500 });
  }
}

// PUT: Edita cadastro (Unificado)
export async function PUT(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user || !['MASTER', 'ADMIN'].includes(user.role)) return forbidden();

  try {
    const body = await request.json();
    const { id, origem, ...dados } = body; 

    // Limpeza de campos relacionais/virtuais
    const cleanData = { ...dados };
    delete cleanData.vinculo;
    delete cleanData.vinculos;
    delete cleanData.totalVinculos;
    delete cleanData.donos;
    delete cleanData.donoUser;
    delete cleanData._count;
    delete cleanData.qtdNotas;

    if (origem === 'TOMADOR') {
        if (cleanData.razaoSocial) {
            cleanData.nome = cleanData.razaoSocial;
            delete cleanData.razaoSocial;
        }
        delete cleanData.nomeFantasia; 
        
        const updated = await prisma.cliente.update({
            where: { id },
            data: cleanData
        });
        return NextResponse.json(updated);
    } else {
        const updated = await prisma.empresa.update({
            where: { id },
            data: cleanData
        });
        return NextResponse.json(stripEmpresaSecrets(updated));
    }
  } catch (e: any) {
    return NextResponse.json({ error: 'Erro ao atualizar: ' + e.message }, { status: 500 });
  }
}

// DELETE: Excluir (Unificado)
export async function DELETE(request: Request) {
    const user = await getAuthenticatedUser(request);
    if (!user || !['MASTER', 'ADMIN'].includes(user.role)) return forbidden();

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id'); // ID da Empresa ou do Cliente
    const type = searchParams.get('type') || 'PRESTADOR'; 
    const clienteId = searchParams.get('clienteId'); // ID do cliente para desvincular
    const action = searchParams.get('action'); // 'UNBIND'

    if (!id) return NextResponse.json({ error: 'ID necessário' }, { status: 400 });

    try {
        // === CASO 1: APENAS DESVINCULAR UM CLIENTE DE UMA EMPRESA ===
        if (action === 'UNBIND' && clienteId) {
            await prisma.vinculoCarteira.delete({
                where: {
                    empresaId_clienteId: {
                        empresaId: id,
                        clienteId: clienteId
                    }
                }
            });
            return NextResponse.json({ success: true, message: 'Vínculo removido com sucesso.' });
        }

        // === CASO 2: EXCLUSÃO TOTAL (TOMADOR OU PRESTADOR) ===
        if (type === 'TOMADOR') {
            // Apaga Cliente Global e todos os seus vínculos/históricos
            await prisma.notaFiscal.deleteMany({ where: { clienteId: id } });
            await prisma.venda.deleteMany({ where: { clienteId: id } });
            await prisma.vinculoCarteira.deleteMany({ where: { clienteId: id } });
            await prisma.cliente.delete({ where: { id } });
        } else {
            // Apaga Prestador (Empresa Assinante) e limpa relações
            await prisma.user.updateMany({ where: { empresaId: id }, data: { empresaId: null } });
            await prisma.userCliente.deleteMany({ where: { empresaId: id } });
            await prisma.contadorVinculo.deleteMany({ where: { empresaId: id } });
            await prisma.systemLog.deleteMany({ where: { empresaId: id } });
            await prisma.cnae.deleteMany({ where: { empresaId: id } });
            await prisma.notaFiscal.deleteMany({ where: { empresaId: id } });
            await prisma.venda.deleteMany({ where: { empresaId: id } });
            await prisma.vinculoCarteira.deleteMany({ where: { empresaId: id } });
            
            await prisma.empresa.delete({ where: { id } });
        }

        return NextResponse.json({ success: true });

    } catch (e: any) {
        console.error("Erro na exclusão/desvínculo Admin:", e);
        return NextResponse.json({ 
            error: 'Erro ao processar a ação: ' + (e.message || 'Erro interno') 
        }, { status: 500 });
    }
}
