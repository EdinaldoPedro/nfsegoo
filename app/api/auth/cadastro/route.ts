import { NextResponse } from 'next/server';
import { withApiGuard } from '@/app/utils/api-route';
import { EmailService } from '@/app/services/EmailService';
import { checkRateLimit } from '@/app/utils/rate-limit';
import { getRequestIp } from '@/app/utils/request-ip';
import { CommercialError } from '@/app/utils/commercial-pricing';
import { discardStagedRegistration, parseRegistrationInput, RegistrationConflictError,
  stageRegistration } from '@/app/services/registrationService';
import { requirePublicRegistrationOpen } from '@/app/utils/public-registration';

function conflictResponse(error: RegistrationConflictError) {
  const errors: Record<string, string> = {};
  if (error.fields.includes('email')) errors.email = error.pending
    ? 'Este e-mail já possui um cadastro aguardando confirmação.' : 'Este e-mail já está cadastrado.';
  if (error.fields.includes('cpf')) errors.cpf = error.pending
    ? 'Este CPF já possui um cadastro aguardando confirmação.' : 'Este CPF já está vinculado a uma conta.';
  return NextResponse.json({ error: error.message, code: error.pending ? 'PENDING_REGISTRATION_CONFLICT' : 'ACCOUNT_ALREADY_EXISTS',
    fields: error.fields, errors }, { status: 409 });
}

export const POST = withApiGuard(async function POST(request: Request) {
  try {
    requirePublicRegistrationOpen();
    const input = parseRegistrationInput(await request.json());
    const [ipAllowed, documentAllowed, emailAllowed] = await Promise.all([
      checkRateLimit(`cadastro_ip_${getRequestIp(request)}`, 10, 60 * 60 * 1000),
      checkRateLimit(`cadastro_doc_${input.cpf}`, 3, 60 * 60 * 1000),
      checkRateLimit(`cadastro_email_${input.email}`, 3, 60 * 60 * 1000),
    ]);
    if (!ipAllowed || !documentAllowed || !emailAllowed) {
      return NextResponse.json({ error: 'Muitas tentativas de cadastro. Aguarde e tente novamente.' }, { status: 429 });
    }
    const staged = await stageRegistration(input);
    const mail = new EmailService();
    const result = await mail.sendEmail(staged.email, 'Confirme seu cadastro',
      mail.getTemplateVerificacaoEmail(staged.nome, staged.code), [], { requestPath: '/api/auth/cadastro', module: 'AUTH',
        dedupKey: `registration:${staged.pendingId}:${staged.codeHash}`, deliveryExpiresAt: new Date(Date.now() + 15 * 60 * 1000) });
    if (!result.success) {
      await discardStagedRegistration(staged.pendingId, staged.codeHash);
      return NextResponse.json({ error: 'Não foi possível enviar o código. Nenhum cadastro pendente foi mantido.' }, { status: 502 });
    }
    return NextResponse.json({ success: true, message: 'Código enviado.', expiresInMinutes: 15 }, { status: 201 });
  } catch (error) {
    if (error instanceof RegistrationConflictError) return conflictResponse(error);
    if (error instanceof CommercialError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
}, { maxBodyBytes: 12 * 1024 });
