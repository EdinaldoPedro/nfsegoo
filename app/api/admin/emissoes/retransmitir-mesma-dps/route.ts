import { NextResponse } from 'next/server';
import { withApiGuard } from '@/app/utils/api-route';
import { getAuthenticatedUser, forbidden, unauthorized } from '@/app/utils/api-middleware';
import { isAdminRole } from '@/app/utils/access-control';
import { requestIdenticalDpsRetransmission } from '@/app/services/emissionRetransmissionService';

export const dynamic = 'force-dynamic';

export const POST = withApiGuard(async function POST(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return unauthorized();
  if (!isAdminRole(user.role)) return forbidden();
  const body = await request.json();
  if (typeof body.jobId !== 'string' || typeof body.confirmation !== 'string') {
    return NextResponse.json({ error: 'Emissão e confirmação são obrigatórias.' }, { status: 400 });
  }
  const justification = 'Recuperação fiscal excepcional confirmada pelo administrador autenticado.';
  try {
    const result = await requestIdenticalDpsRetransmission({
      actorId: user.id,
      jobId: body.jobId,
      justification,
      expectedConfirmation: body.confirmation,
    });
    if (result.dpsFound) {
      return NextResponse.json({ accepted: true, retransmitted: false,
        message: 'A DPS apareceu durante a conferência. O sistema retomará somente as consultas para importar o resultado oficial.' }, { status: 202 });
    }
    return NextResponse.json({ accepted: true, retransmitted: true,
      message: 'Ausência confirmada duas vezes. O worker retransmitirá uma única vez o mesmo XML, com o mesmo número de DPS.' }, { status: 202 });
  } catch (error) {
    const failure = error as Error & { status?: number };
    if (failure.status && failure.status < 600) return NextResponse.json({ error: failure.message }, { status: failure.status });
    throw error;
  }
}, { maxBodyBytes: 16 * 1024 });
