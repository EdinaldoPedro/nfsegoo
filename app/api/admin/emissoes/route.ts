import { NextResponse } from 'next/server';
import { getAuthenticatedUser, forbidden, unauthorized } from '@/app/utils/api-middleware';
import { isSupportRole } from '@/app/utils/access-control';
import { prisma } from '@/app/utils/prisma';
import { stripEmpresaSecrets } from '@/app/utils/safe-data';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return unauthorized();
  if (!isSupportRole(user.role)) return forbidden();

  try {
    const emissores = await prisma.empresa.findMany({
      where: {
        OR: [{ certificadoA1: { not: null } }, { notasEmitidas: { some: {} } }, { logs: { some: {} } }],
      },
      include: {
        _count: {
          select: { notasEmitidas: true },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });

    const dataComErros = await Promise.all(
      emissores.map(async (emp) => {
        const erros = await prisma.systemLog.count({
          where: {
            empresaId: emp.id,
            level: 'ERRO',
            createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
    });
        return { ...stripEmpresaSecrets(emp), errosRecentes: erros };
      }),
    );

    return NextResponse.json(dataComErros);
  } catch {
    return NextResponse.json({ error: 'Erro interno ao listar.' }, { status: 500 });
  }
}
