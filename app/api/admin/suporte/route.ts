import { NextResponse } from 'next/server';
import { getAuthenticatedUser, forbidden, unauthorized } from '@/app/utils/api-middleware';
import { isSupportRole } from '@/app/utils/access-control';
import { prisma } from '@/app/utils/prisma';

export async function GET(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return unauthorized();
  if (!isSupportRole(user.role)) return forbidden();

  try {
    const tickets = await prisma.ticket.findMany({
      where: { arquivadoEm: null } as any,
      include: {
        solicitante: { select: { nome: true, email: true } },
        atendente: { select: { nome: true, id: true } },
        _count: { select: { mensagens: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });

    return NextResponse.json(tickets);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Erro ao buscar tickets' }, { status: 500 });
  }
}
