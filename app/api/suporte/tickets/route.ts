import { NextResponse } from 'next/server';
import { prisma } from '@/app/utils/prisma';
import { validateRequest } from '@/app/utils/api-security';
import { registrarEventoCrm } from '@/app/services/crmService';
import { normalizeBase64Attachment, validateJsonContentLength } from '@/app/utils/request-guards';

export async function GET(request: Request) {
  const { targetId, errorResponse } = await validateRequest(request);
  if (errorResponse) return errorResponse;

  try {
    const tickets = await prisma.ticket.findMany({
      where: { solicitanteId: targetId, arquivadoEm: null } as any,
      include: {
        solicitante: { select: { nome: true, email: true } },
        atendente: { select: { nome: true } },
        _count: { select: { mensagens: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });

    return NextResponse.json(tickets);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Erro ao buscar tickets' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const { targetId, errorResponse } = await validateRequest(request);
  if (errorResponse) return errorResponse;

  try {
    const sizeError = validateJsonContentLength(request, 7 * 1024 * 1024);
    if (sizeError) return sizeError;

    const body = await request.json();
    const {
      assuntoId,
      tituloManual,
      descricao,
      anexoBase64,
      anexoNome,
      prioridade,
      checkDuplicity,
      vendaIdReferencia,
    } = body;

    const anexo = normalizeBase64Attachment(anexoBase64, anexoNome);
    if (anexo.errorResponse) return anexo.errorResponse;

    if (checkDuplicity && vendaIdReferencia) {
      const duplicado = await prisma.ticket.findFirst({
        where: {
          solicitanteId: targetId,
          arquivadoEm: null,
          assunto: { contains: vendaIdReferencia.split('-')[0] },
          status: { notIn: ['RESOLVIDO', 'FECHADO'] },
        },
      });

      if (duplicado) {
        return NextResponse.json(
          {
            warning: 'DUPLICATE_FOUND',
            message: `Ja existe o ticket #${duplicado.protocolo} aberto para esta venda.`,
            ticketId: duplicado.id,
          },
          { status: 409 },
        );
      }
    }

    let tituloFinal = '';
    let prioridadeFinal = 'MEDIA';
    let catalogId: string | null = null;

    if (assuntoId === 'AUTO_ERROR_REPORT') {
      tituloFinal = tituloManual || 'Erro reportado pelo sistema';
      prioridadeFinal = prioridade || 'ALTA';
    } else if (assuntoId) {
      const itemCatalogo = await prisma.ticketCatalog.findUnique({ where: { id: assuntoId } });
      if (!itemCatalogo || !itemCatalogo.ativo) {
        return NextResponse.json({ error: 'Assunto invalido.' }, { status: 400 });
      }
      tituloFinal = itemCatalogo.titulo;
      prioridadeFinal = itemCatalogo.prioridade;
      catalogId = itemCatalogo.id;
    } else {
      return NextResponse.json({ error: 'Assunto e obrigatorio.' }, { status: 400 });
    }

    const ticket = await prisma.ticket.create({
      data: {
        assunto: tituloFinal,
        catalogId,
        prioridade: prioridadeFinal,
        categoria: 'Suporte Tecnico',
        descricao: descricao || 'Sem descricao',
        status: 'ABERTO',
        solicitanteId: targetId,
        anexoBase64: anexo.value,
        anexoNome: anexo.fileName,
      },
    });

    await prisma.ticketMensagem.create({
      data: {
        ticketId: ticket.id,
        usuarioId: targetId,
        mensagem: descricao || 'Abertura de chamado',
      },
    });

    await registrarEventoCrm(
      targetId,
      'SISTEMA',
      'Ticket de Suporte Aberto',
      `Assunto: ${tituloFinal} (Prioridade: ${prioridadeFinal})`,
    );

    return NextResponse.json(ticket, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: `Erro interno: ${error.message}` }, { status: 500 });
  }
}
