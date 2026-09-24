import { withApiGuard } from '@/app/utils/api-route';
import { NextResponse } from 'next/server';
import nodemailer from 'nodemailer';
import { isIP } from 'node:net';
import { getAuthenticatedUser, forbidden, unauthorized } from '@/app/utils/api-middleware';
import { isAdminRole } from '@/app/utils/access-control';
import { decrypt } from '@/app/utils/crypto';
import { prisma } from '@/app/utils/prisma';
import { getErrorDiagnostics, inferDebugHint, sanitizeLogValue } from '@/app/services/logger';
import { assertSmtpHostAllowed, normalizeSmtpHost } from '@/app/utils/smtp-security';

export const dynamic = 'force-dynamic';

function statusFrom(ok: boolean, warning = false) {
  if (ok) return warning ? 'ALERTA' : 'OK';
  return warning ? 'ALERTA' : 'ERRO';
}

async function withTiming<T>(fn: () => Promise<T>) {
  const startedAt = Date.now();
  try {
    const data = await fn();
    return { ok: true, durationMs: Date.now() - startedAt, data };
  } catch (error: any) {
    return {
      ok: false,
      durationMs: Date.now() - startedAt,
      error: sanitizeLogValue(getErrorDiagnostics(error)),
      hint: inferDebugHint(error),
    };
  }
}

