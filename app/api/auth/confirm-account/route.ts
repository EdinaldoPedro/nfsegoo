import { NextResponse } from 'next/server';
import { withApiGuard } from '@/app/utils/api-route';
import { createAuthSession } from '@/app/utils/auth-session';
import { getRequestIp } from '@/app/utils/request-ip';
import { checkRateLimit } from '@/app/utils/rate-limit';
import { CommercialError } from '@/app/utils/commercial-pricing';
import { confirmRegistration, parseRegistrationConfirmation, RegistrationConflictError } from '@/app/services/registrationService';

export const POST = withApiGuard(async function POST(request: Request) {
  try {
    const { email, code } = parseRegistrationConfirmation(await request.json());
    const [ipAllowed, emailAllowed] = await Promise.all([
      checkRateLimit(`confirm_account_ip_${getRequestIp(request)}`, 8, 15 * 60 * 1000),
      checkRateLimit(`confirm_account_email_${email}`, 5, 15 * 60 * 1000),
    ]);
    if (!ipAllowed || !emailAllowed) return NextResponse.json({ error: 'Muitas tentativas. Aguarde e tente novamente.' }, { status: 429 });
    const user = await confirmRegistration(email, code);
    await createAuthSession(user, request);
    return NextResponse.json({ success: true, user: { id: user.id, nome: user.nome, email: user.email, role: user.role } });
  } catch (error) {
    if (error instanceof RegistrationConflictError) {
      return NextResponse.json({ error: error.message, code: 'ACCOUNT_ALREADY_EXISTS', fields: error.fields }, { status: 409 });
    }
    if (error instanceof CommercialError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
}, { maxBodyBytes: 8 * 1024 });
