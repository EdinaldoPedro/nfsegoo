import { NextResponse } from 'next/server';
import { withApiGuard } from '@/app/utils/api-route';
import { getAuthenticatedUser, forbidden, unauthorized } from '@/app/utils/api-middleware';
import { isAdminRole } from '@/app/utils/access-control';
import { requireAdminReauthentication } from '@/app/utils/admin-security';
import { resolveDpsIdentityConflict } from '@/app/services/emissionConflictResolutionService';

export const dynamic = 'force-dynamic';

export const POST = withApiGuard(async function POST(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return unauthorized();
  if (!isAdminRole(user.role)) return forbidden();
  const body = await request.json();
  if (typeof body.jobId !== 'string') return NextResponse.json({ error: 'Emissão inválida.' }, { status: 400 });
  const reauth = await requireAdminReauthentication({
    actorId: user.id,
    password: body.adminPassword,
    justification: body.justification,
    action: 'EMISSION_RESOLVE_DPS_IDENTITY_CONFLICT',
  });
  if (reauth) return reauth;
  try {
    const result = await resolveDpsIdentityConflict({ actorId: user.id, jobId: body.jobId, justification: String(body.justification).trim() });
    return NextResponse.json({ success: true, ...result,
      message: 'Conflito encerrado. O crédito foi liberado e a venda pode ser emitida novamente com numeração automática.' });
  } catch (error) {
    const failure = error as Error & { status?: number };
    if (failure.status && failure.status < 500) return NextResponse.json({ error: failure.message }, { status: failure.status });
    throw error;
  }
}, { maxBodyBytes: 16 * 1024 });
