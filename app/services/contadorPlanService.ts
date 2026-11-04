import { createHash } from 'node:crypto';
import { CommercialError } from '@/app/utils/commercial-pricing';
import { parseAccountantBenefit } from '@/app/utils/accountant-contract';
import { isAdminRole } from '@/app/utils/access-control';
import { commercialTransaction } from './commercialService';
import { grantPlanInTransaction, validateManualGrant } from './manualPlanGrantService';
import { getEffectivePlanLimits } from './planService';

const operationIdPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

function validateImmediateIncrease(input: { operationId: unknown; justification: string }) {
  if (typeof input.operationId !== 'string' || !operationIdPattern.test(input.operationId)) throw new CommercialError('Identificador da operação ausente. Reabra o formulário.');
  if (typeof input.justification !== 'string' || input.justification.trim().length < 10 || input.justification.length > 2000) throw new CommercialError('Justificativa de 10 a 2.000 caracteres obrigatória.');
}

/** Explicit administrative courtesy, separate from role changes and paid orders.
 * Every operation gets an immutable private catalog version. Future concessions
 * follow existing contracts; editing a collaborator never extends a subscription. */
export async function grantAccountantBenefit(input: { actorId: string; userId: string; operationId: unknown;
  justification: string; benefit: Record<string, unknown> }) {
  const benefit = parseAccountantBenefit(input.benefit);
  const version = createHash('sha256').update(JSON.stringify(benefit)).digest('hex').slice(0, 16);
  const slug = benefit.action === 'SUSPEND' ? 'SUSPENDED' : benefit.action === 'REACTIVATE' ? 'REACTIVATE'
    : `contador-${input.operationId}-${version}`;
  const grant = { ...input, planSlug: slug, cycle: benefit.cycle };
  if (benefit.action === 'INCREASE_NOW') validateImmediateIncrease(input);
  else validateManualGrant(grant);
  return commercialTransaction(input.userId, async (tx) => {
    const [actor, target] = await Promise.all([
      tx.user.findUnique({ where: { id: input.actorId }, select: { role: true } }),
      tx.user.findUnique({ where: { id: input.userId }, select: { role: true } }),
    ]);
    if (!isAdminRole(actor?.role) || target?.role !== 'CONTADOR') throw new CommercialError('Concessão exclusiva para contadores, autorizada por ADMIN ou MASTER.', 403);
    if (benefit.action === 'INCREASE_NOW') {
      const previous = await tx.systemLog.findUnique({ where: { id: input.operationId as string } });
      const fingerprint = createHash('sha256').update(JSON.stringify([input.actorId, input.userId, benefit.action, benefit.notes, benefit.customers])).digest('hex');
      if (previous) {
        let recorded: { fingerprint?: string } = {};
        try { recorded = JSON.parse(previous.details || '{}'); } catch { /* invalid legacy details cannot be reused */ }
        if (previous.action !== 'ACCOUNTANT_LIMIT_INCREASE' || recorded.fingerprint !== fingerprint) throw new CommercialError('Identificador já utilizado para outra operação.', 409);
        return { success: true, reused: true, appliedImmediately: true };
      }
      const now = new Date();
      const activeBases = await tx.planHistory.findMany({ where: { userId: input.userId, status: 'ATIVO', arquivadoEm: null,
        tipoContratado: { in: ['PLANO', 'CUSTOM'] }, dataInicio: { lte: now }, OR: [{ dataFim: null }, { dataFim: { gt: now } }] },
        include: { plan: true }, orderBy: [{ dataInicio: 'desc' }, { id: 'asc' }] });
      const active = activeBases[0];
      if (!active || active.tipoContratado !== 'CUSTOM') throw new CommercialError('Aumento imediato disponível somente para o plano CUSTOM ativo.', 409);
      const limits = await getEffectivePlanLimits(input.userId, tx, now);
      const before = { notes: active.limiteNotasContratado ?? active.plan.maxNotasMensal, customers: active.limiteClientesContratado ?? active.plan.maxClientes };
      if (benefit.notes < before.notes || benefit.customers < before.customers) throw new CommercialError('A personalização imediata permite apenas aumentar limites. Para reduzir, faça uma revisão contratual.', 409);
      if (benefit.notes < limits.notasUsadas || benefit.customers < limits.clientesUsados) throw new CommercialError('Os novos limites não podem ser menores que o consumo atual.', 409);
      if (benefit.notes === before.notes && benefit.customers === before.customers) throw new CommercialError('Informe ao menos um limite maior que o atual.', 409);
      const immediateSlug = `contador-${input.operationId}-${version}`;
      const newPlan = await tx.plan.create({ data: { slug: immediateSlug, name: 'Contador — personalização imediata',
        description: 'Versão administrativa do plano CUSTOM ativo; período e consumo foram preservados.', priceMonthly: 0,
        priceYearly: 0, features: '[]', maxNotasMensal: benefit.notes, maxClientes: benefit.customers, diasTeste: 0,
        active: true, privado: true, recommended: false, tipo: 'CUSTOM' } });
      await tx.planHistory.update({ where: { id: active.id }, data: { planId: newPlan.id, limiteNotasContratado: benefit.notes,
        limiteClientesContratado: benefit.customers, nomeContratado: newPlan.name } });
      await tx.user.update({ where: { id: input.userId }, data: { plano: newPlan.slug } });
      const after = { notes: benefit.notes, customers: benefit.customers };
      await tx.systemLog.create({ data: { id: input.operationId as string, level: 'ALERTA', action: 'ACCOUNTANT_LIMIT_INCREASE', module: 'FINANCEIRO',
        userId: input.actorId, message: `Limites do plano CUSTOM ativo ampliados imediatamente. ${input.justification}`,
        details: JSON.stringify({ fingerprint, historyId: active.id, before, after, preserved: { dataInicio: active.dataInicio, dataFim: active.dataFim, cicloInicio: active.cicloInicio } }) } });
      await tx.userEvent.create({ data: { userId: input.userId, tipo: 'FINANCEIRO', titulo: 'Limites personalizados ampliados',
        descricao: JSON.stringify({ operationId: input.operationId, actorId: input.actorId, historyId: active.id, before, after,
          justification: input.justification, dataInicio: active.dataInicio, dataFim: active.dataFim, cicloInicio: active.cicloInicio }) } });
      return { success: true, reused: false, appliedImmediately: true, historyId: active.id, before, after };
    }
    if (benefit.action === 'GRANT') {
      await tx.plan.upsert({ where: { slug }, update: {}, create: {
        slug, name: benefit.kind === 'DEFAULT' ? 'Contador Starter — concessão' : 'Contador — concessão personalizada',
        description: 'Benefício administrativo sem cobrança ou renovação automática; condições congeladas no contrato.',
        priceMonthly: 0, priceYearly: 0, features: '[]', maxNotasMensal: benefit.notes,
        maxClientes: benefit.customers, diasTeste: 0, active: true, privado: true, recommended: false, tipo: 'CUSTOM',
      } });
    }
    return grantPlanInTransaction(tx, grant);
  });
}
