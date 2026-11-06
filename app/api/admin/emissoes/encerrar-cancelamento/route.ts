import { NextResponse } from 'next/server';
import { closeUnconfirmedCancellation } from '@/app/services/fiscalNoteService';
import { getAuthenticatedUser, forbidden, unauthorized } from '@/app/utils/api-middleware';
import { withApiGuard } from '@/app/utils/api-route';
import { isAdminRole } from '@/app/utils/access-control';
import { requireAdminReauthentication } from '@/app/utils/admin-security';

export const dynamic = 'force-dynamic';

export const POST = withApiGuard(async function POST(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return unauthorized();
  if (!isAdminRole(user.role)) return forbidden();
  const body = await request.json();
  if (!body || typeof body.operationId !== 'string'
    || Object.keys(body).some((key) => !['operationId', 'adminPassword', 'justification'].includes(key))) {
    return NextResponse.json({ error: 'Solicitação administrativa inválida.' }, { status: 400 });
  }
  const reauthentication = await requireAdminReauthentication({ actorId: user.id, password: body.adminPassword,
    justification: body.justification, action: 'CLOSE_UNCONFIRMED_CANCELLATION' });
  if (reauthentication) return reauthentication;
  try {
    const result = await closeUnconfirmedCancellation(user.id, body.operationId, body.justification);
    return NextResponse.json({ ...result, message: result.outcome === 'EVENT_FOUND'
      ? 'Um evento oficial foi localizado. A conclusão do cancelamento foi agendada, sem novo envio.'
      : 'A ausência do cancelamento foi confirmada duas vezes. A nota permanece autorizada e o cliente foi liberado.' });
  } catch (error) {
    const failure = error as Error & { status?: number };
    if (failure.status && failure.status < 500) return NextResponse.json({ error: failure.message }, { status: failure.status });
    throw error;
  }
}, { maxBodyBytes: 16 * 1024 });
