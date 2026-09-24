import { createHash } from 'node:crypto';
import { CommercialError } from '@/app/utils/commercial-pricing';
import { parseAccountantBenefit } from '@/app/utils/accountant-contract';
import { isAdminRole } from '@/app/utils/access-control';
import { commercialTransaction } from './commercialService';
import { grantPlanInTransaction, validateManualGrant } from './manualPlanGrantService';

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
  validateManualGrant(grant);
  return commercialTransaction(input.userId, async (tx) => {
    const [actor, target] = await Promise.all([
      tx.user.findUnique({ where: { id: input.actorId }, select: { role: true } }),
      tx.user.findUnique({ where: { id: input.userId }, select: { role: true } }),
    ]);
    if (!isAdminRole(actor?.role) || target?.role !== 'CONTADOR') throw new CommercialError('Concessão exclusiva para contadores, autorizada por ADMIN ou MASTER.', 403);
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
