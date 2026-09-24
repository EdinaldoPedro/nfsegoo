import { Prisma } from '@prisma/client';
import { prisma } from '@/app/utils/prisma';
import { hasCustomerCompanyAccess, isAdminRole } from '@/app/utils/access-control';
import { contractIsActive, currentUsageCycle, isBaseContract } from '@/app/utils/billing-cycle';
import { commercialTransaction } from './commercialService';

type Db = Prisma.TransactionClient;
export type TipoAcao = 'EMITIR' | 'VISUALIZAR' | 'CADASTRAR_CLIENTE';
export type EffectivePlanLimits = {
  allowedBase: boolean; status: 'ATIVO' | 'EXPIRADO' | 'INATIVO' | 'LIMITE_ATINGIDO'; reason?: string;
  historyIdDisponivel?: string;
  planoBase?: { id: string; nome: string; slug: string; tipo: string; dataInicio: Date; dataFim: Date | null; diasTeste: number };
  limiteNotas: number; notasUsadas: number; limiteClientes: number; clientesUsados: number;
  limiteEmpresas: number; empresasUsadas: number; empresasAdicionais: number;
  unlimited: boolean;
  origem: 'ADMIN' | 'PLANO' | 'CUSTOM' | 'PACOTE' | 'SEM_PLANO';
};

async function billingState(db: Db, userId: string, now: Date) {
  const user = await db.user.findUnique({ where: { id: userId }, select: {
    id: true, role: true, empresaId: true, limiteEmpresas: true, empresasAdicionais: true, planoStatus: true, createdAt: true,
  } });
  const histories = await db.planHistory.findMany({ where: { userId, arquivadoEm: null, status: { in: ['ATIVO', 'EXPIRADO'] } },
    include: { plan: { select: { id: true, slug: true, diasTeste: true } },
      usageCycles: { where: { startsAt: { lte: now } }, orderBy: { startsAt: 'desc' }, take: 1 } },
    orderBy: [{ dataInicio: 'desc' }, { id: 'asc' }] });
  const active = histories.filter((h) => contractIsActive(h, now));
  // Multiple legacy base histories must not accidentally multiply a subscription.
  const base = active.find((h) => isBaseContract(h.tipoContratado));
  const valid = base ? [base, ...active.filter((h) => !isBaseContract(h.tipoContratado))] : [];
  const buckets = valid.map((history) => {
    const cycle = currentUsageCycle(history, now);
    const row = cycle && history.usageCycles.find((c) => c.startsAt.getTime() === cycle.startsAt.getTime());
    return { history, cycle, used: row?.used || 0, limit: Math.max(0, history.limiteNotasContratado ?? 0) };
  }).filter((bucket) => bucket.cycle !== null);
  const unlimited = !!user && isAdminRole(user.role) && user.planoStatus !== 'suspended';
  const allowed = !!user && user.planoStatus !== 'suspended' && (unlimited || !!base);
  const expired = histories.some((h) => isBaseContract(h.tipoContratado) && h.dataFim && h.dataFim <= now);
  return { user, base, buckets, allowed, expired, unlimited };
}

