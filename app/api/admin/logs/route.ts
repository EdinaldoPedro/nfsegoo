import { NextResponse } from 'next/server';
import { getAuthenticatedUser, forbidden, unauthorized } from '@/app/utils/api-middleware';
import { sanitizeLogValue } from '@/app/services/logger';
import { prisma } from '@/app/utils/prisma';

function sanitizeStoredDetails(details: string | null) {
  if (!details) return details;

  try {
    return JSON.stringify(sanitizeLogValue(JSON.parse(details)), null, 2);
  } catch {
    return sanitizeLogValue(details);
  }
}

export async function GET(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return unauthorized();
    if (!['MASTER', 'ADMIN', 'SUPORTE_TI'].includes(user.role)) return forbidden();

    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '50');
    const level = searchParams.get('level');
    const search = searchParams.get('search');
    const skip = (page - 1) * limit;

    const where: any = {};
    if (level && level !== 'ALL') where.level = level;
    if (search) {
      where.OR = [{ message: { contains: search } }, { action: { contains: search } }];
    }

    const [logs, total] = await prisma.$transaction([
      prisma.systemLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip,
        include: { empresa: { select: { razaoSocial: true } } },
      }),
      prisma.systemLog.count({ where }),
    ]);

    const safeLogs = logs.map((log) => ({
      ...log,
      message: sanitizeLogValue(log.message),
      details: sanitizeStoredDetails(log.details),
    }));

    return NextResponse.json({
      data: safeLogs,
      meta: { total, page, totalPages: Math.ceil(total / limit) },
    });
  } catch {
    return NextResponse.json({ error: 'Erro ao buscar logs.' }, { status: 500 });
  }
}
