import { withApiGuard } from '@/app/utils/api-route';
import { NextResponse } from 'next/server';
import { getAuthenticatedUser, forbidden, unauthorized } from '@/app/utils/api-middleware';
import { isSupportRole } from '@/app/utils/access-control';
import { prisma } from '@/app/utils/prisma';
import { validateJsonContentLength } from '@/app/utils/request-guards';
import { createLog } from '@/app/services/logger';

const VALID_TICKET_STATUS = ['ABERTO', 'EM_ANDAMENTO', 'AGUARDANDO_CLIENTE', 'RESOLVIDO', 'FECHADO'];
const VALID_PRIORITIES = ['BAIXA', 'MEDIA', 'ALTA', 'URGENTE', 'CRITICA'];

async function ensureSupport(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return unauthorized();
  if (!isSupportRole(user.role)) return forbidden();
  return null;
}

export const GET = withApiGuard(async function GET(request: Request, { params: routeParams }: { params: Promise<{ id: string }> }) {
  const params = await routeParams;
  const authError = await ensureSupport(request);
  if (authError) return authError;

  try {
    const ticket = await prisma.ticket.findUnique({
      where: { id: params.id },
      include: {
        solicitante: {
          select: { nome: true, email: true, empresa: { select: { razaoSocial: true, documento: true } } },
        },
        atendente: { select: { nome: true, id: true } },
        catalogItem: true,
        mensagens: {
          include: { usuario: { select: { nome: true, role: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!ticket) return NextResponse.json({ error: 'Ticket nÃ£o encontrado' }, { status: 404 });

    return NextResponse.json(ticket);
  } catch {
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
});

export const PUT = withApiGuard(async function PUT(request: Request, { params: routeParams }: { params: Promise<{ id: string }> }) {
  const params = await routeParams;
  const actor = await getAuthenticatedUser(request);
  if (!actor) return unauthorized();
  if (!isSupportRole(actor.role)) return forbidden();

  const sizeError = validateJsonContentLength(request);
  if (sizeError) return sizeError;

  const body = await request.json();
  try {
    const data: any = { updatedAt: new Date() };

    if (body.status !== undefined) {
      if (!VALID_TICKET_STATUS.includes(body.status)) {
        return NextResponse.json({ error: 'Status invalido.' }, { status: 400 });
      }
      data.status = body.status;
    }

    if (body.prioridade !== undefined) {
      if (!VALID_PRIORITIES.includes(body.prioridade)) {
        return NextResponse.json({ error: 'Prioridade invalida.' }, { status: 400 });
      }
      data.prioridade = body.prioridade;
    }

    if (body.atendenteId !== undefined) {
      if (body.atendenteId) {
        const atendente = await prisma.user.findUnique({
          where: { id: String(body.atendenteId) },
          select: { role: true },
        });
        if (!atendente || !isSupportRole(atendente.role)) {
          return NextResponse.json({ error: 'Atendente invalido.' }, { status: 400 });
        }
      }
      data.atendenteId = body.atendenteId ? String(body.atendenteId) : null;
    }

    if (body.categoria !== undefined) {
      data.categoria = body.categoria ? String(body.categoria).trim().slice(0, 120) : null;
    }

    if (body.catalogId !== undefined) {
      data.catalogId = body.catalogId ? String(body.catalogId) : null;
    }

    if (body.clientUnread !== undefined) {
      data.clientUnread = Boolean(body.clientUnread);
    }

    if (Object.keys(data).length === 1) {
      return NextResponse.json({ error: 'Nenhum campo permitido informado.' }, { status: 400 });
    }

    const updated = await prisma.ticket.update({
      where: { id: params.id },
      data,
    });
    await createLog({
      level: 'INFO',
      action: 'TICKET_UPDATED_BY_SUPPORT',
      module: 'SUPORTE',
      userId: actor.id,
      message: 'Ticket atualizado pela equipe de suporte.',
      details: { ticketId: params.id, fields: Object.keys(data).filter((key) => key !== 'updatedAt') },
    });
    return NextResponse.json(updated);
  } catch {
    return NextResponse.json({ error: 'Erro ao atualizar' }, { status: 500 });
  }
});
