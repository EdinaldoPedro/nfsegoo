import { NextResponse } from 'next/server';
import { getAuthenticatedUser, unauthorized } from '@/app/utils/api-middleware';
import { prisma } from '@/app/utils/prisma';
import { normalizeNbsSearch } from '@/app/utils/nbs';

export async function GET(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return unauthorized();

  const { searchParams } = new URL(request.url);
  const rawSearch = searchParams.get('search') || '';
  const normalized = normalizeNbsSearch(rawSearch);
  const digits = rawSearch.replace(/\D/g, '');
  const terms = normalized.split(/\s+/).filter(Boolean).slice(0, 8);
  const limit = Math.min(Math.max(Number(searchParams.get('limit')) || 30, 1), 50);

  const data = await prisma.nbsCatalogo.findMany({
    where: {
      ativo: true,
      selecionavel: true,
      ...(terms.length || digits ? {
        AND: terms.map((term) => ({
          OR: [
            { descricaoNormalizada: { contains: term } },
            { codigoFormatado: { contains: term } },
            { codigoNumerico: { contains: term } },
          ],
        })),
      } : {}),
    },
    select: { codigoNumerico: true, codigoFormatado: true, descricao: true },
    orderBy: { codigoFormatado: 'asc' },
    take: limit,
  });

  return NextResponse.json({ data });
}
