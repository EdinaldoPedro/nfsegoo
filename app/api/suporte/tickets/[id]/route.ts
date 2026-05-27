import { NextResponse } from 'next/server';
import { forbidden } from '@/app/utils/api-middleware';
import { validateRequest } from '@/app/utils/api-security';
import { prisma } from '@/app/utils/prisma';

async function getOwnedTicket(ticketId: string, targetId: string) {
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    include: {
      solicitante: {
        select: {
          id: true,
          nome: true,
          email: true,
          empresa: { select: { razaoSocial: true, documento: true } },
        },
      },
      atendente: { select: { nome: true, id: true } },
      catalogItem: true,
      mensagens: {
        include: { usuario: { select: { nome: true, role: true } } },
        orderBy: { createdAt: 'asc' },
      },
    },
  });

  if (!ticket) {
    return { ticket: null, error: NextResponse.json({ error: 'Ticket nao encontrado' }, { status: 404 }) };
  }

  if (ticket.solicitanteId !== targetId) {
    return { ticket: null, error: forbidden() };
  }

  return { ticket, error: null };
}

export async function GET(request: Request, { params }: { params: { id: string } }) {
  const { targetId, errorResponse } = await validateRequest(request);
  if (errorResponse) return errorResponse;

  try {
    const { ticket, error } = await getOwnedTicket(params.id, targetId);
    if (error) return error;

    if (ticket.clientUnread) {
      await prisma.ticket.update({
        where: { id: params.id },
        data: { clientUnread: false },
      });
      ticket.clientUnread = false;
    }

    return NextResponse.json(ticket);
  } catch {
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}

export async function PUT(request: Request, { params }: { params: { id: string } }) {
  const { targetId, errorResponse } = await validateRequest(request);
  if (errorResponse) return errorResponse;

  try {
    const { ticket, error } = await getOwnedTicket(params.id, targetId);
    if (error) return error;
    void ticket;

    const body = await request.json();
    const allowedStatuses = ['RESOLVIDO', 'CANCELADO'];

    if (!allowedStatuses.includes(body.status)) {
      return NextResponse.json({ error: 'Status invalido para esta operacao.' }, { status: 400 });
    }

    const updated = await prisma.ticket.update({
      where: { id: params.id },
      data: {
        status: body.status,
        updatedAt: new Date(),
      },
    });

    return NextResponse.json(updated);
  } catch {
    return NextResponse.json({ error: 'Erro ao atualizar' }, { status: 500 });
  }
}
