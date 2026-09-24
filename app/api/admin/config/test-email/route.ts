import { NextResponse } from 'next/server';
import { withApiGuard } from '@/app/utils/api-route';
import { getAuthenticatedUser, forbidden, unauthorized } from '@/app/utils/api-middleware';
import { isAdminRole } from '@/app/utils/access-control';
import { requireAdminReauthentication } from '@/app/utils/admin-security';
import { EmailService } from '@/app/services/EmailService';
import { createLog, createTraceId } from '@/app/services/logger';
import { prisma } from '@/app/utils/prisma';
import { CommercialError } from '@/app/utils/commercial-pricing';
import { assertSmtpHostAllowed, normalizeSmtpHost } from '@/app/utils/smtp-security';

export const POST = withApiGuard(async function POST(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return unauthorized();
  if (!isAdminRole(user.role)) return forbidden();
  const traceId = createTraceId('smtp');
  try {
    const body = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)
      || Object.keys(body).some(key => !['adminPassword', 'justification'].includes(key))) {
      return NextResponse.json({ error: 'Envie somente senha e justificativa para testar a configuração já salva.' }, { status: 400 });
    }
    const reauthentication = await requireAdminReauthentication({ actorId: user.id, password: body.adminPassword,
      justification: body.justification, action: 'SMTP_CONFIGURATION_TEST' });
    if (reauthentication) return reauthentication;
    const [account, config] = await Promise.all([
      prisma.user.findUnique({ where: { id: user.id }, select: { email: true, nome: true } }),
      prisma.configuracaoSistema.findUnique({ where: { id: 'config' }, select: { smtpHost: true, smtpUser: true,
        smtpPass: true, emailRemetente: true } }),
    ]);
    if (!account?.email || !config?.smtpHost || !config.smtpUser || !config.smtpPass || !config.emailRemetente) {
      return NextResponse.json({ error: 'Salve uma configuração SMTP completa antes do teste.' }, { status: 409 });
    }
    await assertSmtpHostAllowed(normalizeSmtpHost(config.smtpHost));
    const email = new EmailService();
    const result = await email.sendEmail(account.email, 'Teste de configuração - NFSe Goo',
      email.getTemplateContratacaoManual({ nome: account.nome, titulo: 'Configuração SMTP validada',
        mensagem: 'Esta mensagem confirma que o provedor salvo aceitou um envio transacional.' }), [],
      { traceId, userId: user.id, requestPath: '/api/admin/config/test-email', module: 'EMAIL', queueOnFailure: false });
    await createLog({ level: result.success ? 'INFO' : 'ERRO', action: result.success ? 'SMTP_TEST_SUCCESS' : 'SMTP_TEST_FAILED',
      module: 'EMAIL', traceId, userId: user.id, statusCode: result.success ? 200 : 502,
      message: result.success ? 'Teste da configuração SMTP salva concluído.' : 'Provedor recusou o teste da configuração SMTP salva.',
      details: { justification: String(body.justification).trim() } });
    if (!result.success) return NextResponse.json({ error: 'O provedor não aceitou a mensagem. Consulte o protocolo nos logs.' }, { status: 502 });
    return NextResponse.json({ success: true, message: 'Mensagem de teste aceita pelo provedor salvo.' });
  } catch (error) {
    if (error instanceof CommercialError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
}, { maxBodyBytes: 8 * 1024 });
