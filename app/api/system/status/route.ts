import { NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/app/utils/api-middleware';
import { isSupportRole } from '@/app/utils/access-control';
import { prisma } from '@/app/utils/prisma';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const [user, config] = await Promise.all([
    getAuthenticatedUser(request),
    prisma.configuracaoSistema.findUnique({
      where: { id: 'config' },
      select: {
        manutencaoAtiva: true,
        manutencaoTitulo: true,
        manutencaoMensagem: true,
        manutencaoPrevisao: true,
        manutencaoAtualizadaEm: true,
      },
    }),
  ]);

  const staffBypass = isSupportRole(user?.role);

  return NextResponse.json({
    authenticated: Boolean(user),
    role: user?.role || null,
    staffBypass,
    maintenance: {
      active: Boolean(config?.manutencaoAtiva),
      title: config?.manutencaoTitulo || 'Estamos realizando uma atualização',
      message: config?.manutencaoMensagem || 'Estamos trabalhando para deixar sua experiência ainda melhor. Em breve, todos os serviços estarão disponíveis novamente.',
      forecast: config?.manutencaoPrevisao || null,
      updatedAt: config?.manutencaoAtualizadaEm || null,
    },
  }, {
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    },
  });
}
