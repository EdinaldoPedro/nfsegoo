import { NextResponse } from 'next/server';
import { getAuthenticatedUser, forbidden, unauthorized } from '@/app/utils/api-middleware';
import { isSupportRole } from '@/app/utils/access-control';
import { prisma } from '@/app/utils/prisma';
import { EmailService } from '@/app/services/EmailService';
import {
  MANUAL_CONTRACTING_PAYMENT,
  MANUAL_CONTRACTING_PENDING_STATUSES,
  MANUAL_CONTRACTING_STATUSES,
  parsePedidoMetadata,
  serializePedidoContratacao,
} from '@/app/utils/manual-contracting';

function appLink(path: string) {
  const base = process.env.NEXT_PUBLIC_APP_URL || '';
  return base ? `${base.replace(/\/$/, '')}${path}` : path;
}

function statusEmail(status: string, motivo?: string) {
  if (status === 'EM_ANALISE') {
    return {
      subject: 'Sua contratacao esta em analise',
      title: 'Sua contratacao esta em analise',
      message: 'Nossa equipe iniciou a conferencia da sua solicitacao. Acompanhe qualquer pedido adicional pelo suporte.',
    };
  }

  if (status === 'ATIVADO_MANUALMENTE') {
    return {
      subject: 'Seu plano foi ativado',
      title: 'Seu plano foi ativado',
      message: 'A contratacao foi conferida e seu acesso ja foi liberado na plataforma.',
    };
  }

  if (status === 'RECUSADO') {
    return {
      subject: 'Precisamos revisar sua solicitacao',
      title: 'Precisamos revisar sua solicitacao',
      message: 'Sua solicitacao nao pode ser ativada neste momento. Veja o motivo e responda pelo suporte se necessario.',
      motivo,
    };
  }

  return null;
}

export async function GET(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return unauthorized();
  if (!isSupportRole(user.role)) return forbidden();

  try {
    const { searchParams } = new URL(request.url);
    const includeFinalizados = searchParams.get('finalizados') === '1';
    const statuses = includeFinalizados ? MANUAL_CONTRACTING_STATUSES : MANUAL_CONTRACTING_PENDING_STATUSES;

    const pedidos = await prisma.pedido.findMany({
      where: {
        formaPagamento: MANUAL_CONTRACTING_PAYMENT,
        status: { in: statuses as unknown as string[] },
      },
      include: {
        anexos: { orderBy: { createdAt: 'desc' } },
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

    return NextResponse.json(pedidos.map((pedido) => ({
      ...serializePedidoContratacao(pedido),
      user: pedido.user,
      temComprovante: pedido.anexos.length > 0,
    })));
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

    if (!MANUAL_CONTRACTING_STATUSES.includes(body.status)) {
      return NextResponse.json({ error: 'Status de pedido invalido.' }, { status: 400 });
    }

    const pedido = await prisma.pedido.findUnique({
      where: { id: body.id },
      include: { anexos: true, user: true },
    });
    if (!pedido) return NextResponse.json({ error: 'Pedido nao encontrado.' }, { status: 404 });

    if (body.status === 'RECUSADO' && (!body.motivo || String(body.motivo).trim().length < 5)) {
      return NextResponse.json({ error: 'Informe o motivo da recusa.' }, { status: 400 });
    }

    if (body.status === 'ATIVADO_MANUALMENTE' && pedido.anexos.length === 0 && (!body.observacao || String(body.observacao).trim().length < 5)) {
      return NextResponse.json({ error: 'Sem comprovante, a ativacao exige justificativa.' }, { status: 400 });
    }

    const detalhes = parsePedidoMetadata(pedido.gatewayId);
    const atualizado = await prisma.$transaction(async (tx) => {
      const updated = await tx.pedido.update({
        where: { id: body.id },
        data: {
          status: body.status,
          motivoArquivamento: body.status === 'RECUSADO' ? String(body.motivo).trim() : pedido.motivoArquivamento,
          gatewayId: JSON.stringify({
            ...detalhes,
            processadoPor: user.id,
            processadoEm: new Date().toISOString(),
            observacaoInterna: body.observacao || null,
            motivoRecusa: body.status === 'RECUSADO' ? String(body.motivo).trim() : detalhes.motivoRecusa,
          }),
        },
      });

      if (detalhes.ticketId && ['EM_ANALISE', 'RECUSADO', 'ATIVADO_MANUALMENTE'].includes(body.status)) {
        const mensagem =
          body.status === 'EM_ANALISE'
            ? 'A equipe iniciou a analise da solicitacao de contratacao.'
            : body.status === 'RECUSADO'
              ? `Solicitacao recusada. Motivo: ${String(body.motivo).trim()}`
              : 'Plano ativado manualmente pela equipe.';

        await tx.ticketMensagem.create({
          data: {
            ticketId: detalhes.ticketId,
            usuarioId: user.id,
            mensagem,
            interno: false,
          },
        });
        await tx.ticket.update({
          where: { id: detalhes.ticketId },
          data: {
            updatedAt: new Date(),
            clientUnread: true,
            status: body.status === 'ATIVADO_MANUALMENTE' ? 'RESOLVIDO' : undefined,
          },
        });
      }

      await tx.systemLog.create({
        data: {
          level: body.status === 'RECUSADO' ? 'WARN' : 'INFO',
          action: 'PEDIDO_CONTRATACAO_STATUS',
          message: `Pedido de contratacao ${body.id} atualizado para ${body.status}.`,
          details: JSON.stringify({
            adminId: user.id,
            pedidoId: body.id,
            status: body.status,
            observacao: body.observacao || null,
            motivo: body.motivo || null,
          }),
        },
      });

      return updated;
    });

    const emailInfo = statusEmail(body.status, body.motivo);
    if (emailInfo) {
      const emailService = new EmailService();
      await emailService.sendEmail(
        pedido.user.email,
        emailInfo.subject,
        emailService.getTemplateContratacaoManual({
          nome: pedido.user.nome,
          titulo: emailInfo.title,
          mensagem: emailInfo.message,
          pedidoId: pedido.id,
          ticketProtocolo: detalhes.ticketProtocolo,
          plano: detalhes.planoNome || pedido.planoSlug,
          motivo: emailInfo.motivo,
          link: detalhes.ticketId ? appLink(`/suporte/${detalhes.ticketId}`) : appLink('/cliente/dashboard'),
        }),
      );
    }

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
