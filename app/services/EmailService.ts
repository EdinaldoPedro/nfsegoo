import nodemailer from 'nodemailer';
import { isIP } from 'node:net';
import { createLog, getErrorDiagnostics, inferDebugHint } from './logger';
import { decrypt } from '@/app/utils/crypto';
import { prisma } from '@/app/utils/prisma';
import { assertSmtpHostAllowed, normalizeSmtpHost } from '@/app/utils/smtp-security';
import { enqueueEmailDelivery } from '@/app/services/emailOutboxService';
import { privateHash } from '@/app/utils/private-hash';

type EmailLogContext = {
  traceId?: string;
  userId?: string;
  empresaId?: string;
  vendaId?: string;
  requestPath?: string;
  module?: string;
  queueOnFailure?: boolean;
  dedupKey?: string;
  deliveryExpiresAt?: Date;
};

function emailHash(value: string) {
  return privateHash('email-recipient', value.trim().toLowerCase());
}

function html(value: unknown) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]!);
}

function emailLink(value: string | undefined) {
  if (!value) return '';
  if (value.startsWith('/')) return html(value);
  try {
    const parsed = new URL(value);
    return ['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password ? html(parsed.toString()) : '';
  } catch {
    return '';
  }
}

export class EmailService {
  private async getTransporter() {
    const config = await prisma.configuracaoSistema.findUnique({ where: { id: 'config' } });

    if (config && config.smtpHost) {
      const smtpPass = decrypt(config.smtpPass);
      if (!smtpPass) throw new Error('SMTP_SECRET_UNAVAILABLE');
      const host = normalizeSmtpHost(config.smtpHost);
      await assertSmtpHostAllowed(host);

      return {
        transporter: nodemailer.createTransport({
          host,
          port: config.smtpPort || 587,
          secure: config.smtpSecure,
          requireTLS: !config.smtpSecure,
          connectionTimeout: 10_000,
          greetingTimeout: 10_000,
          socketTimeout: 20_000,
          tls: { rejectUnauthorized: true, servername: isIP(host) ? undefined : host },
          auth: {
            user: config.smtpUser || '',
            pass: smtpPass,
          },
        }),
        remetente: config.emailRemetente || config.smtpUser || 'nao-responda@nfsegoo.com.br',
      };
    }

    if (process.env.SMTP_HOST) {
      const host = normalizeSmtpHost(process.env.SMTP_HOST);
      await assertSmtpHostAllowed(host);
      return {
        transporter: nodemailer.createTransport({
          host,
          port: Number(process.env.SMTP_PORT) || 587,
          secure: process.env.SMTP_SECURE === 'true',
          requireTLS: process.env.SMTP_SECURE !== 'true',
          connectionTimeout: 10_000,
          greetingTimeout: 10_000,
          socketTimeout: 20_000,
          tls: { rejectUnauthorized: true, servername: isIP(host) ? undefined : host },
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
    const normalizedTo = to.trim().toLowerCase();
    const recipientHash = emailHash(normalizedTo);

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedTo) || normalizedTo.length > 254
      || !subject || subject.length > 200 || /[\r\n]/.test(subject) || !html || Buffer.byteLength(html, 'utf8') > 2_000_000) {
      return { success: false, error: 'INVALID_MESSAGE' } as const;
    }

    try {
      const { transporter, remetente } = await this.getTransporter();

      await createLog({
        level: 'INFO',
        action: 'EMAIL_ENVIO_INICIADO',
        message: 'Preparando envio de e-mail.',
        module: moduleName,
        traceId: context.traceId,
        userId: context.userId,
        empresaId: context.empresaId,
        vendaId: context.vendaId,
        requestPath: context.requestPath,
        details: { recipientHash, attachments: attachments.length },
      });

      const info = await transporter.sendMail({
        from: `"NFSe Goo" <${remetente}>`,
        to: normalizedTo,
        subject,
        html,
        attachments,
      });

      if (!info.accepted.length) {
        throw Object.assign(new Error('Mensagem recusada pelo provedor.'), { code: 'SMTP_RECIPIENT_REJECTED' });
      }

      console.log('[EMAIL] Mensagem aceita pelo provedor.');

      await createLog({
        level: 'INFO',
        action: 'EMAIL_ENVIO_SUCESSO',
        message: 'E-mail aceito pelo provedor.',
        module: moduleName,
        traceId: context.traceId,
        userId: context.userId,
        empresaId: context.empresaId,
        vendaId: context.vendaId,
        requestPath: context.requestPath,
        durationMs: Date.now() - startedAt,
        details: { recipientHash, acceptedCount: info.accepted.length, rejectedCount: info.rejected.length },
      });

      return { success: true, messageId: info.messageId };
    } catch (error: any) {
      const diagnostics = getErrorDiagnostics(error);
      console.error('[EMAIL ERROR]', { name: diagnostics.name, code: diagnostics.code, responseStatus: diagnostics.responseStatus });

      await createLog({
        level: 'ERRO',
        action: 'FALHA_ENVIO_EMAIL',
        message: 'Falha no envio de e-mail pelo provedor.',
        module: moduleName,
        traceId: context.traceId,
        userId: context.userId,
        empresaId: context.empresaId,
        vendaId: context.vendaId,
        requestPath: context.requestPath,
        durationMs: Date.now() - startedAt,
        statusCode: typeof error?.responseCode === 'number' ? error.responseCode : undefined,
        debugHint: inferDebugHint(error, 'Verifique a configuracao SMTP, limite do provedor e conectividade do servidor.'),
        details: { recipientHash, diagnostics },
      });

      if (process.env.EMAIL_OUTBOX_ENABLED === 'true' && context.queueOnFailure !== false && attachments.length === 0) {
        const queued = await enqueueEmailDelivery({ to: normalizedTo, subject, html, context: {
          traceId: context.traceId, userId: context.userId, empresaId: context.empresaId, vendaId: context.vendaId,
          requestPath: context.requestPath, module: context.module,
        } }, { dedupKey: context.dedupKey, expiresAt: context.deliveryExpiresAt }).catch(() => null);
        if (queued) {
          await createLog({ level: 'ALERTA', action: 'EMAIL_ENFILEIRADO', message: 'E-mail preservado para nova tentativa.', module: moduleName,
            traceId: context.traceId, userId: context.userId, empresaId: context.empresaId, vendaId: context.vendaId,
            requestPath: context.requestPath, details: { recipientHash, outboxId: queued.id } });
          return { success: true, queued: true, messageId: undefined } as const;
        }
      }

      return { success: false, error: 'DELIVERY_FAILED' } as const;
    }
  }

  getTemplateRecuperacaoSenha(nome: string, link: string) {
    return `
      <div style="font-family: Arial, sans-serif; color: #334155; max-width: 600px; margin: auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 14px;">
        <h2 style="color: #2563eb; margin: 0 0 10px;">NFSe Goo</h2>
        <h3 style="color: #0f172a; margin: 0 0 16px;">Recuperacao de senha</h3>
        <p>Ola, <strong>${html(nome)}</strong>.</p>
        <p>Recebemos um pedido para redefinir a senha da sua conta no <strong>NFSe Goo</strong>.</p>
        <p>Se foi voce que fez este pedido, clique no botao abaixo para criar uma nova senha segura:</p>
        <div style="text-align: center; margin: 28px 0;">
          <a href="${emailLink(link)}" style="background-color: #2563eb; color: white; padding: 14px 28px; text-decoration: none; border-radius: 10px; display: inline-block; font-weight: bold; font-size: 16px;">Redefinir minha senha</a>
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
        <p>Ola, <strong>${html(nome)}</strong>.</p>
        <p>Recebemos uma solicitacao para atualizar seu e-mail de acesso.</p>
        <p>Seu codigo de verificacao e:</p>
        <div style="background-color: #f8fafc; padding: 16px; font-size: 24px; font-weight: bold; text-align: center; letter-spacing: 5px; margin: 20px 0; border-radius: 10px; border: 1px solid #e2e8f0;">
          ${html(codigo)}
        </div>
        <p style="font-size: 12px; color: #64748b;">Este codigo expira em 15 minutos.</p>
        <p style="font-size: 12px; color: #64748b;">Se nao foi voce, altere sua senha imediatamente.</p>
      </div>
    `;
  }

  getTemplateMfaLoginCode(nome: string, codigo: string) {
    return `
      <div style="font-family: Arial, sans-serif; color: #334155; max-width: 600px; margin: auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 14px;">
        <h2 style="color: #2563eb; margin: 0 0 10px;">NFSe Goo</h2>
        <h3 style="color: #0f172a; margin: 0 0 16px;">Confirme seu acesso</h3>
        <p>Olá, <strong>${html(nome)}</strong>.</p>
        <p>Use o código abaixo para concluir o login:</p>
        <div style="background-color: #f8fafc; padding: 16px; font-size: 24px; font-weight: bold; text-align: center; letter-spacing: 5px; margin: 20px 0; border-radius: 10px; border: 1px solid #e2e8f0;">
          ${html(codigo)}
        </div>
        <p style="font-size: 12px; color: #64748b;">O código é de uso único e expira em 10 minutos. A opção de confiar neste dispositivo por e-mail vale por 24 horas.</p>
        <p style="font-size: 12px; color: #64748b;">Se não foi você, não compartilhe o código e altere sua senha.</p>
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
      params.pedidoId ? `<p><strong>Pedido:</strong> ${html(params.pedidoId.slice(0, 8))}</p>` : '',
      params.ticketProtocolo ? `<p><strong>Ticket:</strong> #${html(params.ticketProtocolo)}</p>` : '',
      params.plano ? `<p><strong>Plano:</strong> ${html(params.plano)}</p>` : '',
      params.valor ? `<p><strong>Valor estimado:</strong> ${html(params.valor)}</p>` : '',
      params.motivo ? `<p><strong>Observacao:</strong> ${html(params.motivo)}</p>` : '',
    ].filter(Boolean).join('');

    return `
      <div style="font-family: Arial, sans-serif; color: #1e293b; max-width: 620px; margin: auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 14px;">
        <h2 style="color:#2563eb;margin:0 0 10px;">NFSe Goo</h2>
        <h3 style="margin:0 0 16px;color:#0f172a;">${html(params.titulo)}</h3>
        <p>Ola, <strong>${html(params.nome)}</strong>.</p>
        <p style="line-height:1.6;">${html(params.mensagem)}</p>
        ${rows ? `<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:14px;margin:18px 0;">${rows}</div>` : ''}
        ${emailLink(params.link) ? `<div style="text-align:center;margin:24px 0;"><a href="${emailLink(params.link)}" style="background:#2563eb;color:white;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:bold;display:inline-block;">Abrir no NFSe Goo</a></div>` : ''}
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
        <p>Ola, <strong>${html(params.nome)}</strong>.</p>
        <p>Ha uma nova resposta no ticket <strong>#${html(params.protocolo)}</strong>.</p>
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:14px;margin:18px 0;">
          <p><strong>Assunto:</strong> ${html(params.assunto)}</p>
          ${params.remetente ? `<p><strong>Respondido por:</strong> ${html(params.remetente)}</p>` : ''}
          <p style="line-height:1.6;"><strong>Trecho:</strong> ${html(params.trecho)}</p>
        </div>
        ${emailLink(params.link) ? `<div style="text-align:center;margin:24px 0;"><a href="${emailLink(params.link)}" style="background:#2563eb;color:white;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:bold;display:inline-block;">Abrir ticket</a></div>` : ''}
        <p style="font-size:12px;color:#64748b;margin-top:24px;">Para proteger seus dados, detalhes sensiveis ficam disponiveis apenas dentro da plataforma.</p>
      </div>
    `;
  }
}
