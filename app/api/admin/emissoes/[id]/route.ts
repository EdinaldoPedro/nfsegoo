import { NextResponse } from 'next/server';
import { getAuthenticatedUser, forbidden, unauthorized } from '@/app/utils/api-middleware';
import { isSupportRole } from '@/app/utils/access-control';
import { prisma } from '@/app/utils/prisma';
import { sanitizeLogValue } from '@/app/services/logger';
import { stripEmpresaSecrets } from '@/app/utils/safe-data';

function sanitizeStoredDetails(details: string | null) {
  if (!details) return details;
  try {
    return JSON.stringify(sanitizeLogValue(JSON.parse(details)), null, 2);
  } catch {
    return sanitizeLogValue(details);
  }
}

export async function GET(request: Request, { params }: { params: { id: string } }) {
  const user = await getAuthenticatedUser(request);
  if (!user) return unauthorized();
  if (!isSupportRole(user.role)) return forbidden();

  const { id } = params;

  try {
    const empresa = await prisma.empresa.findUnique({ where: { id } });
    if (!empresa) return NextResponse.json({ error: 'Empresa nÃ£o encontrada' }, { status: 404 });

    const vendas = await prisma.venda.findMany({
      where: { empresaId: id, arquivadoEm: null } as any,
      include: {
        cliente: { select: { nome: true, documento: true } },
        notas: true,
        logs: { orderBy: { createdAt: 'desc' } },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    const vendasFormatadas = vendas.map((v) => ({
      ...v,
      logs: v.logs.map((log) => ({
        ...log,
        details: sanitizeStoredDetails(log.details),
      })),
      cliente: {
        ...v.cliente,
        razaoSocial: v.cliente.nome,
      },
    }));

    return NextResponse.json({ empresa: stripEmpresaSecrets(empresa), vendas: vendasFormatadas });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Erro ao buscar detalhes' }, { status: 500 });
  }
}
