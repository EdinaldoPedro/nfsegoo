import nodemailer from 'nodemailer';
import { createLog, getErrorDiagnostics, inferDebugHint } from './logger';
import { decrypt } from '@/app/utils/crypto';
import { prisma } from '@/app/utils/prisma';

type EmailLogContext = {
  traceId?: string;
  userId?: string;
  empresaId?: string;
  vendaId?: string;
  requestPath?: string;
  module?: string;
};

export class EmailService {
  private async getTransporter() {
    const config = await prisma.configuracaoSistema.findUnique({ where: { id: 'config' } });

    if (config && config.smtpHost) {
      const smtpPass = decrypt(config.smtpPass) || config.smtpPass || '';

      return {
        transporter: nodemailer.createTransport({
          host: config.smtpHost,
          port: config.smtpPort || 587,
          secure: config.smtpSecure,
          auth: {
            user: config.smtpUser || '',
            pass: smtpPass,
          },
        }),
        remetente: config.emailRemetente || config.smtpUser || 'nao-responda@nfsegoo.com.br',
      };
    }

    if (process.env.SMTP_HOST) {
      return {
        transporter: nodemailer.createTransport({
          host: process.env.SMTP_HOST,
          port: Number(process.env.SMTP_PORT) || 587,
          secure: process.env.SMTP_SECURE === 'true',
          auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
          },
        }),
        remetente: process.env.SMTP_FROM || process.env.SMTP_USER || 'nao-responda@nfsegoo.com.br',
      };
    }

