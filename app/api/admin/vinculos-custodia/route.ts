import { CommercialError } from '@/app/utils/commercial-pricing';
import { withApiGuard } from '@/app/utils/api-route';
import { NextResponse } from 'next/server';
import { prisma } from '@/app/utils/prisma';
import { getAuthenticatedUser, forbidden, unauthorized } from '@/app/utils/api-middleware';
import { decideAccountantLink } from '@/app/services/accountantLinkService';
import { requireAdminReauthentication } from '@/app/utils/admin-security';
import { stripEmpresaSecrets } from '@/app/utils/safe-data';

const ADMIN_ROLES = ['MASTER', 'ADMIN'];

export const GET = withApiGuard(async function GET(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return unauthorized();
  if (!ADMIN_ROLES.includes(user.role)) return forbidden();

  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status') || 'PENDENTE_CUSTODIANTE';

  try {
    const vinculos = await prisma.contadorVinculo.findMany({
      where: {
        status,
        arquivadoEm: null,
      } as any,
      include: {
        contador: { select: { id: true, nome: true, email: true, telefone: true, role: true } },
        empresa: {
          include: {
            contadorCustodiante: { select: { id: true, nome: true, email: true, telefone: true, role: true } },
            donoUser: { select: { id: true, nome: true, email: true, telefone: true, role: true } },
          } as any,
        },
      },
      orderBy: { updatedAt: 'asc' },
    });

    return NextResponse.json({
      data: vinculos.map((vinculo: any) => ({
        ...vinculo,
        empresa: stripEmpresaSecrets(vinculo.empresa),
      })),
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Erro ao buscar vinculos.' }, { status: 500 });
  }
});

export const PUT = withApiGuard(async function PUT(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return unauthorized();
  if (!ADMIN_ROLES.includes(user.role)) return forbidden();
  const body = await request.json();
  const admin = ['MASTER', 'ADMIN'].includes(user.role);
  if (admin) {
    const denied = await requireAdminReauthentication({ actorId: user.id, password: body.adminPassword,
      justification: body.justification, action: 'ACCOUNTANT_LINK_DECISION' });
    if (denied) return denied;
  }
  try {
    return NextResponse.json(await decideAccountantLink({ actorId: user.id, linkId: body.vinculoId,
      action: body.acao === 'NEGAR' ? 'REJEITAR' : body.acao, adminReauthenticated: admin,
      justification: admin ? body.justification : undefined }));
  } catch (error) {
    if (error instanceof CommercialError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
}, { maxBodyBytes: 16 * 1024 });
