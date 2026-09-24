import { withApiGuard } from '@/app/utils/api-route';
import { NextResponse } from 'next/server';
import { validateJsonContentLength, validateSameOrigin } from '@/app/utils/request-guards';
import { checkRateLimit } from '@/app/utils/rate-limit';
import { getRequestIp } from '@/app/utils/request-ip';
import { discardMfaEmailCode, stageMfaEmailCode } from '@/app/services/mfaLoginService';
import { EmailService } from '@/app/services/EmailService';

export const POST = withApiGuard(async function POST(request: Request) {
  const originError = validateSameOrigin(request);
  if (originError) return originError;
  const sizeError = validateJsonContentLength(request, 8 * 1024);
  if (sizeError) return sizeError;
  const body = await request.json().catch(() => ({}));
  if (typeof body.mfaChallenge !== 'string' || !/^[a-f0-9]{64}$/.test(body.mfaChallenge)) {
    return NextResponse.json({ error: 'Solicitação expirada. Informe a senha novamente.' }, { status: 400 });
  }
  const ip = getRequestIp(request);
  if (!(await checkRateLimit(`mfa_email_ip_${ip}`, 5, 15 * 60 * 1000))) return NextResponse.json({ error: 'Muitos envios. Aguarde 15 minutos.' }, { status: 429 });
  const staged = await stageMfaEmailCode(body.mfaChallenge);
  if (!staged) return NextResponse.json({ error: 'Solicitação expirada. Informe a senha novamente.' }, { status: 410 });
  if (!(await checkRateLimit(`mfa_email_user_${staged.challenge.userId}`, 3, 15 * 60 * 1000))) {
    await discardMfaEmailCode(staged.challenge.id, staged.storedHash);
    return NextResponse.json({ error: 'Muitos envios. Aguarde 15 minutos.' }, { status: 429 });
  }
  const mail = new EmailService();
  const sent = await mail.sendEmail(staged.challenge.user.email, 'Código de acesso - NFSe Goo',
    mail.getTemplateMfaLoginCode(staged.challenge.user.nome, staged.code), [], {
      userId: staged.challenge.userId, module: 'AUTH_MFA', requestPath: '/api/auth/mfa/email-code', queueOnFailure: false,
    });
  if (!sent.success) {
    await discardMfaEmailCode(staged.challenge.id, staged.storedHash);
    return NextResponse.json({ error: 'Não foi possível enviar o código agora. Use o aplicativo autenticador.' }, { status: 503 });
  }
  return NextResponse.json({ success: true, expiresInSeconds: 600 });
}, { maxBodyBytes: 8 * 1024 });