export const GET = withApiGuard(async function GET(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return unauthorized();
  if (!isAdminRole(user.role) && user.role !== 'SUPORTE_TI') return forbidden();

  const dbCheck = await withTiming(async () => {
    await prisma.$queryRaw`SELECT 1`;
    return { message: 'Banco respondeu normalmente.' };
  });

  const config = await prisma.configuracaoSistema.findUnique({ where: { id: 'config' } });
  const smtpConfigured = Boolean(config?.smtpHost && config.smtpUser && config.smtpPass);
  let smtpCheck: any = {
    ok: false,
    durationMs: 0,
    data: {
      message: 'SMTP nao configurado.',
      host: config?.smtpHost || null,
      user: config?.smtpUser || null,
    },
    hint: 'Configure host, usuario e senha SMTP em Configuracoes do SaaS.',
  };

  if (smtpConfigured && config) {
    smtpCheck = await withTiming(async () => {
      const host = normalizeSmtpHost(config.smtpHost || '');
      await assertSmtpHostAllowed(host);
      const transporter = nodemailer.createTransport({
        host,
        port: config.smtpPort || 587,
        secure: config.smtpSecure,
        auth: {
          user: config.smtpUser || '',
          pass: decrypt(config.smtpPass || '') || '',
        },
        tls: { rejectUnauthorized: true, servername: isIP(host) ? undefined : host },
      });

      await transporter.verify();
      return {
        message: 'SMTP autenticou e respondeu ao verify().',
        host: config.smtpHost,
        port: config.smtpPort,
        secure: config.smtpSecure,
        remetente: config.emailRemetente || config.smtpUser,
      };
    });
  }

  const lastEmailError = await prisma.systemLog.findFirst({
    where: { action: 'FALHA_ENVIO_EMAIL' },
    orderBy: { createdAt: 'desc' },
  });

  const lastCriticalError = await prisma.systemLog.findFirst({
    where: { level: 'ERRO' },
    orderBy: { createdAt: 'desc' },
  });

  const [emailQueue, activeWorkers, overduePrivacy, overdueIncidents] = await Promise.all([
    prisma.emailOutbox.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.workerHeartbeat.findMany({ where: { updatedAt: { gt: new Date(Date.now() - 45_000) } },
      select: { productionEnabled: true, updatedAt: true }, take: 20 }),
    prisma.privacyRequest.count({ where: { status: { in: ['PENDENTE', 'EM_ANALISE', 'AGUARDANDO_TITULAR'] }, dueAt: { lt: new Date() } } }),
    prisma.securityIncident.count({ where: { status: { notIn: ['COMUNICADO', 'ENCERRADO'] }, riskToSubjects: 'RELEVANTE', regulatoryDeadlineAt: { lt: new Date() } } }),
  ]);
  const queuedEmails = emailQueue.filter(item => ['PENDENTE', 'ERRO_TEMPORARIO', 'PROCESSANDO'].includes(item.status))
    .reduce((sum, item) => sum + item._count._all, 0);
  const failedEmails = emailQueue.filter(item => ['ERRO_FINAL', 'EXPIRADO'].includes(item.status))
    .reduce((sum, item) => sum + item._count._all, 0);

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    checks: [
      {
        id: 'database',
        label: 'Banco de dados',
        status: statusFrom(dbCheck.ok),
        durationMs: dbCheck.durationMs,
        message: dbCheck.ok ? dbCheck.data?.message : 'Banco nao respondeu.',
        details: dbCheck.ok ? dbCheck.data : dbCheck.error,
        hint: dbCheck.ok ? null : dbCheck.hint,
      },
      {
        id: 'smtp',
        label: 'SMTP automatico',
        status: statusFrom(Boolean(smtpCheck.ok), !smtpConfigured),
        durationMs: smtpCheck.durationMs,
        message: smtpCheck.ok ? smtpCheck.data?.message : (smtpCheck.data?.message || 'SMTP falhou no verify().'),
        details: smtpCheck.ok ? smtpCheck.data : smtpCheck.error || smtpCheck.data,
        hint: smtpCheck.ok ? null : smtpCheck.hint || 'Verifique host, porta, modo seguro, usuario, senha e limites do provedor.',
      },
      {
        id: 'worker',
        label: 'Worker operacional',
        status: activeWorkers.some(item => item.productionEnabled) ? 'OK' : 'ERRO',
        durationMs: null,
        message: activeWorkers.some(item => item.productionEnabled) ? 'Worker de produção enviando heartbeat.' : 'Nenhum worker de produção respondeu nos últimos 45 segundos.',
        details: { activeInstances: activeWorkers.length, productionInstances: activeWorkers.filter(item => item.productionEnabled).length },
        hint: activeWorkers.length ? 'Confirme FISCAL_WORKER_ALLOW_PRODUCTION no processo correto.' : 'Inicie o worker separado e confira sua conexão com o banco.',
      },
      {
        id: 'email-outbox',
        label: 'Fila durável de e-mail',
        status: failedEmails ? 'ALERTA' : 'OK',
        durationMs: null,
        message: `${queuedEmails} mensagem(ns) aguardando; ${failedEmails} expirada(s) ou em falha final.`,
        details: Object.fromEntries(emailQueue.map(item => [item.status, item._count._all])),
        hint: failedEmails ? 'Confirme SMTP e trate as falhas finais sem copiar conteúdo sensível para logs.' : null,
      },
      {
        id: 'regulatory-deadlines',
        label: 'Prazos de privacidade e incidentes',
        status: overduePrivacy || overdueIncidents ? 'ERRO' : 'OK',
        durationMs: null,
        message: `${overduePrivacy} solicitação(ões) de titular atrasada(s); ${overdueIncidents} incidente(s) relevante(s) sem comunicação registrada no prazo.`,
        details: { overduePrivacy, overdueIncidents },
        hint: overduePrivacy || overdueIncidents ? 'Abra as bancadas restritas e trate imediatamente os prazos.' : null,
      },
      {
        id: 'email-last-error',
        label: 'Ultima falha de e-mail',
        status: lastEmailError ? 'ALERTA' : 'OK',
        durationMs: null,
        message: lastEmailError ? lastEmailError.message : 'Nenhuma falha de e-mail registrada.',
        details: lastEmailError ? sanitizeLogValue(lastEmailError.details) : null,
        hint: lastEmailError?.debugHint || null,
      },
      {
        id: 'critical-last-error',
        label: 'Ultimo erro critico',
        status: lastCriticalError ? 'ALERTA' : 'OK',
        durationMs: null,
        message: lastCriticalError ? `${lastCriticalError.action}: ${lastCriticalError.message}` : 'Nenhum erro critico registrado.',
        details: lastCriticalError ? sanitizeLogValue(lastCriticalError.details) : null,
        hint: lastCriticalError?.debugHint || null,
      },
    ],
  });
});
