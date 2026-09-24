import { Prisma } from '@prisma/client';
import { prisma } from '@/app/utils/prisma';
import { currentFiscalMonth, reportPeriod } from '@/app/utils/fiscal-report';
import { noteDateWhere, noteEnvironmentWhere } from './fiscalReportService';

export function fiscalStatsPeriods(now = new Date()) {
  const month = currentFiscalMonth(now);
  const current = reportPeriod(month.startDate, month.endDate, now);
  const previousEnd = new Date(Date.parse(month.startDate) - 86_400_000).toISOString().slice(0, 10);
  const previous = reportPeriod(previousEnd.slice(0, 7) + '-01', previousEnd, now);
  const dailyStart = new Date(Date.parse(month.endDate) - 29 * 86_400_000).toISOString().slice(0, 10);
  return { current, previous, daily: reportPeriod(dailyStart, month.endDate, now) };
}

/** Bounded administrative aggregates, with no document blobs. Fiscal values
 * exclude tests and unclassified legacy records. */
export async function getAdminFiscalStats(now = new Date()) {
  const periods = fiscalStatsPeriods(now);
  const production: Prisma.NotaFiscalWhereInput = { ambiente: 'PRODUCAO', arquivadoEm: null };
  const current = { ...production, AND: [noteDateWhere(periods.current.startsAt, periods.current.endsAt)] };
  const previous = { ...production, AND: [noteDateWhere(periods.previous.startsAt, periods.previous.endsAt)] };
  return prisma.$transaction(async (tx) => {
    const [total, byStatus, month, previousMonth, value, previousValue, cancelled, byEnvironment, legacy, estimated, cancellationDateUnknown, daily] = await Promise.all([
      tx.notaFiscal.count({ where: production }),
      tx.notaFiscal.groupBy({ by: ['status'], where: production, _count: { _all: true } }),
      tx.notaFiscal.count({ where: { ...current, status: 'AUTORIZADA' } }),
      tx.notaFiscal.count({ where: { ...previous, status: 'AUTORIZADA' } }),
      tx.notaFiscal.aggregate({ where: { ...current, status: 'AUTORIZADA' }, _sum: { valor: true } }),
      tx.notaFiscal.aggregate({ where: { ...previous, status: 'AUTORIZADA' }, _sum: { valor: true } }),
      tx.notaFiscal.count({ where: { ...production, status: 'CANCELADA', dataCancelamento: { gte: periods.current.startsAt, lt: periods.current.endsAt } } }),
      tx.notaFiscal.groupBy({ by: ['ambiente'], where: { arquivadoEm: null }, _count: { _all: true } }),
      tx.notaFiscal.count({ where: { arquivadoEm: null, AND: [noteEnvironmentWhere('LEGADO')] } }),
      tx.notaFiscal.count({ where: { ...current, status: 'AUTORIZADA', dataEmissao: null } }),
      tx.notaFiscal.count({ where: { ...production, status: 'CANCELADA', dataCancelamento: null } }),
      tx.$queryRaw<Array<{ day: string; count: number }>>`
        SELECT to_char(COALESCE("dataEmissao", "createdAt") AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD') AS day,
          count(*)::integer AS count
        FROM "NotaFiscal" WHERE "ambiente" = 'PRODUCAO' AND "arquivadoEm" IS NULL AND "status" = 'AUTORIZADA'
          AND COALESCE("dataEmissao", "createdAt") >= ${periods.daily.startsAt}
          AND COALESCE("dataEmissao", "createdAt") < ${periods.daily.endsAt}
        GROUP BY day ORDER BY day ASC
      `,
    ]);
    const byDay: Record<string, number> = {};
    for (let day = Date.parse(periods.daily.startDate); day <= Date.parse(periods.daily.endDate); day += 86_400_000) {
      byDay[new Date(day).toISOString().slice(0, 10)] = 0;
    }
    for (const row of daily) byDay[row.day] = row.count;
    return { total, byStatus, month, previousMonth, value: value._sum.valor?.toFixed(2) ?? '0.00',
      previousValue: previousValue._sum.valor?.toFixed(2) ?? '0.00', cancelled, byEnvironment, legacy, estimated,
      cancellationDateUnknown, byDay, ambiente: 'PRODUCAO' as const };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 15000 });
}
