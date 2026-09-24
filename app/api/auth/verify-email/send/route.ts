import { withApiGuard } from '@/app/utils/api-route';
import { NextResponse } from 'next/server';
import { EmailService } from '@/app/services/EmailService';
import { getAuthenticatedUser, unauthorized } from '@/app/utils/api-middleware';
import { checkRateLimit } from '@/app/utils/rate-limit';
import { CommercialError } from '@/app/utils/commercial-pricing';
import { discardStagedEmailChange, normalizeEmailChangeInput, stageEmailChange } from '@/app/services/emailChangeService';
import { privateHash } from '@/app/utils/private-hash';

export const POST = withApiGuard(async function POST(request: Request) {
  const authenticated = await getAuthenticatedUser(request);
  if (!authenticated) return unauthorized();
  try {
    const { email, password } = normalizeEmailChangeInput(await request.json());
    const emailHash = privateHash('email-rate-limit', email);
    if (!await checkRateLimit('verify_email_send_' + authenticated.id, 5, 30 * 60 * 1000)
      || !await checkRateLimit('verify_email_target_' + emailHash, 5, 30 * 60 * 1000)) {
      return NextResponse.json({ error: 'Muitas solicitações. Aguarde 30 minutos.' }, { status: 429 });
    }
    const staged = await stageEmailChange(authenticated.id, authenticated.sessionVersion, email, password);
    const mail = new EmailService();
    const sent = await mail.sendEmail(email, 'Código de verificação - NFSe Goo', mail.getTemplateVerificacaoEmail(authenticated.nome, staged.code),
      [], { userId: authenticated.id, requestPath: '/api/auth/verify-email/send', module: 'AUTH',
        dedupKey: `email-change:${authenticated.id}:${staged.storedHash}`, deliveryExpiresAt: new Date(Date.now() + 15 * 60 * 1000) });
    if (!sent.success) {
      await discardStagedEmailChange(authenticated.id, staged.email, staged.storedHash);
      return NextResponse.json({ error: 'Não foi possível enviar o código. Nenhuma alteração foi mantida.' }, { status: 502 });
    }
    return NextResponse.json({ success: true, expiresInMinutes: 15 });
  } catch (error) {
    if (error instanceof CommercialError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
}, { maxBodyBytes: 8 * 1024 });
