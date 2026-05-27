import { NextResponse } from 'next/server';
import { getAuthenticatedUser, forbidden, unauthorized } from '@/app/utils/api-middleware';
import { isSupportRole } from '@/app/utils/access-control';
import { prisma } from '@/app/utils/prisma';

function parseMetadata(gatewayId: string | null) {
  if (!gatewayId) return {};

  try {
    return JSON.parse(gatewayId);
  } catch {
    return {};
  }
}

export async function GET(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return unauthorized();
  if (!isSupportRole(user.role)) return forbidden();

  try {
    const pedidos = await prisma.pedido.findMany({
      where: {
        formaPagamento: 'ATIVACAO_MANUAL',
        status: 'AGUARDANDO_ATIVACAO_MANUAL',
      },
      include: {
        user: {
          select: {
            id: true,
            nome: true,
            email: true,
            empresa: {
              select: {
                razaoSocial: true,
                documento: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    const payload = pedidos.map((pedido) => {
      const detalhes = parseMetadata(pedido.gatewayId);

      return {
        id: pedido.id,
        planoSlug: pedido.planoSlug,
        ciclo: pedido.ciclo,
        notasAdicionais: pedido.notasAdicionais,
        valorPlano: Number(pedido.valorPlano),
        valorAdicionais: Number(pedido.valorAdicionais),
        valorTotal: Number(pedido.valorTotal),
        status: pedido.status,
        formaPagamento: pedido.formaPagamento,
        createdAt: pedido.createdAt,
        updatedAt: pedido.updatedAt,
        user: pedido.user,
        detalhes,
      };
    });

    return NextResponse.json(payload);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Erro ao buscar pedidos' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return unauthorized();
  if (!isSupportRole(user.role)) return forbidden();

  try {
    const body = await request.json();

    if (!body.id || !body.status) {
      return NextResponse.json({ error: 'ID e status sao obrigatorios.' }, { status: 400 });
    }

    const pedido = await prisma.pedido.findUnique({ where: { id: body.id } });
    if (!pedido) {
      return NextResponse.json({ error: 'Pedido nao encontrado.' }, { status: 404 });
    }

    const detalhes = parseMetadata(pedido.gatewayId);
    const atualizado = await prisma.pedido.update({
      where: { id: body.id },
      data: {
        status: body.status,
        gatewayId: JSON.stringify({
          ...detalhes,
          processadoPor: user.id,
          processadoEm: new Date().toISOString(),
          observacaoInterna: body.observacao || null,
        }),
      },
    });

    return NextResponse.json({
      success: true,
      pedido: {
        id: atualizado.id,
        status: atualizado.status,
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Erro ao atualizar pedido' }, { status: 500 });
  }
}