export async function getEffectivePlanLimits(userId: string, db: Db = prisma, now = new Date()): Promise<EffectivePlanLimits> {
  const { user, base, buckets, allowed, expired, unlimited } = await billingState(db, userId, now);
  const empty: EffectivePlanLimits = { allowedBase: false, status: expired ? 'EXPIRADO' : 'INATIVO',
    reason: expired ? 'Seu plano expirou. Renove para realizar novas operações.' : 'Nenhuma assinatura vigente para novas operações.',
    limiteNotas: 0, notasUsadas: 0, limiteClientes: 0, clientesUsados: 0, limiteEmpresas: 0, empresasUsadas: 0,
    empresasAdicionais: 0, unlimited: false, origem: 'SEM_PLANO' };
  if (!user) return { ...empty, reason: 'Usuário não encontrado.' };
  const companyWhere: Prisma.EmpresaWhereInput = { arquivadoEm: null, OR: [
    { donoFaturamentoId: userId }, { proprietarioUserId: userId }, { id: user.empresaId || '' },
    ...(user.role === 'CONTADOR' ? [{ contadoresLink: { some: { contadorId: userId, status: 'APROVADO', arquivadoEm: null } } }] : []),
  ] };
  const [clientesUsados, empresasUsadas] = await Promise.all([
    db.vinculoCarteira.count({ where: { arquivadoEm: null, empresa: companyWhere } }), db.empresa.count({ where: companyWhere }),
  ]);
  const counts = { clientesUsados, empresasUsadas, limiteEmpresas: Math.max(0, user.limiteEmpresas) + Math.max(0, user.empresasAdicionais), empresasAdicionais: user.empresasAdicionais };
  if (unlimited) return { ...counts, allowedBase: true, status: 'ATIVO', unlimited: true,
    limiteNotas: 0, notasUsadas: 0, limiteClientes: 0,
    planoBase: { id: 'ADMIN_UNLIMITED', nome: 'Administrativo Customizado', slug: 'ADMIN_UNLIMITED', tipo: 'CUSTOM',
      dataInicio: user.createdAt, dataFim: null, diasTeste: 0 }, origem: 'ADMIN' };
  if (!allowed || !base) return { ...empty, ...counts, ...(user.planoStatus === 'suspended' ? { status: 'INATIVO', reason: 'Acesso operacional suspenso. Consulte o atendimento.' } : {}) };
  return { ...counts, allowedBase: true, status: 'ATIVO', unlimited: false,
    historyIdDisponivel: buckets.find((b) => b.used < b.limit)?.history.id,
    limiteNotas: buckets.reduce((sum, b) => sum + b.limit, 0), notasUsadas: buckets.reduce((sum, b) => sum + b.used, 0),
    limiteClientes: buckets.reduce((sum, b) => sum + Math.max(0, b.history.limiteClientesContratado ?? 0), 0),
    planoBase: { id: base.planId, nome: base.nomeContratado || 'Plano contratado', slug: base.plan.slug, tipo: base.tipoContratado!,
      dataInicio: base.dataInicio, dataFim: base.dataFim, diasTeste: base.plan.diasTeste },
    origem: base.tipoContratado === 'CUSTOM' ? 'CUSTOM' : 'PLANO' };
}

export async function checkPlanLimits(userId: string, acao: TipoAcao = 'EMITIR', db: Db = prisma) {
  const limits = await getEffectivePlanLimits(userId, db);
  // Subscription expiry does not confiscate access to historical fiscal data;
  // authentication and company ACLs remain mandatory in the calling route.
  if (acao === 'VISUALIZAR') return { ...limits, allowed: true, historyId: undefined };
  if (!limits.allowedBase) return { ...limits, allowed: false, historyId: undefined };
  if (limits.unlimited) return { ...limits, allowed: true, historyId: undefined };
  const exhausted = acao === 'EMITIR' ? limits.notasUsadas >= limits.limiteNotas : limits.clientesUsados >= limits.limiteClientes;
  return { ...limits, allowed: !exhausted, historyId: limits.historyIdDisponivel,
    ...(exhausted ? { status: 'LIMITE_ATINGIDO', reason: acao === 'EMITIR'
      ? 'Créditos de emissão esgotados neste ciclo. Consulte os pacotes adicionais.' : 'Limite de clientes da carteira atingido.' } : {}) };
}

export async function resolveBillingUserId(params: { empresaId: string; actorUserId: string; acao?: TipoAcao }, db: Db = prisma) {
  const actor = await db.user.findUnique({ where: { id: params.actorUserId }, select: { id: true, role: true, empresaId: true } });
  if (!actor || !await hasCustomerCompanyAccess(actor, params.empresaId, db)) throw Object.assign(new Error('Sem acesso à empresa para resolver a cobrança.'), { status: 403 });
  const company = await db.empresa.findFirst({ where: { id: params.empresaId, arquivadoEm: null }, select: {
    donoFaturamentoId: true, proprietarioUserId: true, modoCobranca: true, contadorCustodianteId: true,
    donoUser: { select: { id: true, role: true } },
  } });
  if (!company) throw new Error('Empresa indisponível para cobrança.');
  if (company.modoCobranca === 'POR_OPERADOR') return actor.id;
  const owner = company.donoFaturamentoId || company.proprietarioUserId || company.donoUser?.id || company.contadorCustodianteId;
  if (!owner) throw new Error('Defina o responsável pelo faturamento antes de emitir.');
  return owner;
}

