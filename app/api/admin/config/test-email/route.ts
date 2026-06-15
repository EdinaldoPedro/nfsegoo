import { NextResponse } from 'next/server';
import nodemailer from 'nodemailer';
import { getAuthenticatedUser, forbidden, unauthorized } from '@/app/utils/api-middleware';
import { isAdminRole } from '@/app/utils/access-control';
import { decrypt } from '@/app/utils/crypto';
import { prisma } from '@/app/utils/prisma';
import { createLog, createTraceId, getErrorDiagnostics, inferDebugHint } from '@/app/services/logger';

export async function POST(request: Request) {
  const traceId = createTraceId('smtp');
  const startedAt = Date.now();
  const requestPath = new URL(request.url).pathname;
  const userAuth = await getAuthenticatedUser(request);
  if (!userAuth) return unauthorized();
  if (!isAdminRole(userAuth.role)) return forbidden();

  const userFull = await prisma.user.findUnique({ where: { id: userAuth.id } });
  if (!userFull || !userFull.email) {
    return NextResponse.json({ error: 'Usuario sem e-mail.' }, { status: 400 });
  }

  try {
    const body = await request.json();

    let passToUse = body.smtpPass;

    if (!passToUse || passToUse === '********') {
      const configSalva = await prisma.configuracaoSistema.findUnique({ where: { id: 'config' } });
      passToUse = decrypt(configSalva?.smtpPass || '') || '';
    }

    if (!body.smtpHost || !body.smtpUser || !passToUse) {
      return NextResponse.json({ error: 'Preencha host, usuario e senha para testar.' }, { status: 400 });
    }

    await createLog({
      level: 'INFO',
      action: 'SMTP_TESTE_INICIADO',
      message: `Teste SMTP iniciado por ${userFull.email}.`,
      module: 'EMAIL',
      traceId,
      userId: userFull.id,
      requestPath,
      details: {
        host: body.smtpHost,
        port: body.smtpPort,
        secure: body.smtpSecure === true,
        smtpUser: body.smtpUser,
        remetente: body.emailRemetente || body.smtpUser,
      },
    });

    const remetente = body.emailRemetente || body.smtpUser;
    const transporter = nodemailer.createTransport({
      host: body.smtpHost,
      port: Number(body.smtpPort) || 587,
      secure: body.smtpSecure === true,
      auth: {
        user: body.smtpUser,
        pass: passToUse,
      },
      tls: {
        rejectUnauthorized: process.env.NODE_ENV === 'production',
      },
    });

    await transporter.verify();

    await transporter.sendMail({
      from: `"NFSe Goo" <${remetente}>`,
      to: userFull.email,
      subject: 'Teste de configuracao - NFSe Goo',
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px; border: 1px solid #ccc; border-radius: 8px; color: #334155;">
          <h2 style="color: #16a34a; margin-top: 0;">Sucesso!</h2>
          <p>Ola, <strong>${userFull.nome}</strong>.</p>
          <p>Se voce recebeu este e-mail, as configuracoes SMTP do NFSe Goo estao funcionando corretamente.</p>
          <hr style="border: none; border-top: 1px solid #e2e8f0;" />
          <p style="font-size: 12px; color: #666;">
            <strong>Host:</strong> ${body.smtpHost}<br/>
            <strong>Porta:</strong> ${body.smtpPort}<br/>
            <strong>Seguro:</strong> ${body.smtpSecure ? 'Sim' : 'Nao'}
          </p>
        </div>
      `,
    });

    await createLog({
      level: 'INFO',
      action: 'SMTP_TESTE_SUCESSO',
      message: `SMTP validado e e-mail de teste enviado para ${userFull.email}.`,
      module: 'EMAIL',
      traceId,
      userId: userFull.id,
      requestPath,
      statusCode: 200,
      durationMs: Date.now() - startedAt,
      details: { to: userFull.email, host: body.smtpHost, port: body.smtpPort },
    });

    return NextResponse.json({
      success: true,
      message: `E-mail enviado com sucesso para ${userFull.email}!`,
    });
  } catch (error: any) {
    console.error('Erro SMTP:', error);
    await createLog({
      level: 'ERRO',
      action: 'SMTP_TESTE_FALHA',
      message: `Falha no teste SMTP: ${error.message}`,
      module: 'EMAIL',
      traceId,
      userId: userAuth?.id,
      requestPath,
      statusCode: 400,
      durationMs: Date.now() - startedAt,
      debugHint: inferDebugHint(error, 'Confira host, porta, modo seguro, usuario, senha e limites do provedor SMTP.'),
      details: getErrorDiagnostics(error),
    });

    return NextResponse.json(
      {
        error: 'Falha na conexao SMTP.',
        details: error.message,
      },
      { status: 400 },
    );
  }
}
