import { Prisma } from '@prisma/client';
import { prisma } from '@/app/utils/prisma';
import { CommercialError } from '@/app/utils/commercial-pricing';

type MetricsRow = { total: bigint; active: bigint; paying: bigint; trial: bigint; accountants: bigint; no_plan: bigint; new30: bigint; cancelled30: bigint; mrr: Prisma.Decimal | null };
const METRICS_SQL = [
  'WITH customers AS (SELECT "id", "role", "planoStatus", "createdAt" FROM "User" WHERE "role"::text IN (\'COMUM\',\'CONTADOR\')),',
  'base AS (SELECT h.*, ROW_NUMBER() OVER (PARTITION BY h."userId" ORDER BY h."dataInicio" DESC,h."id") rn',
  'FROM "PlanHistory" h JOIN customers u ON u."id"=h."userId" WHERE h."status"=\'ATIVO\' AND h."arquivadoEm" IS NULL',
  'AND h."dataInicio" <= $1 AND (h."dataFim" IS NULL OR h."dataFim" > $2) AND h."tipoContratado" IN (\'PLANO\',\'CUSTOM\')),',
  'billed AS (SELECT b."userId", CASE WHEN p."id" IS NULL OR p."valorTotal" <= 0 OR f."status" <> \'PAGO\' THEN 0::numeric',
  'ELSE (f."valorTotal"*p."valorPlano"/p."valorTotal")/GREATEST(COALESCE((p."cotacao"->\'cart\'->>\'qtdCiclos\')::int,1),1)',
  '/CASE WHEN p."ciclo"=\'ANUAL\' THEN 12 ELSE 1 END END monthly FROM base b',
  'LEFT JOIN "Pedido" p ON p."id"=b."pedidoId" AND p."status"=\'ATIVADO_MANUALMENTE\' LEFT JOIN "Fatura" f ON f."id"=p."faturaId" WHERE b.rn=1),',
  'cancelled AS (SELECT COUNT(DISTINCT h."userId")::bigint value FROM "PlanHistory" h JOIN customers u ON u."id"=h."userId"',
  'WHERE h."status" IN (\'CANCELADO\',\'CANCELADO_ADM\') AND h."dataFim" >= $3)',
  'SELECT COUNT(*)::bigint total,COUNT(*) FILTER(WHERE b."userId" IS NOT NULL AND c."planoStatus"<>\'suspended\')::bigint active,',
  'COUNT(*) FILTER(WHERE COALESCE(b.monthly,0)>0)::bigint paying,',
  'COUNT(*) FILTER(WHERE b."userId" IS NOT NULL AND COALESCE(b.monthly,0)=0)::bigint trial,',
  'COUNT(*) FILTER(WHERE c."role"::text=\'CONTADOR\')::bigint accountants,COUNT(*) FILTER(WHERE b."userId" IS NULL)::bigint no_plan,',
  'COUNT(*) FILTER(WHERE c."createdAt">=$3)::bigint new30,(SELECT value FROM cancelled)::bigint cancelled30,',
  'COALESCE(SUM(b.monthly),0)::numeric mrr FROM customers c LEFT JOIN billed b ON b."userId"=c."id"',
].join(' ');

export async function getCrmMetrics(actorId: string, now = new Date()) {
  const actor = await prisma.user.findUnique({ where: { id: actorId }, select: { role: true } });
  if (!actor || !['MASTER', 'ADMIN'].includes(actor.role)) throw new CommercialError('Acesso ao CRM não permitido.', 403);
  const since = new Date(now.getTime() - 30 * 86400000);
  // Static statement with bound dates; no request value is interpolated into SQL.
  const [row] = await prisma.$queryRawUnsafe<MetricsRow[]>(METRICS_SQL, now, now, since);
  const paying = Number(row?.paying || 0), cancelled = Number(row?.cancelled30 || 0), mrrTotal = Number(row?.mrr || 0);
  return { totalClientes: Number(row?.total || 0), clientesAtivos: Number(row?.active || 0), clientesPagantes: paying,
    clientesTrial: Number(row?.trial || 0), contadores: Number(row?.accountants || 0), semPlano: Number(row?.no_plan || 0),
    novosClientes30d: Number(row?.new30 || 0), cancelamentos30d: cancelled,
    mrrTotal, arrTotal: mrrTotal * 12, churnRate: paying + cancelled ? Number((cancelled * 100 / (paying + cancelled)).toFixed(1)) : 0,
    metricBasis: 'CONTRATOS_ATIVOS_PAGOS_COTACAO_CONGELADA' };
}
