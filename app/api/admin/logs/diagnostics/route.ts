import { NextResponse } from 'next/server';
import nodemailer from 'nodemailer';
import { getAuthenticatedUser, forbidden, unauthorized } from '@/app/utils/api-middleware';
import { isAdminRole } from '@/app/utils/access-control';
import { decrypt } from '@/app/utils/crypto';
import { prisma } from '@/app/utils/prisma';
import { getErrorDiagnostics, inferDebugHint, sanitizeLogValue } from '@/app/services/logger';

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

export async function GET(request: Request) {
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
      const transporter = nodemailer.createTransport({
        host: config.smtpHost || '',
        port: config.smtpPort || 587,
        secure: config.smtpSecure,
        auth: {
          user: config.smtpUser || '',
          pass: decrypt(config.smtpPass || '') || '',
        },
        tls: {
          rejectUnauthorized: process.env.NODE_ENV === 'production',
        },
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
}
