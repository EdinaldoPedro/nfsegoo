import { NextResponse } from 'next/server';
import { getAuthenticatedUser, unauthorized } from '@/app/utils/api-middleware';
import { prisma } from '@/app/utils/prisma';

export async function POST(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return unauthorized();

  try {
    const body = await request.json();
    const planSlug = body.planSlug || null;
    const ciclo = body.ciclo || 'MENSAL';
    const qtdCiclos = Math.max(1, Number(body.qtdCiclos || 1));
    const pacotes = Array.isArray(body.pacotes) ? body.pacotes : [];

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

    const pedido = await prisma.pedido.create({
      data: {
        userId: user.id,
        planoSlug: planSlug || 'SEM_PLANO',
        ciclo,
        notasAdicionais,
        valorPlano,
        valorAdicionais,
        valorTotal,
        formaPagamento: 'ATIVACAO_MANUAL',
        status: 'AGUARDANDO_ATIVACAO_MANUAL',
        gatewayId: JSON.stringify(gatewayMetadata),
      },
    });

    const resumoPacotesTexto =
      resumoPacotes.length > 0
        ? resumoPacotes.map((pacote: any) => `${pacote.quantidade}x ${pacote.nome}`).join(', ')
        : 'Nenhum pacote adicional';

    const descricaoTicket = [
      `Pedido: ${pedido.id}`,
      `Plano solicitado: ${planoBase?.name || 'Sem plano base'}`,
      `Ciclo: ${ciclo}`,
      `Quantidade de ciclos: ${qtdCiclos}`,
      `Pacotes: ${resumoPacotesTexto}`,
      `Valor estimado: R$ ${valorTotal.toFixed(2).replace('.', ',')}`,
      '',
      'Solicitacao criada automaticamente pelo checkout manual.',
    ].join('\n');

    const ticket = await prisma.ticket.create({
      data: {
        assunto: 'Solicitacao de ativacao manual',
        categoria: 'Comercial / Ativacao Manual',
        prioridade: 'MEDIA',
        descricao: descricaoTicket,
        status: 'ABERTO',
        solicitanteId: user.id,
      },
    });

    await prisma.ticketMensagem.create({
      data: {
        ticketId: ticket.id,
        usuarioId: user.id,
        mensagem: descricaoTicket,
      },
    });

    await prisma.pedido.update({
      where: { id: pedido.id },
      data: {
        gatewayId: JSON.stringify({
          ...gatewayMetadata,
          ticketId: ticket.id,
          ticketProtocolo: ticket.protocolo,
        }),
      },
    });

    return NextResponse.json({
      success: true,
      pedidoId: pedido.id,
      ticketId: ticket.id,
      mensagem: 'Solicitacao registrada. A equipe interna recebeu um ticket e fara a liberacao manualmente.',
    });
  } catch (error) {
    console.error('Erro no checkout manual:', error);
    return NextResponse.json({ error: 'Erro interno ao registrar solicitacao' }, { status: 500 });
  }
}
