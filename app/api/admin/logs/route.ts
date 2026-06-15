import { NextResponse } from 'next/server';
import { getAuthenticatedUser, forbidden, unauthorized } from '@/app/utils/api-middleware';
import { sanitizeLogValue } from '@/app/services/logger';
import { prisma } from '@/app/utils/prisma';

export const dynamic = 'force-dynamic';

function sanitizeStoredDetails(details: string | null) {
  if (!details) return details;

  try {
    return JSON.stringify(sanitizeLogValue(JSON.parse(details)), null, 2);
  } catch {
    return sanitizeLogValue(details);
  }
}

function toInt(value: string | null, fallback: number, max?: number) {
  const parsed = Number.parseInt(value || '', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return max ? Math.min(parsed, max) : parsed;
}

function getDateFilter(period: string | null, from: string | null, to: string | null) {
  if (from || to) {
    const filter: any = {};
    if (from) filter.gte = new Date(from);
    if (to) filter.lte = new Date(to);
    return filter;
  }

  const now = Date.now();
  const hours = period === '1h' ? 1 : period === '7d' ? 24 * 7 : period === '30d' ? 24 * 30 : 24;
  return { gte: new Date(now - hours * 60 * 60 * 1000) };
}

export async function GET(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return unauthorized();
    if (!['MASTER', 'ADMIN', 'SUPORTE_TI'].includes(user.role)) return forbidden();

    const { searchParams } = new URL(request.url);
    const page = toInt(searchParams.get('page'), 1);
    const limit = toInt(searchParams.get('limit'), 80, 200);
    const level = searchParams.get('level');
    const module = searchParams.get('module');
    const traceId = searchParams.get('traceId');
    const vendaId = searchParams.get('vendaId');
    const empresaId = searchParams.get('empresaId');
    const search = searchParams.get('search')?.trim();
    const period = searchParams.get('period') || '24h';
    const includeDebug = searchParams.get('debug') === 'true';
    const errorsOnly = searchParams.get('errorsOnly') === 'true';
    const skip = (page - 1) * limit;

    const where: any = {
      createdAt: getDateFilter(period, searchParams.get('from'), searchParams.get('to')),
    };

    if (!includeDebug) {
      where.NOT = [
        { action: 'RATE_LIMIT_CHECK' },
        { level: 'DEBUG' },
      ];
    }

    if (errorsOnly) where.level = { in: ['ERRO', 'ALERTA'] };
    else if (level && level !== 'ALL') where.level = level;

    if (module && module !== 'ALL') where.module = module;
    if (traceId) where.traceId = traceId;
    if (vendaId) where.vendaId = vendaId;
    if (empresaId) where.empresaId = empresaId;

    if (search) {
      where.OR = [
        { message: { contains: search, mode: 'insensitive' } },
        { action: { contains: search, mode: 'insensitive' } },
        { module: { contains: search, mode: 'insensitive' } },
        { traceId: { contains: search, mode: 'insensitive' } },
        { details: { contains: search, mode: 'insensitive' } },
        { empresa: { razaoSocial: { contains: search, mode: 'insensitive' } } },
      ];
    }

    const dayStart = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const statsWhere = includeDebug
      ? { createdAt: { gte: dayStart } }
      : { createdAt: { gte: dayStart }, NOT: [{ action: 'RATE_LIMIT_CHECK' }, { level: 'DEBUG' }] };

    const [logs, total, errors24h, alerts24h, emailSuccess24h, emailErrors24h, modules, latestError] = await prisma.$transaction([
      prisma.systemLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip,
        include: {
          empresa: { select: { razaoSocial: true } },
          venda: { select: { id: true, status: true } },
        },
      }),
      prisma.systemLog.count({ where }),
      prisma.systemLog.count({ where: { ...statsWhere, level: 'ERRO' } }),
      prisma.systemLog.count({ where: { ...statsWhere, level: 'ALERTA' } }),
      prisma.systemLog.count({ where: { ...statsWhere, action: 'EMAIL_ENVIO_SUCESSO' } }),
      prisma.systemLog.count({ where: { ...statsWhere, action: 'FALHA_ENVIO_EMAIL' } }),
      prisma.systemLog.findMany({
        where: { module: { not: null } },
        distinct: ['module'],
        select: { module: true },
        orderBy: { module: 'asc' },
      }),
      prisma.systemLog.findFirst({
        where: { ...statsWhere, level: 'ERRO' },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const safeLogs = logs.map((log) => ({
      ...log,
      message: sanitizeLogValue(log.message),
      details: sanitizeStoredDetails(log.details),
    }));

    return NextResponse.json({
      data: safeLogs,
      meta: { total, page, totalPages: Math.ceil(total / limit), limit },
      stats: {
        errors24h,
        alerts24h,
        emailSuccess24h,
        emailErrors24h,
        latestError: latestError ? {
          id: latestError.id,
          action: latestError.action,
          message: latestError.message,
          createdAt: latestError.createdAt,
          debugHint: latestError.debugHint,
        } : null,
      },
      filters: {
        modules: modules.map((item) => item.module).filter(Boolean),
      },
    });
  } catch (error) {
    console.error('Erro ao buscar logs:', error);
    return NextResponse.json({ error: 'Erro ao buscar logs.' }, { status: 500 });
  }
}
