import type { Prisma } from '@prisma/client';
import { prisma } from '@/app/utils/prisma';
import { CommercialError } from '@/app/utils/commercial-pricing';

const ROLES = ['MASTER', 'ADMIN', 'SUPORTE', 'SUPORTE_TI', 'COMERCIAL', 'CONTADOR', 'COMUM'];
export function parseAdminUserQuery(query: URLSearchParams) {
  if (Array.from(query.keys()).some(key => !['page', 'limit', 'search', 'roles', 'segment'].includes(key))) throw new CommercialError('Filtro de contas inválido.');
  const integer = (key: string, fallback: number, max: number) => {
    const raw = query.get(key) ?? String(fallback);
    if (!/^[1-9]\d{0,5}$/.test(raw) || Number(raw) > max) throw new CommercialError(`Parâmetro ${key} inválido.`);
    return Number(raw);
  };
  const search = (query.get('search') || '').trim();
  if (search.length > 120 || Array.from(search).some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)) throw new CommercialError('Busca inválida.');
  const rawRoles = (query.get('roles') || 'COMUM,CONTADOR').split(',');
  if (!rawRoles.length || rawRoles.some(role => !ROLES.includes(role)) || new Set(rawRoles).size !== rawRoles.length) throw new CommercialError('Papéis de conta inválidos.');
  const segment = query.get('segment') || 'ALL';
  if (!['ALL', 'ACTIVE', 'PAYING', 'TRIAL', 'ACCOUNTANT', 'NO_PLAN'].includes(segment)) throw new CommercialError('Segmento inválido.');
  return { page: integer('page', 1, 100000), limit: integer('limit', 25, 50), search, roles: rawRoles, segment };
}
export async function listAdminUsers(actorId: string, query: URLSearchParams) {
  const parsed = parseAdminUserQuery(query);
  return prisma.$transaction(async tx => {
    const actor = await tx.user.findUnique({ where: { id: actorId }, select: { role: true } });
    if (!actor || !['MASTER', 'ADMIN', 'SUPORTE', 'SUPORTE_TI'].includes(actor.role)) throw new CommercialError('Acesso administrativo não permitido.', 403);
    const allowed = actor.role === 'MASTER' ? ROLES : actor.role === 'ADMIN' ? ROLES.filter(role => role !== 'MASTER') : ['COMUM', 'CONTADOR'];
    if (parsed.roles.some(role => !allowed.includes(role))) throw new CommercialError('Este perfil não pode listar as contas solicitadas.', 403);
    const activeHistory: Prisma.PlanHistoryWhereInput = { status: 'ATIVO', arquivadoEm: null, dataInicio: { lte: new Date() },
      OR: [{ dataFim: null }, { dataFim: { gt: new Date() } }], tipoContratado: { in: ['PLANO', 'CUSTOM'] } };
    const paidHistory: Prisma.PlanHistoryWhereInput = { ...activeHistory, pedido: { status: 'ATIVADO_MANUALMENTE',
      valorPlano: { gt: 0 }, fatura: { is: { status: 'PAGO' } } } };
    const segment: Prisma.UserWhereInput = parsed.segment === 'ACTIVE' ? { planoStatus: { not: 'suspended' }, historicoPlanos: { some: activeHistory } }
      : parsed.segment === 'PAYING' ? { historicoPlanos: { some: paidHistory } }
      : parsed.segment === 'TRIAL' ? { AND: [{ historicoPlanos: { some: activeHistory } }, { historicoPlanos: { none: paidHistory } }] }
      : parsed.segment === 'ACCOUNTANT' ? { role: 'CONTADOR' }
      : parsed.segment === 'NO_PLAN' ? { historicoPlanos: { none: activeHistory } } : {};
    const where: Prisma.UserWhereInput = { role: { in: parsed.roles as any }, AND: [segment],
      ...(parsed.search ? { OR: [{ nome: { contains: parsed.search, mode: 'insensitive' } }, { email: { contains: parsed.search, mode: 'insensitive' } }] } : {}) };
    const select = { id: true, nome: true, email: true, role: true, telefone: true, cargo: true, planoStatus: true, planoCiclo: true,
      limiteEmpresas: true, empresaId: true, createdAt: true, updatedAt: true,
      empresa: { select: { id: true, documento: true, razaoSocial: true, ambiente: true, arquivadoEm: true } },
      historicoPlanos: { where: { status: 'ATIVO', arquivadoEm: null }, orderBy: [{ dataInicio: 'desc' as const }, { id: 'asc' as const }], take: 20,
        select: { id: true, status: true, tipoContratado: true, nomeContratado: true, dataInicio: true, dataFim: true,
          limiteNotasContratado: true, limiteClientesContratado: true, arquivadoEm: true,
          plan: { select: { id: true, slug: true, name: true, tipo: true, priceMonthly: true, priceYearly: true } },
          pedido: { select: { ciclo: true, valorPlano: true, valorTotal: true, cotacao: true, status: true,
            fatura: { select: { valorTotal: true, status: true } } } } } } } satisfies Prisma.UserSelect;
    const [rows, total] = await Promise.all([
      tx.user.findMany({ where, select, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], take: parsed.limit, skip: (parsed.page - 1) * parsed.limit }),
      tx.user.count({ where }),
    ]);
    return { data: rows.map(({ historicoPlanos, ...row }) => ({ ...row, planHistories: historicoPlanos.map(({ pedido, ...history }) => {
      const cart = pedido?.cotacao && typeof pedido.cotacao === 'object' && !Array.isArray(pedido.cotacao)
        ? (pedido.cotacao as { cart?: { qtdCiclos?: unknown } }).cart : null;
      const cycles = Number.isSafeInteger(Number(cart?.qtdCiclos)) && Number(cart?.qtdCiclos) > 0 ? Number(cart?.qtdCiclos) : 1;
      const orderTotal = Number(pedido?.valorTotal || 0), base = Number(pedido?.valorPlano || 0), paid = Number(pedido?.fatura?.valorTotal || 0);
      const monthlyValue = pedido?.status === 'ATIVADO_MANUALMENTE' && pedido.fatura?.status === 'PAGO' && orderTotal > 0
        ? paid * base / orderTotal / cycles / (pedido.ciclo === 'ANUAL' ? 12 : 1) : 0;
      return { ...history, monthlyValue };
    }) })),
      meta: { page: parsed.page, limit: parsed.limit, total, totalPages: Math.max(1, Math.ceil(total / parsed.limit)) } };
  }, { isolationLevel: 'RepeatableRead' });
}
