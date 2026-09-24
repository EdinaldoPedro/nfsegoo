import { NextResponse } from 'next/server';
import { withApiGuard } from '@/app/utils/api-route';
import { getAuthenticatedUser, forbidden, unauthorized } from '@/app/utils/api-middleware';
import { isAdminRole } from '@/app/utils/access-control';
import { requireAdminReauthentication } from '@/app/utils/admin-security';
import { prisma } from '@/app/utils/prisma';
import { CommercialError } from '@/app/utils/commercial-pricing';
import { parseSystemConfigMutation, publicSystemConfig, updateSystemConfig } from '@/app/services/systemConfigService';

export const GET = withApiGuard(async function GET(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return unauthorized();
  if (!isAdminRole(user.role)) return forbidden();
  const config = await prisma.configuracaoSistema.findUnique({ where: { id: 'config' } });
  return NextResponse.json(publicSystemConfig(config));
});

export const PUT = withApiGuard(async function PUT(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return unauthorized();
  if (!isAdminRole(user.role)) return forbidden();
  try {
    const mutation = parseSystemConfigMutation(await request.json());
    const reauthentication = await requireAdminReauthentication({ actorId: user.id, password: mutation.adminPassword,
      justification: mutation.justification, action: 'SYSTEM_CONFIGURATION_CHANGED' });
    if (reauthentication) return reauthentication;
    return NextResponse.json(await updateSystemConfig(user, mutation));
  } catch (error) {
    if (error instanceof CommercialError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
}, { maxBodyBytes: 32 * 1024 });
