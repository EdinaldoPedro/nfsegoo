import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { withApiGuard } from '@/app/utils/api-route';
import { EmailService } from '@/app/services/EmailService';
import { createLog, createTraceId } from '@/app/services/logger';
import { checkRateLimit } from '@/app/utils/rate-limit';
import { getPublicBaseUrl } from '@/app/utils/request-url';
import { getRequestIp } from '@/app/utils/request-ip';
import { CommercialError } from '@/app/utils/commercial-pricing';
import { markPasswordResetDelivered, markPasswordResetDeliveryFailed,
  normalizeRecoveryEmailInput, stagePasswordReset } from '@/app/services/passwordRecoveryService';
import { privateHash } from '@/app/utils/private-hash';

const PUBLIC_RECOVERY_MESSAGE = 'Se houver uma conta com este e-mail, voce recebera as instrucoes de recuperacao.';

async function waitForPrivateResponseWindow(startedAt: number) {
  // A floor plus jitter makes the no-account branch less distinguishable from
  // ordinary local/provider latency. Durable rate limits remain the main abuse
  // control; the response never reveals delivery or account existence.
  const targetMs = 900 + crypto.randomInt(0, 301);
  const remaining = targetMs - (Date.now() - startedAt);
  if (remaining > 0) await new Promise(resolve => setTimeout(resolve, remaining));
}

export const POST = withApiGuard(async function POST(request: Request) {
  const traceId = createTraceId('senha');
  const startedAt = Date.now();
  const requestPath = new URL(request.url).pathname;
  try {
    const email = normalizeRecoveryEmailInput(await request.json());
    const emailHash = privateHash('email-audit', email);
    const ip = getRequestIp(request);
    const [ipAllowed, emailAllowed] = await Promise.all([
      checkRateLimit(`forgot_ip_${ip}`, 3, 30 * 60 * 1000),
      checkRateLimit(`forgot_email_${email}`, 3, 30 * 60 * 1000),
    ]);
    if (!ipAllowed || !emailAllowed) {
      await createLog({ level: 'ALERTA', action: 'RECUPERACAO_SENHA_RATE_LIMIT', module: 'AUTH', traceId,
        requestPath, statusCode: 429, message: 'Limite de recuperação de senha atingido.', details: { emailHash } });
      return NextResponse.json({ error: 'Voce atingiu o limite de solicitacoes de recuperacao. Aguarde 30 minutos.' }, { status: 429 });
    }

    const staged = await stagePasswordReset(email);
    let delivered = false;
    if (staged) {
      const mail = new EmailService();
      const link = `${getPublicBaseUrl(request)}/redefinir-senha#token=${staged.token}`;
      const result = await mail.sendEmail(staged.user.email, 'Recuperacao de senha - NFSe Goo',
        mail.getTemplateRecuperacaoSenha(staged.user.nome, link), [],
        { traceId, userId: staged.user.id, requestPath, module: 'AUTH', dedupKey: `password-reset:${staged.requestId}:${staged.tokenHash}`,
          deliveryExpiresAt: new Date(Date.now() + 60 * 60 * 1000) });
      if (result.success) delivered = await markPasswordResetDelivered(staged.requestId, staged.tokenHash);
      else await markPasswordResetDeliveryFailed(staged.requestId, staged.tokenHash);
    }

    await createLog({ level: delivered ? 'INFO' : 'ALERTA', action: 'RECUPERACAO_SENHA_PROCESSADA', module: 'AUTH',
      traceId, requestPath, userId: staged?.user.id, statusCode: 200,
      message: 'Solicitação de recuperação processada sem revelar o resultado ao solicitante.',
      details: { emailHash, accountMatched: Boolean(staged), delivered } });
    await waitForPrivateResponseWindow(startedAt);
    return NextResponse.json({ message: PUBLIC_RECOVERY_MESSAGE });
  } catch (error) {
    if (error instanceof CommercialError) return NextResponse.json({ error: error.message }, { status: error.status });
    await createLog({ level: 'ERRO', action: 'RECUPERACAO_SENHA_ERRO_INTERNO', module: 'AUTH', traceId,
      requestPath, statusCode: 500, message: 'Falha interna ao processar recuperação de senha.',
      details: { errorName: error instanceof Error ? error.name : 'UnknownError', code: (error as { code?: unknown })?.code } });
    throw error;
  }
}, { maxBodyBytes: 8 * 1024 });