    throw new Error('SMTP nao configurado. Configure no Painel Admin ou .env');
  }

  async sendEmail(to: string, subject: string, html: string, attachments: any[] = [], context: EmailLogContext = {}) {
    const startedAt = Date.now();
    const moduleName = context.module || 'EMAIL';

    try {
      const { transporter, remetente } = await this.getTransporter();

      await createLog({
        level: 'INFO',
        action: 'EMAIL_ENVIO_INICIADO',
        message: `Preparando envio de e-mail para ${to}.`,
        module: moduleName,
        traceId: context.traceId,
        userId: context.userId,
        empresaId: context.empresaId,
        vendaId: context.vendaId,
        requestPath: context.requestPath,
        details: { to, subject, remetente, attachments: attachments.length },
      });

      const info = await transporter.sendMail({
        from: `"NFSe Goo" <${remetente}>`,
        to,
        subject,
        html,
        attachments,
      });

      console.log(`[EMAIL] Enviado para ${to} | ID: ${info.messageId}`);

      await createLog({
        level: 'INFO',
        action: 'EMAIL_ENVIO_SUCESSO',
        message: `E-mail aceito pelo provedor para ${to}.`,
        module: moduleName,
        traceId: context.traceId,
        userId: context.userId,
        empresaId: context.empresaId,
        vendaId: context.vendaId,
        requestPath: context.requestPath,
        durationMs: Date.now() - startedAt,
        details: { to, subject, messageId: info.messageId, accepted: info.accepted, rejected: info.rejected },
      });

      return { success: true, messageId: info.messageId };
    } catch (error: any) {
      console.error('[EMAIL ERROR]', error);

      await createLog({
        level: 'ERRO',
        action: 'FALHA_ENVIO_EMAIL',
        message: `Falha ao enviar para ${to}: ${error.message}`,
        module: moduleName,
        traceId: context.traceId,
        userId: context.userId,
        empresaId: context.empresaId,
        vendaId: context.vendaId,
        requestPath: context.requestPath,
        durationMs: Date.now() - startedAt,
        statusCode: typeof error?.responseCode === 'number' ? error.responseCode : undefined,
        debugHint: inferDebugHint(error, 'Verifique a configuracao SMTP, limite do provedor e conectividade do servidor.'),
        details: getErrorDiagnostics(error),
      });

      return { success: false, error: error.message };
    }
  }

  getTemplateRecuperacaoSenha(nome: string, link: string) {
    return `
      <div style="font-family: Arial, sans-serif; color: #334155; max-width: 600px; margin: auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 14px;">
        <h2 style="color: #2563eb; margin: 0 0 10px;">NFSe Goo</h2>
        <h3 style="color: #0f172a; margin: 0 0 16px;">Recuperacao de senha</h3>
        <p>Ola, <strong>${nome}</strong>.</p>
        <p>Recebemos um pedido para redefinir a senha da sua conta no <strong>NFSe Goo</strong>.</p>
        <p>Se foi voce que fez este pedido, clique no botao abaixo para criar uma nova senha segura:</p>
        <div style="text-align: center; margin: 28px 0;">
          <a href="${link}" style="background-color: #2563eb; color: white; padding: 14px 28px; text-decoration: none; border-radius: 10px; display: inline-block; font-weight: bold; font-size: 16px;">Redefinir minha senha</a>
        </div>
        <hr style="border: none; border-top: 1px solid #e2e8f0;" />
        <p style="font-size: 12px; color: #64748b; margin-top: 20px;">
          <strong>Seguranca:</strong> este link e de uso unico e expira em 1 hora. Nunca compartilhe este link ou sua senha.
        </p>
        <p style="font-size: 12px; color: #64748b;">
          Se voce nao solicitou esta alteracao, ignore este e-mail. Sua conta permanece segura.
        </p>
      </div>
    `;
  }

  getTemplateVerificacaoEmail(nome: string, codigo: string) {
    return `
      <div style="font-family: Arial, sans-serif; color: #334155; max-width: 600px; margin: auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 14px;">
        <h2 style="color: #2563eb; margin: 0 0 10px;">Confirmacao de e-mail</h2>
        <p>Ola, <strong>${nome}</strong>.</p>
        <p>Recebemos uma solicitacao para atualizar seu e-mail de acesso.</p>
        <p>Seu codigo de verificacao e:</p>
        <div style="background-color: #f8fafc; padding: 16px; font-size: 24px; font-weight: bold; text-align: center; letter-spacing: 5px; margin: 20px 0; border-radius: 10px; border: 1px solid #e2e8f0;">
          ${codigo}
        </div>
        <p style="font-size: 12px; color: #64748b;">Este codigo expira em 15 minutos.</p>
        <p style="font-size: 12px; color: #64748b;">Se nao foi voce, altere sua senha imediatamente.</p>
      </div>
    `;
  }

  getTemplateContratacaoManual(params: {
    nome: string;
    titulo: string;
    mensagem: string;
    pedidoId?: string;
    ticketProtocolo?: number | string | null;
    plano?: string | null;
    valor?: string | null;
    link?: string;
    motivo?: string | null;
  }) {
    const rows = [
      params.pedidoId ? `<p><strong>Pedido:</strong> ${params.pedidoId.slice(0, 8)}</p>` : '',
      params.ticketProtocolo ? `<p><strong>Ticket:</strong> #${params.ticketProtocolo}</p>` : '',
      params.plano ? `<p><strong>Plano:</strong> ${params.plano}</p>` : '',
      params.valor ? `<p><strong>Valor estimado:</strong> ${params.valor}</p>` : '',
      params.motivo ? `<p><strong>Observacao:</strong> ${params.motivo}</p>` : '',
    ].filter(Boolean).join('');

    return `
      <div style="font-family: Arial, sans-serif; color: #1e293b; max-width: 620px; margin: auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 14px;">
        <h2 style="color:#2563eb;margin:0 0 10px;">NFSe Goo</h2>
        <h3 style="margin:0 0 16px;color:#0f172a;">${params.titulo}</h3>
        <p>Ola, <strong>${params.nome}</strong>.</p>
        <p style="line-height:1.6;">${params.mensagem}</p>
        ${rows ? `<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:14px;margin:18px 0;">${rows}</div>` : ''}
        ${params.link ? `<div style="text-align:center;margin:24px 0;"><a href="${params.link}" style="background:#2563eb;color:white;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:bold;display:inline-block;">Abrir no NFSe Goo</a></div>` : ''}
        <p style="font-size:12px;color:#64748b;margin-top:24px;">Este e-mail e automatico. Para enviar documentos ou responder a equipe, use o suporte dentro da plataforma.</p>
      </div>
    `;
  }

  getTemplateRespostaSuporte(params: {
    nome: string;
    protocolo: number | string;
    assunto: string;
    trecho: string;
    link?: string;
    remetente?: string;
  }) {
    return `
      <div style="font-family: Arial, sans-serif; color: #1e293b; max-width: 620px; margin: auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 14px;">
        <h2 style="color:#2563eb;margin:0 0 10px;">NFSe Goo</h2>
        <h3 style="margin:0 0 16px;color:#0f172a;">Nova resposta no suporte</h3>
        <p>Ola, <strong>${params.nome}</strong>.</p>
        <p>Ha uma nova resposta no ticket <strong>#${params.protocolo}</strong>.</p>
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:14px;margin:18px 0;">
          <p><strong>Assunto:</strong> ${params.assunto}</p>
          ${params.remetente ? `<p><strong>Respondido por:</strong> ${params.remetente}</p>` : ''}
          <p style="line-height:1.6;"><strong>Trecho:</strong> ${params.trecho}</p>
        </div>
        ${params.link ? `<div style="text-align:center;margin:24px 0;"><a href="${params.link}" style="background:#2563eb;color:white;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:bold;display:inline-block;">Abrir ticket</a></div>` : ''}
        <p style="font-size:12px;color:#64748b;margin-top:24px;">Para proteger seus dados, detalhes sensiveis ficam disponiveis apenas dentro da plataforma.</p>
      </div>
    `;
  }
}