/** Must run in the same transaction as job creation. The request key belongs to
 * the company/idempotency key, never to a transient HTTP attempt. */
export async function reserveEmissionCreditInTransaction(db: Db, userId: string, requestKey: string, now = new Date()) {
  if (!requestKey || requestKey.length > 240) throw new Error('Invalid emission reservation key');
  const existing = await db.emissionCreditReservation.findUnique({ where: { requestKey }, include: { cycle: true } });
  if (existing) {
    if (existing.userId !== userId) throw new Error('Reservation owner mismatch');
    return { allowed: existing.status !== 'RELEASED', reserved: existing.status === 'RESERVED', status: existing.status,
      historyId: existing.cycle.historyId, reservationId: existing.id, unlimited: false,
      reason: existing.status === 'RELEASED' ? 'Reserva encerrada. Inicie nova tentativa explícita.' : undefined };
  }
  const { allowed, buckets, expired, unlimited } = await billingState(db, userId, now);
  if (!allowed) return { allowed: false, reserved: false, status: expired ? 'EXPIRADO' : 'INATIVO', historyId: null,
    reservationId: null, unlimited: false, reason: 'Assinatura não vigente para emissão.' };
  if (unlimited) return { allowed: true, reserved: false, status: 'ATIVO', historyId: null,
    reservationId: null, unlimited: true, reason: undefined };
  // Use the expiring base allocation before permanent add-on credits.
  for (const bucket of buckets) {
    if (!bucket.cycle || bucket.limit <= 0) continue;
    const cycle = await db.planUsageCycle.upsert({ where: { historyId_startsAt: { historyId: bucket.history.id, startsAt: bucket.cycle.startsAt } },
      create: { historyId: bucket.history.id, startsAt: bucket.cycle.startsAt, endsAt: bucket.cycle.endsAt }, update: {} });
    const reserved = await db.planUsageCycle.updateMany({ where: { id: cycle.id, used: { lt: bucket.limit } }, data: { used: { increment: 1 } } });
    if (!reserved.count) continue;
    const reservation = await db.emissionCreditReservation.create({ data: { userId, requestKey, cycleId: cycle.id } });
    return { allowed: true, reserved: true, status: 'ATIVO', historyId: bucket.history.id, reservationId: reservation.id, unlimited: false, reason: undefined };
  }
  return { allowed: false, reserved: false, status: 'LIMITE_ATINGIDO', historyId: null, reservationId: null, unlimited: false, reason: 'Créditos de emissão esgotados.' };
}

export async function reserveEmissionCredit(userId: string, requestKey: string, now = new Date()) {
  return commercialTransaction(userId, (tx) => reserveEmissionCreditInTransaction(tx, userId, requestKey, now));
}

/** Terminal CAS makes duplicate release/commit harmless and keeps the original cycle. */
export async function releaseEmissionCredit(reservationId?: string | null, db: Db = prisma) {
  if (!reservationId) return;
  const release = async (tx: Db) => {
    const reservation = await tx.emissionCreditReservation.findUnique({ where: { id: reservationId }, select: { cycleId: true } });
    if (!reservation) throw new Error('Unknown credit reservation; manual reconciliation required');
    const changed = await tx.emissionCreditReservation.updateMany({ where: { id: reservationId, status: 'RESERVED' }, data: { status: 'RELEASED', completedAt: new Date() } });
    if (changed.count) {
      const cycle = await tx.planUsageCycle.updateMany({ where: { id: reservation.cycleId, used: { gt: 0 } }, data: { used: { decrement: 1 } } });
      if (!cycle.count) throw new Error('Credit ledger underflow');
    }
  };
  if (db === prisma) await prisma.$transaction(release); else await release(db);
}

export async function consumeEmissionCredit(reservationId: string, db: Db = prisma) {
  const consume = async (tx: Db) => {
    const changed = await tx.emissionCreditReservation.updateMany({ where: { id: reservationId, status: 'RESERVED' }, data: { status: 'CONSUMED', completedAt: new Date() } });
    if (!changed.count) {
      const existing = await tx.emissionCreditReservation.findUnique({ where: { id: reservationId }, select: { status: true } });
      if (existing?.status !== 'CONSUMED') throw new Error('Released/missing credit cannot settle an authorized invoice');
    }
  };
  if (db === prisma) await prisma.$transaction(consume); else await consume(db);
}
