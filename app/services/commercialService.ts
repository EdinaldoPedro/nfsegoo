import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '@/app/utils/prisma';
import { hasCustomerAccountCapability, isAdminRole, isCommercialRole } from '@/app/utils/access-control';
import { MANUAL_CONTRACTING_PAYMENT, MANUAL_CONTRACTING_PENDING_STATUSES, parsePedidoMetadata } from '@/app/utils/manual-contracting';
import { CommercialError, type Cart, type CommercialQuote, calculateQuote, normalizeCart,
  assertOrderTransition, addCalendarMonths, moneyCents } from '@/app/utils/commercial-pricing';

type Tx = Prisma.TransactionClient;
export const proofMetadataSelect = { id: true, nomeArquivo: true, mimeType: true, tamanho: true, createdAt: true } satisfies Prisma.PedidoAnexoSelect;
export const orderInclude = { anexos: { select: proofMetadataSelect, orderBy: { createdAt: 'desc' as const } } };
const pendingStatuses = [...MANUAL_CONTRACTING_PENDING_STATUSES];

function assertManualBillingConfigured() {
  if (process.env.NODE_ENV === 'production' && process.env.BILLING_MODE !== 'MANUAL') {
    throw new CommercialError('Novas contratações estão temporariamente indisponíveis. Entre em contato com o atendimento.', 503);
  }
}

/** Every order mutation locks its owner first. Unique keys are the last line of defence. */
export async function commercialTransaction<T>(userId: string, work: (tx: Tx) => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        const found = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
        if (!found.length) throw new CommercialError('Conta não encontrada.', 404);
        return work(tx);
      // The owner row is the mutex. READ COMMITTED ensures queries made after
      // waiting for it see the preceding operation, instead of an old snapshot.
      }, { isolationLevel: 'ReadCommitted', maxWait: 5000, timeout: 15000 });
    } catch (error) {
      if ((error as { code?: string })?.code === 'P2034') {
        if (attempt < 3) continue;
        throw new CommercialError('Operação concorrente. Atualize e tente novamente.', 409);
      }
      if ((error as { code?: string })?.code === 'P2002') throw new CommercialError('Pedido ou pagamento já registrado. Atualize a página.', 409);
      throw error;
    }
  }
  throw new CommercialError('Operação não concluída.', 409);
}

export function quoteHash(quote: CommercialQuote) {
  // PostgreSQL JSONB does not preserve object key order.
  const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
    : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)])) : value;
  return createHash('sha256').update(JSON.stringify(canonical(quote))).digest('hex');
}

export async function loadCommercialQuote(tx: Tx, userId: string, input: unknown) {
  assertManualBillingConfigured();
  const cart = normalizeCart(input);
  const now = new Date();
  const products = await tx.plan.findMany({ where: { OR: [
    ...(cart.planSlug ? [{ slug: cart.planSlug }] : []), { id: { in: cart.pacotes.map((item) => item.planId) } },
  ] } });
  const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true, role: true, empresaId: true, planoStatus: true } });
  if (isAdminRole(user.role)) throw new CommercialError('A conta administrativa já possui o plano customizado ilimitado.', 409);
  if (!await hasCustomerAccountCapability(user, tx)) throw new CommercialError('Use uma conta cliente ou uma conta titular de empresa para contratar.', 403);
  if (user.planoStatus === 'suspended') throw new CommercialError('Conta suspensa. Solicite a revisão ao atendimento antes de contratar.', 409);
  if (!cart.planSlug) {
    const base = await tx.planHistory.findFirst({ where: { userId, status: 'ATIVO', arquivadoEm: null,
      dataInicio: { lte: now }, AND: [{ OR: [{ dataFim: null }, { dataFim: { gt: now } }] }],
      plan: { tipo: { in: ['PLANO', 'CUSTOM'] } } } });
    if (!base) throw new CommercialError('Pacotes adicionais exigem uma assinatura vigente.');
  }
  let coupon = cart.cupom ? await tx.cupom.findUnique({ where: { codigo: cart.cupom } }) : null;
  if (coupon) {
    await tx.$queryRaw`SELECT "id" FROM "Cupom" WHERE "id" = ${coupon.id} FOR UPDATE`;
    coupon = await tx.cupom.findUnique({ where: { id: coupon.id } });
  }
  const [hasPaidPurchase, reservedCouponUses, userReservedFirstPurchase] = await Promise.all([
    tx.fatura.count({ where: { userId, status: 'PAGO' } }),
    coupon ? tx.pedido.count({ where: { cupomId: coupon.id, cupomEstado: 'RESERVADO', expiresAt: { gt: now } } }) : 0,
    coupon?.apenasPrimeiraCompra ? tx.pedido.count({ where: { userId, cupomEstado: 'RESERVADO', expiresAt: { gt: now } } }) : 0,
  ]);
  const quote = calculateQuote(cart, products, coupon, { now, hasPaidPurchase: hasPaidPurchase > 0,
    reservedCouponUses, userReservedFirstPurchase: userReservedFirstPurchase > 0 });
  return { quote, hash: quoteHash(quote) };
}

