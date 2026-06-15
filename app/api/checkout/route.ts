import { NextResponse } from 'next/server';
import { getAuthenticatedUser, unauthorized } from '@/app/utils/api-middleware';
import { prisma } from '@/app/utils/prisma';
import { EmailService } from '@/app/services/EmailService';
import { validateJsonContentLength } from '@/app/utils/request-guards';
import {
  MANUAL_CONTRACTING_PAYMENT,
  MANUAL_CONTRACTING_PENDING_STATUSES,
  serializePedidoContratacao,
  validatePaymentProof,
} from '@/app/utils/manual-contracting';

function money(value: number) {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function appLink(path: string) {
  const base = process.env.NEXT_PUBLIC_APP_URL || '';
  return base ? `${base.replace(/\/$/, '')}${path}` : path;
}

export async function GET(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return unauthorized();

  const pedido = await prisma.pedido.findFirst({
    where: {
      userId: user.id,
      formaPagamento: MANUAL_CONTRACTING_PAYMENT,
      status: { in: MANUAL_CONTRACTING_PENDING_STATUSES as unknown as string[] },
      arquivadoEm: null,
    },
    include: { anexos: { orderBy: { createdAt: 'desc' } } },
    orderBy: { createdAt: 'desc' },
  });

  return NextResponse.json({ pedido: pedido ? serializePedidoContratacao(pedido) : null });
}

export async function POST(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return unauthorized();

  try {
    const sizeError = validateJsonContentLength(request, 7 * 1024 * 1024);
    if (sizeError) return sizeError;

    const body = await request.json();

    const existente = await prisma.pedido.findFirst({
      where: {
        userId: user.id,
        formaPagamento: MANUAL_CONTRACTING_PAYMENT,
        status: { in: MANUAL_CONTRACTING_PENDING_STATUSES as unknown as string[] },
        arquivadoEm: null,
      },
      include: { anexos: { orderBy: { createdAt: 'desc' } } },
      orderBy: { createdAt: 'desc' },
    });

    if (existente) {
      return NextResponse.json({
        success: true,
        reused: true,
        pedido: serializePedidoContratacao(existente),
        mensagem: 'Voce ja tem uma solicitacao de contratacao em andamento.',
      });
    }

    const planSlug = body.planSlug || null;
    const ciclo = body.ciclo || 'MENSAL';
    const qtdCiclos = Math.max(1, Number(body.qtdCiclos || 1));
    const pacotes = Array.isArray(body.pacotes) ? body.pacotes : [];
    const comprovanteInput = body.comprovante || null;

    const [planoBase, catalogoPacotes] = await Promise.all([
      planSlug ? prisma.plan.findUnique({ where: { slug: planSlug } }) : null,
      pacotes.length > 0
        ? prisma.plan.findMany({
            where: { id: { in: pacotes.map((item: any) => item.planId).filter(Boolean) } },
          })
        : Promise.resolve([]),
    ]);

    if (planSlug && !planoBase) {
      return NextResponse.json({ error: 'Plano informado nao foi encontrado.' }, { status: 404 });
    }

    let comprovante: ReturnType<typeof validatePaymentProof>['value'] | null = null;
    if (comprovanteInput) {
      const parsed = validatePaymentProof(comprovanteInput);
      if (parsed.errorResponse) return parsed.errorResponse;
      comprovante = parsed.value || null;
    }

    const valorPlanoUnitario = planoBase
      ? ciclo === 'ANUAL'
        ? Number(planoBase.priceYearly || 0)
        : Number(planoBase.priceMonthly || 0)
      : 0;
    const valorPlano = valorPlanoUnitario * qtdCiclos;

    const pacoteMap = new Map(catalogoPacotes.map((item) => [item.id, item]));
    let valorAdicionais = 0;
    let notasAdicionais = 0;
    const resumoPacotes = pacotes
      .map((item: any) => {
        const pacote = pacoteMap.get(item.planId);
        const qtd = Math.max(0, Number(item.qtd || 0));
        if (!pacote || qtd === 0) return null;

        valorAdicionais += Number(pacote.priceMonthly || 0) * qtd;
        if (pacote.tipo === 'PACOTE_NOTAS') {
          notasAdicionais += Number(pacote.maxNotasMensal || 0) * qtd;
        }

        return {
          id: pacote.id,
          slug: pacote.slug,
          nome: pacote.name,
          tipo: pacote.tipo,
          quantidade: qtd,
        };
      })
      .filter(Boolean);

    const valorTotal = valorPlano + valorAdicionais;
    const gatewayMetadata = {
      cupom: body.cupom || null,
      qtdCiclos,
      planoNome: planoBase?.name || null,
      pacotes: resumoPacotes,
    };

    const resumoPacotesTexto =
      resumoPacotes.length > 0
        ? resumoPacotes.map((pacote: any) => `${pacote.quantidade}x ${pacote.nome}`).join(', ')
        : 'Nenhum pacote adicional';

    const resultado = await prisma.$transaction(async (tx) => {
      const pedido = await tx.pedido.create({
        data: {
          userId: user.id,
          planoSlug: planSlug || 'SEM_PLANO',
          ciclo,
          notasAdicionais,
          valorPlano,
          valorAdicionais,
          valorTotal,
          formaPagamento: MANUAL_CONTRACTING_PAYMENT,
          status: comprovante ? 'COMPROVANTE_ENVIADO' : 'AGUARDANDO_COMPROVANTE',
          gatewayId: JSON.stringify(gatewayMetadata),
        },
      });

      if (comprovante) {
        await tx.pedidoAnexo.create({
          data: {
            pedidoId: pedido.id,
            userId: user.id,
            ...comprovante,
          },
        });
      }

      const descricaoTicket = [
        `Pedido: ${pedido.id}`,
        `Plano solicitado: ${planoBase?.name || 'Sem plano base'}`,
        `Ciclo: ${ciclo}`,
        `Quantidade de ciclos: ${qtdCiclos}`,
        `Pacotes: ${resumoPacotesTexto}`,
        `Valor estimado: ${money(valorTotal)}`,
        `Status: ${comprovante ? 'Comprovante enviado' : 'Aguardando comprovante'}`,
        '',
        'Solicitacao criada automaticamente pelo fluxo de contratacao manual.',
      ].join('\n');

      const ticket = await tx.ticket.create({
        data: {
          assunto: 'Solicitacao de contratacao',
          categoria: 'Comercial / Contratacao Manual',
          prioridade: 'MEDIA',
          descricao: descricaoTicket,
          status: 'ABERTO',
          solicitanteId: user.id,
          anexoBase64: comprovante?.conteudoBase64 || null,
          anexoNome: comprovante?.nomeArquivo || null,
        },
      });

      await tx.ticketMensagem.create({
        data: {
          ticketId: ticket.id,
          usuarioId: user.id,
          mensagem: descricaoTicket,
          anexoBase64: comprovante?.conteudoBase64 || null,
          anexoNome: comprovante?.nomeArquivo || null,
        },
      });

      await tx.pedido.update({
        where: { id: pedido.id },
        data: {
          gatewayId: JSON.stringify({
            ...gatewayMetadata,
            ticketId: ticket.id,
            ticketProtocolo: ticket.protocolo,
            comprovanteEnviadoEm: comprovante ? new Date().toISOString() : null,
          }),
        },
      });

      await tx.systemLog.create({
        data: {
          level: 'INFO',
          action: 'PEDIDO_CONTRATACAO_CRIADO',
          message: `Solicitacao de contratacao criada por ${user.email}.`,
          details: JSON.stringify({
            userId: user.id,
            pedidoId: pedido.id,
            planoSlug: planSlug,
            ciclo,
            valorTotal,
            comComprovante: !!comprovante,
          }),
        },
      });

      const pedidoCompleto = await tx.pedido.findUnique({
        where: { id: pedido.id },
        include: { anexos: { orderBy: { createdAt: 'desc' } } },
      });

      return { pedido: pedidoCompleto!, ticket };
    });

    const emailService = new EmailService();
    await emailService.sendEmail(
      user.email,
      'Recebemos sua solicitacao de contratacao',
      emailService.getTemplateContratacaoManual({
        nome: user.nome,
        titulo: 'Recebemos sua solicitacao de contratacao',
        mensagem: comprovante
          ? 'Seu pedido foi registrado com comprovante. A equipe vai conferir os dados e responder pelo suporte.'
          : 'Seu pedido foi registrado. Envie o comprovante para agilizar a analise e ativacao manual.',
        pedidoId: resultado.pedido.id,
        ticketProtocolo: resultado.ticket.protocolo,
        plano: planoBase?.name || planSlug || 'Sem plano base',
        valor: money(valorTotal),
        link: appLink(`/suporte/${resultado.ticket.id}`),
      }),
    );

    return NextResponse.json({
      success: true,
      pedido: serializePedidoContratacao(resultado.pedido),
      ticketId: resultado.ticket.id,
      mensagem: 'Solicitacao de contratacao registrada. A equipe interna recebeu um ticket para conferencia.',
    });
  } catch (error) {
    console.error('Erro no checkout manual:', error);
    return NextResponse.json({ error: 'Erro interno ao registrar solicitacao' }, { status: 500 });
  }
}
