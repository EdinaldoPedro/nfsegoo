import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { EmailService } from '@/app/services/EmailService';
import { createLog, createTraceId, getErrorDiagnostics, inferDebugHint } from '@/app/services/logger';
import { checkRateLimit } from '@/app/utils/rate-limit';
import { prisma } from '@/app/utils/prisma';
import { validateJsonContentLength, validateSameOrigin } from '@/app/utils/request-guards';
import { getPublicBaseUrl } from '@/app/utils/request-url';

export async function POST(request: Request) {
    const traceId = createTraceId('senha');
    const startedAt = Date.now();
    const requestPath = new URL(request.url).pathname;

    try {
        const originError = validateSameOrigin(request);
        if (originError) return originError;

        const sizeError = validateJsonContentLength(request);
        if (sizeError) return sizeError;

        const { email } = await request.json();
        const emailNormalizado = String(email || '').trim().toLowerCase();
        if (!emailNormalizado) {
            return NextResponse.json({ error: 'E-mail obrigatorio.' }, { status: 400 });
        }

        await createLog({
            level: 'INFO',
            action: 'RECUPERACAO_SENHA_INICIADA',
            message: `Solicitacao de recuperacao recebida para ${emailNormalizado}.`,
            module: 'AUTH',
            traceId,
            requestPath,
            details: { email: emailNormalizado },
        });

        const ip = request.headers.get('x-forwarded-for') || '127.0.0.1';
        const ipAllowed = await checkRateLimit(`forgot_ip_${ip}`, 3, 30 * 60 * 1000);
        const emailAllowed = await checkRateLimit(`forgot_email_${emailNormalizado}`, 3, 30 * 60 * 1000);

        if (!ipAllowed || !emailAllowed) {
            await createLog({
                level: 'ALERTA',
                action: 'RECUPERACAO_SENHA_RATE_LIMIT',
                message: `Limite de recuperacao atingido para ${emailNormalizado}.`,
                module: 'AUTH',
                traceId,
                requestPath,
                statusCode: 429,
                durationMs: Date.now() - startedAt,
                debugHint: 'Aguarde a janela de rate limit ou verifique tentativas repetidas para este e-mail/IP.',
                details: { email: emailNormalizado },
            });

            return NextResponse.json({
                error: 'Voce atingiu o limite de solicitacoes de recuperacao. Aguarde 30 minutos.',
            }, { status: 429 });
        }

        const user = await prisma.user.findUnique({ where: { email: emailNormalizado } });
        if (!user) {
            await createLog({
                level: 'ALERTA',
                action: 'RECUPERACAO_SENHA_CONTA_NAO_ENCONTRADA',
                message: `Nao existe conta para o e-mail ${emailNormalizado}.`,
                module: 'AUTH',
                traceId,
                requestPath,
                statusCode: 404,
                durationMs: Date.now() - startedAt,
                debugHint: 'Confirme se o e-mail foi digitado corretamente ou se o cadastro foi criado com outro endereco.',
                details: { email: emailNormalizado },
            });

            return NextResponse.json({
                error: 'Nao existe conta cadastrada com este e-mail. Confira o endereco e tente novamente.',
            }, { status: 404 });
        }

        const resetToken = crypto.randomBytes(32).toString('hex');
        const hashedToken = crypto.createHash('sha256').update(resetToken).digest('hex');
        const resetExpires = new Date(Date.now() + 3600000);

        await prisma.user.update({
            where: { id: user.id },
            data: {
                resetToken: hashedToken,
                resetExpires,
            },
        });

        await createLog({
            level: 'INFO',
            action: 'RECUPERACAO_SENHA_TOKEN_GERADO',
            message: `Token de recuperacao gerado para ${emailNormalizado}.`,
            module: 'AUTH',
            traceId,
            userId: user.id,
            requestPath,
            details: { email: emailNormalizado, expiraEmMinutos: 60 },
        });

        const baseUrl = getPublicBaseUrl(request);
        const resetLink = `${baseUrl}/redefinir-senha?token=${resetToken}`;

        const emailService = new EmailService();
        const html = emailService.getTemplateRecuperacaoSenha(user.nome, resetLink);
        const emailResult = await emailService.sendEmail(
            user.email,
            'Recuperacao de senha - NFSe Goo',
            html,
            [],
            { traceId, userId: user.id, requestPath, module: 'AUTH' },
        );

        if (!emailResult.success) {
            await createLog({
                level: 'ERRO',
                action: 'RECUPERACAO_SENHA_EMAIL_FALHOU',
                message: `Nao foi possivel enviar recuperacao para ${emailNormalizado}.`,
                module: 'AUTH',
                traceId,
                userId: user.id,
                requestPath,
                statusCode: 502,
                durationMs: Date.now() - startedAt,
                debugHint: 'Veja o evento FALHA_ENVIO_EMAIL deste mesmo rastreio para a resposta SMTP detalhada.',
                details: { email: emailNormalizado, motivo: emailResult.error },
            });

            return NextResponse.json({
                error: 'Nao foi possivel enviar o e-mail de recuperacao agora. Tente novamente em instantes ou acione o suporte.',
            }, { status: 502 });
        }

        await createLog({
            level: 'INFO',
            action: 'RECUPERACAO_SENHA_FINALIZADA',
            message: `Link de recuperacao enviado para ${emailNormalizado}.`,
            module: 'AUTH',
            traceId,
            userId: user.id,
            requestPath,
            statusCode: 200,
            durationMs: Date.now() - startedAt,
            details: { email: emailNormalizado },
        });

        return NextResponse.json({ message: 'Enviamos o link de recuperacao para o e-mail cadastrado.' });
    } catch (error: any) {
        console.error(error);
        await createLog({
            level: 'ERRO',
            action: 'RECUPERACAO_SENHA_ERRO_INTERNO',
            message: `Erro interno na recuperacao de senha: ${error.message || error}`,
            module: 'AUTH',
            traceId,
            requestPath,
            statusCode: 500,
            durationMs: Date.now() - startedAt,
            debugHint: inferDebugHint(error, 'Verifique logs do servidor, banco de dados e configuracao SMTP.'),
            details: getErrorDiagnostics(error),
        });
        return NextResponse.json({ error: 'Erro interno do servidor.' }, { status: 500 });
    }
}
