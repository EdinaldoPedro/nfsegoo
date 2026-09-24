import { NextResponse } from 'next/server';
import { withApiGuard } from '@/app/utils/api-route';
import { getAuthenticatedUser, forbidden, unauthorized } from '@/app/utils/api-middleware';
import { isSupportRole } from '@/app/utils/access-control';
import { enqueueFiscalNoteOperation } from '@/app/services/fiscalNoteService';
import { checkRateLimit } from '@/app/utils/rate-limit';

export const POST = withApiGuard(async function POST(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return unauthorized();
  if (!isSupportRole(user.role)) return forbidden();
  if (!await checkRateLimit('consult_note_' + user.id, 10, 60_000)) return NextResponse.json({ error: 'Aguarde antes de solicitar novas consultas.' }, { status: 429 });
  const body = await request.json();
  try {
    const operation = await enqueueFiscalNoteOperation({ actorId: user.id, notaId: body.notaId, tipo: 'CONSULTAR' });
    return NextResponse.json({ accepted: true, operation, message: 'Consulta agendada. Situação local preservada até a confirmação.' }, { status: 202 });
  } catch (error) {
    const failure = error as Error & { status?: number };
    if (failure.status && failure.status < 500) return NextResponse.json({ error: failure.message }, { status: failure.status });
    throw error;
  }
});
