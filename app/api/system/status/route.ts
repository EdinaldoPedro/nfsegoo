import { withApiGuard } from '@/app/utils/api-route';
import { NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/app/utils/api-middleware';
import { internalCustomerGrantActive, isCustomerRole, isSupportRole } from '@/app/utils/access-control';
import { prisma } from '@/app/utils/prisma';
import { roleRequiresMfa } from '@/app/utils/mfa-policy';
import { publicRegistrationOpen } from '@/app/utils/public-registration';

export const dynamic = 'force-dynamic';

export const GET = withApiGuard(async function GET(request: Request) {
  try {
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
    available: true,
    authenticated: Boolean(user),
    userId: user?.id || null,
    mfaRequired: Boolean(user && roleRequiresMfa(user.role) && !user.mfaEnabledAt),
    legalAcceptanceRequired: Boolean(user && user.legalAcceptances.length === 0),
    role: user?.role || null,
    customerPortalAllowed: Boolean(user && (isCustomerRole(user.role) || internalCustomerGrantActive(user))),
    staffBypass,
    publicRegistration: { open: publicRegistrationOpen() },
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
  } catch {
    return NextResponse.json({
      available: false,
      error: 'Servico temporariamente indisponivel. Tente novamente em instantes.',
    }, { status: 503, headers: { 'Cache-Control': 'no-store, private', 'Retry-After': '30' } });
  }
});
