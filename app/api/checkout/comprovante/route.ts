import { NextResponse } from 'next/server';
import { getAuthenticatedUser, forbidden, unauthorized } from '@/app/utils/api-middleware';
import { isSupportRole } from '@/app/utils/access-control';
import { validateJsonContentLength } from '@/app/utils/request-guards';
import { prisma } from '@/app/utils/prisma';
import { EmailService } from '@/app/services/EmailService';
import {
  MANUAL_CONTRACTING_PENDING_STATUSES,
  parsePedidoMetadata,
  validatePaymentProof,
} from '@/app/utils/manual-contracting';

function dataUrl(mimeType: string, base64: string) {
  return `data:${mimeType};base64,${base64}`;
}

function appLink(path: string) {
  const base = process.env.NEXT_PUBLIC_APP_URL || '';
  return base ? `${base.replace(/\/$/, '')}${path}` : path;
}

export async function GET(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return unauthorized();

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Anexo nao informado.' }, { status: 400 });

  const anexo = await prisma.pedidoAnexo.findUnique({
    where: { id },
    include: { pedido: { select: { userId: true } } },
  });

  if (!anexo) return NextResponse.json({ error: 'Anexo nao encontrado.' }, { status: 404 });
  if (anexo.pedido.userId !== user.id && !isSupportRole(user.role)) return forbidden();

  return NextResponse.json({
    id: anexo.id,
    nomeArquivo: anexo.nomeArquivo,
    mimeType: anexo.mimeType,
    tamanho: anexo.tamanho,
    conteudoBase64: dataUrl(anexo.mimeType, anexo.conteudoBase64),
    createdAt: anexo.createdAt,
  });
}

export async function POST(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return unauthorized();

  try {
    const sizeError = validateJsonContentLength(request, 7 * 1024 * 1024);
    if (sizeError) return sizeError;

    const body = await request.json();
    const pedidoId = body.pedidoId;
    if (!pedidoId) return NextResponse.json({ error: 'Pedido nao informado.' }, { status: 400 });

    const pedido = await prisma.pedido.findUnique({
      where: { id: pedidoId },
      include: { user: true },
    });

    if (!pedido) return NextResponse.json({ error: 'Pedido nao encontrado.' }, { status: 404 });
    if (pedido.userId !== user.id) return forbidden();
    if (!MANUAL_CONTRACTING_PENDING_STATUSES.includes(pedido.status as any)) {
      return NextResponse.json({ error: 'Este pedido nao aceita novos comprovantes.' }, { status: 400 });
    }

    const parsed = validatePaymentProof(body);
    if (parsed.errorResponse) return parsed.errorResponse;
    const comprovante = parsed.value!;
    const detalhes = parsePedidoMetadata(pedido.gatewayId);

    const anexo = await prisma.$transaction(async (tx) => {
      const criado = await tx.pedidoAnexo.create({
        data: {
          pedidoId: pedido.id,
          userId: user.id,
          ...comprovante,
        },
      });

      await tx.pedido.update({
        where: { id: pedido.id },
        data: {
          status: 'COMPROVANTE_ENVIADO',
          gatewayId: JSON.stringify({
            ...detalhes,
            comprovanteEnviadoEm: new Date().toISOString(),
          }),
        },
      });

      if (detalhes.ticketId) {
        await tx.ticketMensagem.create({
          data: {
            ticketId: detalhes.ticketId,
            usuarioId: user.id,
            mensagem: 'Comprovante de pagamento enviado pelo cliente.',
            anexoBase64: comprovante.conteudoBase64,
            anexoNome: comprovante.nomeArquivo,
          },
        });
        await tx.ticket.update({
          where: { id: detalhes.ticketId },
          data: { updatedAt: new Date() },
        });
      }

      await tx.systemLog.create({
        data: {
          level: 'INFO',
          action: 'COMPROVANTE_CONTRATACAO_ENVIADO',
          message: `Comprovante enviado para pedido ${pedido.id}.`,
          details: JSON.stringify({
            pedidoId: pedido.id,
            userId: user.id,
            nomeArquivo: comprovante.nomeArquivo,
            tamanho: comprovante.tamanho,
          }),
        },
      });

      return criado;
    });

    const emailService = new EmailService();
    await emailService.sendEmail(
      user.email,
      'Comprovante recebido',
      emailService.getTemplateContratacaoManual({
        nome: user.nome,
        titulo: 'Comprovante recebido',
        mensagem: 'Recebemos seu comprovante. A equipe vai analisar a solicitacao e responder pelo suporte.',
        pedidoId: pedido.id,
        ticketProtocolo: detalhes.ticketProtocolo,
        plano: detalhes.planoNome || pedido.planoSlug,
        link: detalhes.ticketId ? appLink(`/suporte/${detalhes.ticketId}`) : appLink('/configuracoes/minha-conta'),
      }),
    );

    return NextResponse.json({
      success: true,
      anexo: {
        id: anexo.id,
        nomeArquivo: anexo.nomeArquivo,
        mimeType: anexo.mimeType,
        tamanho: anexo.tamanho,
        createdAt: anexo.createdAt,
        downloadUrl: `/api/checkout/comprovante?id=${anexo.id}`,
      },
      status: 'COMPROVANTE_ENVIADO',
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Erro ao anexar comprovante.' }, { status: 500 });
  }
}
