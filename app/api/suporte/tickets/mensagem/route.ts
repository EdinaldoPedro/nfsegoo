import { NextResponse } from 'next/server';
import { forbidden, getAuthenticatedUser, unauthorized } from '@/app/utils/api-middleware';
import { isSupportTicketRole } from '@/app/utils/access-control';
import { prisma } from '@/app/utils/prisma';
import { normalizeBase64Attachment, validateJsonContentLength } from '@/app/utils/request-guards';

export async function POST(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return unauthorized();

  try {
    const sizeError = validateJsonContentLength(request, 7 * 1024 * 1024);
    if (sizeError) return sizeError;

    const { ticketId, mensagem, interno, anexoBase64, anexoNome } = await request.json();
    const anexo = normalizeBase64Attachment(anexoBase64, anexoNome);
    if (anexo.errorResponse) return anexo.errorResponse;

    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
      select: { id: true, solicitanteId: true },
    });

    if (!ticket) {
      return NextResponse.json({ error: 'Ticket nÃ£o encontrado.' }, { status: 404 });
    }

    const isStaff = isSupportTicketRole(user.role);

    if (!isStaff && ticket.solicitanteId !== user.id) {
      return forbidden();
    }

    if (interno && !isStaff) {
      return forbidden();
    }

    const novaMsg = await prisma.ticketMensagem.create({
      data: {
        ticketId: ticket.id,
        usuarioId: user.id,
        mensagem: mensagem || (anexo.value ? 'Enviou um anexo.' : ''),
        interno: interno || false,
        anexoBase64: anexo.value,
        anexoNome: anexo.fileName,
      },
    });

    const updateData: any = { updatedAt: new Date() };
    if (isStaff && !interno) updateData.clientUnread = true;

    await prisma.ticket.update({ where: { id: ticket.id }, data: updateData });

    return NextResponse.json(novaMsg);
  } catch {
    return NextResponse.json({ error: 'Erro ao enviar' }, { status: 500 });
  }
}