function checkoutExpiry(now: Date) {
  const hours = Number(process.env.CHECKOUT_VALIDITY_HOURS || 72);
  if (!Number.isSafeInteger(hours) || hours < 1 || hours > 720) throw new Error('Invalid CHECKOUT_VALIDITY_HOURS');
  return new Date(now.getTime() + hours * 3600_000);
}

export async function addOrderMessage(tx: Tx, pedido: { id: string; userId: string; gatewayId: string | null }, actorId: string, text: string, resolved = false) {
  const details = parsePedidoMetadata(pedido.gatewayId);
  if (typeof details.ticketId !== 'string') return;
  // Metadata is not authority: the ticket must still belong to this customer.
  const ticket = await tx.ticket.findFirst({ where: { id: details.ticketId, solicitanteId: pedido.userId, arquivadoEm: null }, select: { id: true } });
  if (!ticket) return;
  await tx.ticketMensagem.create({ data: { ticketId: ticket.id, usuarioId: actorId, mensagem: text, interno: false } });
  await tx.ticket.update({ where: { id: ticket.id }, data: { clientUnread: actorId !== pedido.userId,
    updatedAt: new Date(), ...(resolved ? { status: 'RESOLVIDO' } : {}) } });
}

export async function createManualOrder(params: { userId: string; input: unknown; hash: unknown; idempotencyKey: unknown;
  proof?: { nomeArquivo: string; mimeType: string; tamanho: number; conteudoBase64: string } | null }) {
  assertManualBillingConfigured();
  if (typeof params.idempotencyKey !== 'string' || !/^[a-z0-9-]{16,80}$/i.test(params.idempotencyKey)) throw new CommercialError('Chave da solicitação inválida. Atualize a página.');
  if (typeof params.hash !== 'string' || !/^[a-f0-9]{64}$/.test(params.hash)) throw new CommercialError('Confira a cotação antes de solicitar.');
  const key = params.idempotencyKey;
  return commercialTransaction(params.userId, async (tx) => {
    const existingKey = await tx.pedido.findUnique({ where: { userId_idempotencyKey: { userId: params.userId, idempotencyKey: key } }, include: orderInclude });
    if (existingKey) {
      if (existingKey.cotacaoHash !== params.hash) throw new CommercialError('Esta chave já foi usada em outro carrinho.', 409);
      return { pedido: existingKey, reused: true };
    }
    const now = new Date();
    const expired = await tx.pedido.findMany({ where: { userId: params.userId, status: { in: pendingStatuses }, expiresAt: { lte: now } }, select: { id: true } });
    if (expired.length) await tx.pedido.updateMany({ where: { id: { in: expired.map((p) => p.id) } },
      data: { status: 'EXPIRADO', pendingKey: null, cupomEstado: 'LIBERADO' } });
    const existing = await tx.pedido.findFirst({ where: { userId: params.userId, formaPagamento: MANUAL_CONTRACTING_PAYMENT,
      status: { in: pendingStatuses }, arquivadoEm: null }, include: orderInclude });
    if (existing) {
      if (existing.cotacaoHash !== params.hash) throw new CommercialError('Já existe uma solicitação pendente. Cancele-a antes de alterar o carrinho.', 409);
      return { pedido: existing, reused: true };
    }
    const { quote, hash } = await loadCommercialQuote(tx, params.userId, params.input);
    if (hash !== params.hash) throw new CommercialError('Preço, benefício ou cupom mudou. Confira a nova cotação e confirme novamente.', 409);
    const pedido = await tx.pedido.create({ data: {
      userId: params.userId, planoSlug: quote.cart.planSlug || 'SEM_PLANO', ciclo: quote.cart.ciclo,
      notasAdicionais: quote.lines.filter((l) => l.tipo === 'PACOTE_NOTAS').reduce((sum, l) => sum + l.notas, 0),
      valorPlano: new Prisma.Decimal(quote.planoCents).div(100), valorAdicionais: new Prisma.Decimal(quote.adicionaisCents).div(100),
      valorTotal: new Prisma.Decimal(quote.totalCents).div(100), cotacao: quote as unknown as Prisma.InputJsonValue, cotacaoHash: hash,
      formaPagamento: MANUAL_CONTRACTING_PAYMENT, status: params.proof ? 'COMPROVANTE_ENVIADO' : 'AGUARDANDO_COMPROVANTE',
      idempotencyKey: key, pendingKey: params.userId, expiresAt: checkoutExpiry(now),
      cupomId: quote.coupon?.id, cupomEstado: quote.coupon ? 'RESERVADO' : null,
    } });
    if (params.proof) await tx.pedidoAnexo.create({ data: { pedidoId: pedido.id, userId: params.userId, ...params.proof } });
    const description = `Pedido ${pedido.id}. Itens: ${quote.lines.map((l) => `${l.quantidade}x ${l.nome}`).join(', ')}. Total confirmado: R$ ${(quote.totalCents / 100).toFixed(2)}. A ativação depende da conferência do pagamento.`;
    const ticket = await tx.ticket.create({ data: { assunto: 'Solicitação de contratação', categoria: 'Comercial / Contratação Manual',
      prioridade: 'MEDIA', descricao: description, status: 'ABERTO', solicitanteId: params.userId } });
    const updated = await tx.pedido.update({ where: { id: pedido.id }, data: { gatewayId: JSON.stringify({
      cupom: quote.cart.cupom, qtdCiclos: quote.cart.qtdCiclos, planoNome: quote.lines.find((l) => l.tipo === 'PLANO')?.nome,
      pacotes: quote.lines.filter((l) => l.tipo !== 'PLANO'), ticketId: ticket.id, ticketProtocolo: ticket.protocolo,
    }) }, include: orderInclude });
    await tx.systemLog.create({ data: { level: 'INFO', action: 'PEDIDO_CONTRATACAO_CRIADO', userId: params.userId,
      module: 'FINANCEIRO', message: 'Pedido criado com cotação autoritativa.', details: JSON.stringify({ pedidoId: pedido.id, hash, totalCents: quote.totalCents }) } });
    return { pedido: updated, reused: false };
  });
}

