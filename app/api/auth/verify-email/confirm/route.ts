import { withApiGuard } from '@/app/utils/api-route';
import { NextResponse } from 'next/server';
import { getAuthenticatedUser, unauthorized } from '@/app/utils/api-middleware';
import { checkRateLimit } from '@/app/utils/rate-limit';
import { CommercialError } from '@/app/utils/commercial-pricing';
import { confirmEmailChange, normalizeEmailCode } from '@/app/services/emailChangeService';

export const POST = withApiGuard(async function POST(request: Request) {
  const authenticated = await getAuthenticatedUser(request);
  if (!authenticated) return unauthorized();
  try {
    const code = normalizeEmailCode(await request.json());
    if (!await checkRateLimit('verify_email_confirm_' + authenticated.id, 5, 15 * 60 * 1000)) {
      return NextResponse.json({ error: 'Muitas tentativas. Aguarde 15 minutos.' }, { status: 429 });
    }
    await confirmEmailChange(authenticated.id, authenticated.sessionVersion, code);
    return NextResponse.json({ success: true, requiresLogin: true, message: 'E-mail atualizado. Entre novamente com o novo endereço.' });
  } catch (error) {
    if (error instanceof CommercialError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
}, { maxBodyBytes: 4 * 1024 });
