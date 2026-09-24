import { NextResponse } from 'next/server';
import { withApiGuard } from '@/app/utils/api-route';
import { getAuthenticatedUser, forbidden } from '@/app/utils/api-middleware';
import { requireAdminReauthentication } from '@/app/utils/admin-security';
import { CommercialError } from '@/app/utils/commercial-pricing';
import { grantAccountantBenefit } from '@/app/services/contadorPlanService';

export const POST = withApiGuard(async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getAuthenticatedUser(request);
  if (!actor || !['ADMIN', 'MASTER'].includes(actor.role)) return forbidden();
  const body = await request.json();
  const denied = await requireAdminReauthentication({ actorId: actor.id, password: body.adminPassword,
    justification: body.justification, action: 'ACCOUNTANT_BENEFIT' });
  if (denied) return denied;
  try {
    return NextResponse.json(await grantAccountantBenefit({ actorId: actor.id, userId: (await params).id,
      operationId: body.operationId, justification: body.justification, benefit: body }));
  } catch (error) {
    if (error instanceof CommercialError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
}, { maxBodyBytes: 16 * 1024 });
