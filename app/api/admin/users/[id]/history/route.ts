import { withApiGuard } from '@/app/utils/api-route';
import { NextResponse } from 'next/server';
import { getAuthenticatedUser, forbidden, unauthorized } from '@/app/utils/api-middleware';
import { isSupportRole } from '@/app/utils/access-control';
import { currentUsageCycle } from '@/app/utils/billing-cycle';
import { prisma } from '@/app/utils/prisma';

export const dynamic = 'force-dynamic';

export const GET = withApiGuard(async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getAuthenticatedUser(request);
  if (!actor) return unauthorized();
  if (!isSupportRole(actor.role)) return forbidden();
  const userId = (await params).id;
  const pageValue = new URL(request.url).searchParams.get('page') || '1';
  if (!/^[1-9][0-9]{0,5}$/.test(pageValue)) return NextResponse.json({ error: 'Página inválida.' }, { status: 400 });
  const page = Number(pageValue); const size = 30; const now = new Date();
  if (!await prisma.user.findUnique({ where: { id: userId }, select: { id: true } })) return NextResponse.json({ error: 'Usuário não encontrado.' }, { status: 404 });
  const [total, histories] = await Promise.all([
    prisma.planHistory.count({ where: { userId } }),
    prisma.planHistory.findMany({ where: { userId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * size, take: size,
      include: { plan: { select: { diasTeste: true } }, pedido: { select: { id: true, status: true } },
        usageCycles: { where: { startsAt: { lte: now } }, orderBy: { startsAt: 'desc' }, take: 1 } } }),
  ]);
  // Stable operation/pedido identifiers, never fuzzy email/timestamp correlations.
  const logs = await prisma.systemLog.findMany({ where: { id: { in: histories.map((h) => h.id) }, action: 'ADMIN_PLAN_OPERATION' },
    select: { id: true, userId: true, message: true } });
  const actorIds = logs.flatMap((log) => log.userId ? [log.userId] : []);
  const operators = actorIds.length ? await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, nome: true } }) : [];
  const data = histories.map((item) => {
    const audit = logs.find((log) => log.id === item.id);
    const cycle = currentUsageCycle(item, now);
    const usage = cycle ? item.usageCycles.find((row) => row.startsAt.getTime() === cycle.startsAt.getTime())?.used ?? 0 : null;
    const status = item.arquivadoEm ? 'ARQUIVADO' : item.status !== 'ATIVO' ? item.status
      : item.dataInicio > now ? 'AGENDADO' : item.dataFim && item.dataFim <= now ? 'EXPIRADO' : 'ATIVO';
    return { id: item.id, plano: item.nomeContratado || 'Contrato legado — conferir condições', status,
      dataInicio: item.dataInicio, dataFim: item.dataFim, tipo: item.tipoContratado,
      limiteNotas: item.limiteNotasContratado, limiteClientes: item.limiteClientesContratado,
      usoCicloAtual: usage, inicioCiclo: cycle?.startsAt, fimCiclo: cycle?.endsAt,
      pedidoId: item.pedido?.id || null,
      origem: audit ? 'MANUAL_ADMIN' : item.pedido ? 'PEDIDO' : item.plan.diasTeste > 0 ? 'TESTE' : 'LEGADO',
      justificativa: audit?.message || (item.pedido ? `Pedido ${item.pedido.id} — ${item.pedido.status}. Consulte a conciliação.`
        : item.plan.diasTeste > 0 ? 'Período de teste, sem pagamento.' : 'Origem histórica não vinculada a uma operação verificável. Não presume pagamento nem renovação automática.'),
      adminNome: audit ? operators.find((operator) => operator.id === audit.userId)?.nome || 'Operador não disponível' : '',
    };
  });
  return NextResponse.json(data, { headers: { 'X-Total-Count': String(total), 'X-Page': String(page), 'X-Page-Size': String(size) } });
});