function storedQuote(pedido: { cotacao: Prisma.JsonValue; cotacaoHash: string | null; valorTotal: Prisma.Decimal }): CommercialQuote {
  const quote = pedido.cotacao as unknown as CommercialQuote;
  if (!quote || quote.version !== 1 || !Array.isArray(quote.lines) || quoteHash(quote) !== pedido.cotacaoHash || moneyCents(pedido.valorTotal) !== quote.totalCents) {
    throw new CommercialError('Pedido legado ou cotação inconsistente. Cancele e recrie a solicitação; não é seguro ativá-la.', 409);
  }
  return quote;
}

export async function processManualOrder(params: { actorId: string; id: string; status: string; justification: string;
  paymentReference?: unknown; receivedAmount?: unknown; paymentChecked?: unknown; reason?: unknown }) {
  const owner = await prisma.pedido.findUnique({ where: { id: params.id }, select: { userId: true } });
  if (!owner) throw new CommercialError('Pedido não encontrado.', 404);
  return commercialTransaction(owner.userId, async (tx) => {
    const actor = await tx.user.findUnique({ where: { id: params.actorId }, select: { role: true } });
    if (!isCommercialRole(actor?.role)) throw new CommercialError('Sem permissão comercial.', 403);
    if (params.actorId === owner.userId) throw new CommercialError('Não é permitido aprovar a própria contratação.', 403);
    const pedido = await tx.pedido.findUniqueOrThrow({ where: { id: params.id }, include: orderInclude });
    if (pedido.arquivadoEm || pedido.formaPagamento !== MANUAL_CONTRACTING_PAYMENT) throw new CommercialError('Pedido indisponível.', 409);
    if (params.status === 'ATIVADO_MANUALMENTE' && pedido.status === params.status && pedido.faturaId) {
      const suppliedReference = typeof params.paymentReference === 'string' ? params.paymentReference.trim().toUpperCase() : '';
      if (params.paymentChecked !== true || moneyCents(params.receivedAmount, 'Valor recebido') !== moneyCents(pedido.valorTotal)
        || (moneyCents(pedido.valorTotal) > 0 && suppliedReference !== pedido.referenciaPagamento)) {
        throw new CommercialError('Pedido já conciliado com outros dados. Não é permitido alterar a quitação.', 409);
      }
      return pedido;
    }
    if (!['EM_ANALISE', 'RECUSADO', 'ATIVADO_MANUALMENTE'].includes(params.status)) throw new CommercialError('Status inválido.');
    assertOrderTransition(pedido.status, params.status);
    const now = new Date();
    if (pedido.expiresAt && pedido.expiresAt <= now && params.status !== 'RECUSADO') throw new CommercialError('Cotação expirada. Solicite nova contratação antes da ativação.', 409);
    const reason = typeof params.reason === 'string' ? params.reason.trim() : '';
    if (params.status === 'RECUSADO' && (reason.length < 10 || reason.length > 2000)) throw new CommercialError('Informe um motivo público entre 10 e 2000 caracteres.');
    let invoiceId: string | undefined;
    let reference: string | undefined;
    let activationStart: Date | undefined;
    if (params.status === 'ATIVADO_MANUALMENTE') {
      const account = await tx.user.findUniqueOrThrow({ where: { id: owner.userId }, select: { id: true, role: true, empresaId: true, planoStatus: true } });
      if (isAdminRole(account.role)) throw new CommercialError('A conta administrativa já possui o plano customizado ilimitado. Não ative uma cobrança adicional.', 409);
      if (!await hasCustomerAccountCapability(account, tx) || account.planoStatus === 'suspended') throw new CommercialError('Regularize o acesso da conta antes de ativar o pedido. O pagamento ainda não foi conciliado.', 409);
      const quote = storedQuote(pedido);
      reference = typeof params.paymentReference === 'string' ? params.paymentReference.trim().toUpperCase() : '';
      if (params.paymentChecked !== true || moneyCents(params.receivedAmount, 'Valor recebido') !== quote.totalCents) throw new CommercialError('Confirme a conciliação e o valor recebido, igual ao total do pedido.');
      if (quote.totalCents > 0 && (pedido.anexos.length === 0 || !/^[A-Z0-9][A-Z0-9:/_.-]{5,159}$/.test(reference))) throw new CommercialError('Comprovante e referência bancária única são obrigatórios.');
      if (quote.totalCents === 0) reference = `GRATUIDADE:${pedido.id}`;
      if (await tx.fatura.findFirst({ where: { txid: reference, status: 'PAGO' }, select: { id: true } })) {
        throw new CommercialError('A referência de pagamento já foi conciliada em outra fatura.', 409);
      }
      const activeBase = await tx.planHistory.findMany({ where: { userId: owner.userId, status: 'ATIVO', arquivadoEm: null,
        plan: { tipo: { in: ['PLANO', 'CUSTOM'] } }, OR: [{ dataFim: null }, { dataFim: { gt: now } }] }, include: { plan: true } });
      const baseLine = quote.lines.find((l) => l.tipo === 'PLANO');
      activationStart = now;
      if (baseLine) {
        for (const history of activeBase) {
          if (history.plan.diasTeste > 0) {
            await tx.planHistory.update({ where: { id: history.id }, data: { status: 'FINALIZADO', dataFim: now } });
          } else {
            if (!history.dataFim) throw new CommercialError('Existe um contrato sem vencimento. A administração precisa conciliá-lo antes de contratar outro.', 409);
            if (history.dataFim > activationStart) activationStart = history.dataFim;
          }
        }
      } else if (!activeBase.some((h) => h.dataInicio <= now)) throw new CommercialError('A assinatura expirou. Recrie o pedido incluindo um plano.', 409);
      const end = baseLine ? addCalendarMonths(activationStart, quote.cart.qtdCiclos * (quote.cart.ciclo === 'ANUAL' ? 12 : 1)) : null;
      for (const line of quote.lines) {
        await tx.planHistory.create({ data: { userId: owner.userId, planId: line.planId, pedidoId: pedido.id,
          status: 'ATIVO', dataInicio: line.tipo === 'PLANO' ? activationStart : now,
          dataFim: line.tipo === 'PLANO' ? end : null, notasEmitidas: 0, limiteNotasContratado: line.notas,
          limiteClientesContratado: line.clientes, tipoContratado: line.tipo, nomeContratado: line.nome,
          cicloInicio: line.tipo === 'PLANO' ? activationStart : now } });
      }
      const extraCompanies = quote.lines.reduce((sum, line) => sum + line.empresas, 0);
      await tx.user.update({ where: { id: owner.userId }, data: {
        ...(extraCompanies ? { empresasAdicionais: { increment: extraCompanies } } : {}),
        ...(baseLine && activationStart <= now ? { plano: baseLine.slug, planoStatus: 'active', planoCiclo: quote.cart.ciclo, planoExpiresAt: end } : {}),
      } });
      const invoice = await tx.fatura.create({ data: { userId: owner.userId, planoId: baseLine?.planId,
        descricao: quote.lines.map((l) => `${l.quantidade}x ${l.nome}`).join(', '), valorTotal: pedido.valorTotal,
        status: 'PAGO', metodo: MANUAL_CONTRACTING_PAYMENT, txid: reference, pagoEm: now } });
      invoiceId = invoice.id;
      if (quote.coupon) {
        if (pedido.cupomId !== quote.coupon.id || pedido.cupomEstado !== 'RESERVADO') throw new CommercialError('Reserva de cupom inválida.', 409);
        await tx.cupom.update({ where: { id: quote.coupon.id }, data: { vezesUsado: { increment: 1 } } });
        await tx.cupomLog.create({ data: { cupomId: quote.coupon.id, userId: owner.userId, faturaId: invoice.id,
          descontoAplicado: new Prisma.Decimal(quote.descontoCents).div(100) } });
      }
    }
    const final = ['RECUSADO', 'ATIVADO_MANUALMENTE'].includes(params.status);
    const updated = await tx.pedido.update({ where: { id: pedido.id }, data: { status: params.status,
      ...(final ? { pendingKey: null, cupomEstado: pedido.cupomId ? (params.status === 'RECUSADO' ? 'LIBERADO' : 'CONSUMIDO') : null } : {}),
      faturaId: invoiceId, referenciaPagamento: reference,
      gatewayId: JSON.stringify({ ...parsePedidoMetadata(pedido.gatewayId), processadoPor: params.actorId,
        processadoEm: now.toISOString(), observacaoInterna: params.justification,
        ...(reason ? { motivoRecusa: reason } : {}), ...(activationStart ? { inicioAssinatura: activationStart.toISOString() } : {}) }),
    }, include: orderInclude });
    await addOrderMessage(tx, updated, params.actorId, params.status === 'ATIVADO_MANUALMENTE'
      ? `Pagamento conciliado e benefícios registrados. Início da assinatura: ${activationStart?.toISOString() || 'não se aplica'}.`
      : params.status === 'RECUSADO' ? `Solicitação recusada. Motivo: ${reason}` : 'Sua solicitação está em análise.', final);
    await tx.systemLog.create({ data: { level: 'INFO', module: 'FINANCEIRO', action: 'PEDIDO_CONTRATACAO_STATUS', userId: params.actorId,
      message: 'Transição comercial confirmada.', details: JSON.stringify({ pedidoId: pedido.id, from: pedido.status, to: params.status,
        faturaId: invoiceId, justification: params.justification }) } });
    return updated;
  });
}

export async function cancelManualOrder(userId: string, id: string) {
  return commercialTransaction(userId, async (tx) => {
    const pedido = await tx.pedido.findFirst({ where: { id, userId, formaPagamento: MANUAL_CONTRACTING_PAYMENT, arquivadoEm: null }, include: orderInclude });
    if (!pedido) throw new CommercialError('Pedido não encontrado.', 404);
    if (pedido.status === 'CANCELADO') return pedido;
    assertOrderTransition(pedido.status, 'CANCELADO');
    const updated = await tx.pedido.update({ where: { id }, data: { status: 'CANCELADO', pendingKey: null,
      cupomEstado: pedido.cupomId ? 'LIBERADO' : null }, include: orderInclude });
    await addOrderMessage(tx, pedido, userId, 'Solicitação cancelada pelo cliente. Se houve transferência, entre em contato para conciliação e eventual devolução.', true);
    await tx.systemLog.create({ data: { level: 'INFO', action: 'PEDIDO_CANCELADO_CLIENTE', userId, message: 'Cancelamento de solicitação.', details: JSON.stringify({ pedidoId: id }) } });
    return updated;
  });
}
