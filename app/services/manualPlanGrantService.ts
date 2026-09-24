import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { INTERNAL_CUSTOMER_GRANT_ROLES, internalCustomerGrantActive, isAdminRole } from '@/app/utils/access-control';
import { CommercialError, addCalendarMonths } from '@/app/utils/commercial-pricing';
import { commercialTransaction } from './commercialService';

export type ManualGrantInput = { actorId: string; userId: string; operationId: unknown;
  planSlug: unknown; cycle: unknown; justification: string };

export function validateManualGrant(input: ManualGrantInput) {
  if (typeof input.operationId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(input.operationId)) throw new CommercialError('Identificador da operação ausente. Reabra o formulário.');
  const control = input.planSlug === 'SUSPENDED' || input.planSlug === 'REACTIVATE';
  if (typeof input.planSlug !== 'string' || !input.planSlug || input.planSlug.length > 120 || (!control && !['MENSAL', 'ANUAL'].includes(String(input.cycle)))) throw new CommercialError('Plano ou ciclo inválido.');
  if (typeof input.justification !== 'string' || input.justification.trim().length < 10 || input.justification.length > 2000) throw new CommercialError('Justificativa de 10 a 2.000 caracteres obrigatória.');
  return { ...input, operationId: input.operationId, planSlug: input.planSlug, cycle: control ? 'MENSAL' : String(input.cycle) };
}

/** Caller holds the target user lock. A courtesy never settles an order or fabricates payment. */
export async function grantPlanInTransaction(tx: Prisma.TransactionClient, raw: ManualGrantInput) {
  const input = validateManualGrant(raw);
  const { operationId, planSlug: slug } = input;
  // Audit wording can change after reauthentication without changing the operation.
  const fingerprint = createHash('sha256').update(JSON.stringify([input.actorId, input.userId, slug, input.cycle])).digest('hex');
  const actor = await tx.user.findUnique({ where: { id: input.actorId }, select: { role: true } });
  const target = await tx.user.findUniqueOrThrow({ where: { id: input.userId } });
  const staffTarget = INTERNAL_CUSTOMER_GRANT_ROLES.includes(target.role);
  if (!isAdminRole(actor?.role) || (!['COMUM', 'CONTADOR'].includes(target.role) && !(staffTarget && internalCustomerGrantActive(target)))
    || (staffTarget && input.actorId === input.userId)) throw new CommercialError('Sem permissão para esta concessão.', 403);
  const previous = await tx.systemLog.findUnique({ where: { id: operationId } });
  if (previous) {
    if (previous.action !== 'ADMIN_PLAN_OPERATION' || previous.details !== fingerprint) throw new CommercialError('Identificador já utilizado para outra operação.', 409);
    return { success: true, reused: true };
  }
  const now = new Date();
  let scheduledStart: Date | null = null;
  let scheduledEnd: Date | null = null;
  if (slug === 'SUSPENDED' || slug === 'REACTIVATE') {
    // A suspension blocks new operations, not historical data or the paid contract.
    // Reactivation restores eligibility at the original dates; it never resets credits.
    await tx.user.update({ where: { id: input.userId }, data: { planoStatus: slug === 'SUSPENDED' ? 'suspended' : 'active' } });
  } else {
    if (target.planoStatus === 'suspended') throw new CommercialError('Reative explicitamente o acesso antes de conceder outro benefício.', 409);
    const plan = await tx.plan.findUnique({ where: { slug } });
    if (!plan || !plan.active || !['PLANO', 'CUSTOM', 'PACOTE_NOTAS', 'PACOTE_CLIENTES', 'PACOTE_PJ'].includes(plan.tipo)) throw new CommercialError('Produto indisponível para concessão.', 409);
    const base = ['PLANO', 'CUSTOM'].includes(plan.tipo);
    const histories = await tx.planHistory.findMany({ where: { userId: input.userId, status: 'ATIVO', arquivadoEm: null,
      tipoContratado: { in: ['PLANO', 'CUSTOM'] }, OR: [{ dataFim: null }, { dataFim: { gt: now } }] }, include: { plan: true } });
    let start = now;
    if (base) {
      for (const history of histories) {
        if (history.plan.diasTeste > 0 && !history.pedidoId) await tx.planHistory.update({ where: { id: history.id }, data: { status: 'FINALIZADO', dataFim: now } });
        else if (!history.dataFim) throw new CommercialError('Contrato sem vencimento: faça a revisão contratual antes de agendar uma concessão.', 409);
        else if (history.dataFim > start) start = history.dataFim;
      }
    } else if (!histories.some((history) => history.dataInicio <= now)) throw new CommercialError('Pacote exige assinatura vigente.', 409);
    const end = base ? plan.diasTeste > 0 ? new Date(start.getTime() + plan.diasTeste * 86_400_000)
      : addCalendarMonths(start, input.cycle === 'ANUAL' ? 12 : 1) : null;
    scheduledStart = start; scheduledEnd = end;
    await tx.planHistory.create({ data: { id: operationId, userId: input.userId, planId: plan.id, dataInicio: start, dataFim: end,
      limiteNotasContratado: base || plan.tipo === 'PACOTE_NOTAS' ? plan.maxNotasMensal : 0,
      limiteClientesContratado: base || plan.tipo === 'PACOTE_CLIENTES' ? plan.maxClientes : 0,
      tipoContratado: plan.tipo, nomeContratado: plan.name, cicloInicio: start } });
    await tx.user.update({ where: { id: input.userId }, data: {
      ...(base && start <= now ? { plano: plan.slug, planoStatus: 'active', planoExpiresAt: end, planoCiclo: input.cycle } : {}),
      ...(plan.tipo === 'PACOTE_PJ' ? { empresasAdicionais: { increment: 1 } } : {}),
    } });
  }
  await tx.systemLog.create({ data: { id: operationId, level: 'ALERTA', action: 'ADMIN_PLAN_OPERATION', module: 'FINANCEIRO',
    userId: input.actorId, message: `Operação administrativa sem quitação de pedido: ${slug}. ${input.justification}`, details: fingerprint } });
  await tx.userEvent.create({ data: { userId: input.userId, tipo: 'FINANCEIRO',
    titulo: slug === 'SUSPENDED' ? 'Acesso operacional suspenso' : slug === 'REACTIVATE' ? 'Acesso operacional reativado' : 'Concessão administrativa de benefício',
    descricao: JSON.stringify({ operationId, actorId: input.actorId, slug, cycle: input.cycle, justification: input.justification, scheduledStart, scheduledEnd }) } });
  return { success: true, reused: false, scheduledStart, scheduledEnd };
}

export async function grantPlanManually(input: ManualGrantInput) {
  validateManualGrant(input);
  return commercialTransaction(input.userId, (tx) => grantPlanInTransaction(tx, input));
}
