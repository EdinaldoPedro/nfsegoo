import { NextResponse } from 'next/server';
import { forbidden, getAuthenticatedUser, unauthorized } from '@/app/utils/api-middleware';
import { isSupportTicketRole } from '@/app/utils/access-control';
import { prisma } from '@/app/utils/prisma';
import { normalizeBase64Attachment, validateJsonContentLength } from '@/app/utils/request-guards';
import { EmailService } from '@/app/services/EmailService';

function appLink(path: string) {
  const base = process.env.NEXT_PUBLIC_APP_URL || '';
  return base ? `${base.replace(/\/$/, '')}${path}` : path;
}

function excerpt(value: string) {
  const clean = value.replace(/\s+/g, ' ').trim();
  return clean.length > 180 ? `${clean.slice(0, 177)}...` : clean;
}

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
      select: {
        id: true,
        protocolo: true,
        assunto: true,
        solicitanteId: true,
        solicitante: { select: { nome: true, email: true } },
      },
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

    if (!interno) {
      const emailService = new EmailService();
      const trecho = excerpt(mensagem || (anexo.value ? 'Anexo enviado.' : 'Nova resposta no ticket.'));

      if (isStaff && ticket.solicitante.email) {
        await emailService.sendEmail(
          ticket.solicitante.email,
          `Nova resposta no ticket #${ticket.protocolo}`,
          emailService.getTemplateRespostaSuporte({
            nome: ticket.solicitante.nome,
            protocolo: ticket.protocolo,
            assunto: ticket.assunto,
            trecho,
            remetente: user.nome,
            link: appLink(`/suporte/${ticket.id}`),
          }),
        );
      } else if (!isStaff && process.env.SUPPORT_EMAIL) {
        await emailService.sendEmail(
          process.env.SUPPORT_EMAIL,
          `Cliente respondeu o ticket #${ticket.protocolo}`,
          emailService.getTemplateRespostaSuporte({
            nome: 'Equipe',
            protocolo: ticket.protocolo,
            assunto: ticket.assunto,
            trecho,
            remetente: user.nome,
            link: appLink(`/admin/suporte/${ticket.id}`),
          }),
        );
      }
    }

    return NextResponse.json(novaMsg);
  } catch {
    return NextResponse.json({ error: 'Erro ao enviar' }, { status: 500 });
  }
}
