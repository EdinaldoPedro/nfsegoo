import { withApiGuard } from '@/app/utils/api-route';
import { NextResponse } from 'next/server';
import { forbidden } from '@/app/utils/api-middleware';
import { isSupportTicketRole } from '@/app/utils/access-control';
import { prisma } from '@/app/utils/prisma';
import { normalizeBase64Attachment, validateJsonContentLength } from '@/app/utils/request-guards';
import { EmailService } from '@/app/services/EmailService';
import { validateRequest } from '@/app/utils/api-security';
import { createLog } from '@/app/services/logger';

function appLink(path: string) {
  const base = process.env.NEXT_PUBLIC_APP_URL || '';
  return base ? `${base.replace(/\/$/, '')}${path}` : path;
}

function excerpt(value: string) {
  const clean = value.replace(/\s+/g, ' ').trim();
  return clean.length > 180 ? `${clean.slice(0, 177)}...` : clean;
}

export const POST = withApiGuard(async function POST(request: Request) {
  const { user, targetId, errorResponse } = await validateRequest(request);
  if (errorResponse) return errorResponse;
  if (!user) return NextResponse.json({ error: 'Nao autorizado.' }, { status: 401 });

  try {
    const sizeError = validateJsonContentLength(request, 7 * 1024 * 1024);
    if (sizeError) return sizeError;

    const { ticketId, mensagem, interno, anexoBase64, anexoNome } = await request.json();
    const mensagemLimpa = String(mensagem || '').trim();
    if (!ticketId || mensagemLimpa.length > 10_000) {
      return NextResponse.json({ error: 'Ticket invalido ou mensagem acima do limite permitido.' }, { status: 400 });
    }
    const anexo = normalizeBase64Attachment(anexoBase64, anexoNome);
    if (anexo.errorResponse) return anexo.errorResponse;
    if (!mensagemLimpa && !anexo.value) {
      return NextResponse.json({ error: 'Informe uma mensagem ou anexo.' }, { status: 400 });
    }

    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
      select: {
        id: true,
        protocolo: true,
        assunto: true,
        solicitanteId: true,
        solicitante: { select: { nome: true, email: true, notificacoesEmail: true } },
      },
    });

    if (!ticket) {
      return NextResponse.json({ error: 'Ticket nÃ£o encontrado.' }, { status: 404 });
    }

    // A staff account using the customer portal voluntarily narrows its scope
    // to its own tickets; the header can never expand privileges.
    const isStaff = request.headers.get('x-portal-mode') !== 'customer' && isSupportTicketRole(user.role);

    if (!isStaff && ticket.solicitanteId !== targetId) {
      return forbidden();
    }

    if (interno && !isStaff) {
      return forbidden();
    }

    const novaMsg = await prisma.ticketMensagem.create({
      data: {
        ticketId: ticket.id,
        usuarioId: user.id,
        mensagem: mensagemLimpa || (anexo.value ? 'Enviou um anexo.' : ''),
        interno: Boolean(interno),
        anexoBase64: anexo.value,
        anexoNome: anexo.fileName,
      },
    });

    const updateData: any = { updatedAt: new Date() };
    if (isStaff && !interno) updateData.clientUnread = true;

    await prisma.ticket.update({ where: { id: ticket.id }, data: updateData });

    if (!interno) {
      const emailService = new EmailService();
      const trecho = excerpt(mensagemLimpa || (anexo.value ? 'Anexo enviado.' : 'Nova resposta no ticket.'));

      if (isStaff && ticket.solicitante.email && ticket.solicitante.notificacoesEmail) {
        await emailService.sendEmail(
          ticket.solicitante.email,
          `Nova resposta no ticket #${ticket.protocolo}`,
          emailService.getTemplateRespostaSuporte({
            nome: ticket.solicitante.nome,
            protocolo: ticket.protocolo,
            assunto: ticket.assunto,
            trecho,
            remetente: user.nome,
            link: appLink(`/cliente/suporte/${ticket.id}`),
          }),
          [], { userId: ticket.solicitanteId, requestPath: '/api/suporte/tickets/mensagem', module: 'SUPORTE',
            dedupKey: `ticket-message:${novaMsg.id}:titular` },
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
          [], { userId: user.id, requestPath: '/api/suporte/tickets/mensagem', module: 'SUPORTE',
            dedupKey: `ticket-message:${novaMsg.id}:equipe` },
        );
      }
    }

    await createLog({
      level: interno ? 'ALERTA' : 'INFO',
      action: interno ? 'TICKET_INTERNAL_MESSAGE_CREATED' : 'TICKET_MESSAGE_CREATED',
      module: 'SUPORTE',
      userId: user.id,
      message: interno ? 'Mensagem interna adicionada ao ticket.' : 'Mensagem adicionada ao ticket.',
      details: { ticketId: ticket.id, messageId: novaMsg.id, hasAttachment: Boolean(anexo.value) },
    });

    return NextResponse.json(novaMsg);
  } catch {
    return NextResponse.json({ error: 'Erro ao enviar' }, { status: 500 });
  }
}, { maxBodyBytes: 7 * 1024 * 1024 });
