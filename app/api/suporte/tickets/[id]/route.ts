import { withApiGuard } from '@/app/utils/api-route';
import { NextResponse } from 'next/server';
import { forbidden } from '@/app/utils/api-middleware';
import { validateRequest } from '@/app/utils/api-security';
import { prisma } from '@/app/utils/prisma';
import { createLog } from '@/app/services/logger';

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
        where: { interno: false },
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

export const GET = withApiGuard(async function GET(request: Request, { params: routeParams }: { params: Promise<{ id: string }> }) {
  const params = await routeParams;
  const { targetId, errorResponse } = await validateRequest(request);
  if (errorResponse) return errorResponse;

  try {
    const { ticket, error } = await getOwnedTicket(params.id, targetId);
    if (error) return error;

    return NextResponse.json(ticket);
  } catch {
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
});

export const PUT = withApiGuard(async function PUT(request: Request, { params: routeParams }: { params: Promise<{ id: string }> }) {
  const params = await routeParams;
  const { targetId, errorResponse } = await validateRequest(request);
  if (errorResponse) return errorResponse;

  try {
    const { ticket, error } = await getOwnedTicket(params.id, targetId);
    if (error) return error;
    void ticket;

    const body = await request.json();
    if (body.markRead === true) {
      await prisma.ticket.update({
        where: { id: params.id },
        data: { clientUnread: false },
      });
      return NextResponse.json({ success: true });
    }

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

    await createLog({
      level: 'INFO',
      action: 'TICKET_STATUS_CHANGED_BY_CLIENT',
      module: 'SUPORTE',
      userId: targetId,
      message: 'Status do ticket alterado pelo solicitante.',
      details: { ticketId: params.id, status: body.status },
    });

    return NextResponse.json(updated);
  } catch {
    return NextResponse.json({ error: 'Erro ao atualizar' }, { status: 500 });
  }
});
