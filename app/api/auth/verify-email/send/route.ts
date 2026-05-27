import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { EmailService } from '@/app/services/EmailService';
import { getAuthenticatedUser, unauthorized } from '@/app/utils/api-middleware';
import { prisma } from '@/app/utils/prisma';
import { checkRateLimit } from '@/app/utils/rate-limit';
import { validateJsonContentLength } from '@/app/utils/request-guards';

export async function POST(request: Request) {
    const userAuth = await getAuthenticatedUser(request);
    if (!userAuth) return unauthorized();

    try {
        const sizeError = validateJsonContentLength(request);
        if (sizeError) return sizeError;

        const { newEmail, password } = await request.json();
        const emailNormalizado = String(newEmail || '').trim().toLowerCase();

        if (!emailNormalizado || !password) {
            return NextResponse.json({ error: 'Dados invalidos.' }, { status: 400 });
        }

        const allowed = await checkRateLimit(`verify_email_send_${userAuth.id}`, 5, 30 * 60 * 1000);
        if (!allowed) {
            return NextResponse.json({ error: 'Muitas solicitacoes. Aguarde e tente novamente.' }, { status: 429 });
        }

        // 1. Verifica Senha Atual (Segurança)
        const user = await prisma.user.findUnique({ where: { id: userAuth.id } });
        if (!user || !user.senha) return NextResponse.json({ error: "Usuário inválido." }, { status: 400 });

        const senhaValida = await bcrypt.compare(password, user.senha);
        if (!senhaValida) return NextResponse.json({ error: "Senha incorreta." }, { status: 401 });

        // 2. Verifica se e-mail já existe em outra conta
        const emailExiste = await prisma.user.findFirst({ where: { email: emailNormalizado } });
        if (emailExiste) return NextResponse.json({ error: "Este e-mail já está em uso." }, { status: 400 });

        // 3. Gera Código
        const codigo = crypto.randomInt(100000, 999999).toString();
        const validade = new Date(Date.now() + 15 * 60 * 1000); // 15 min

        // 4. Salva Temporariamente
        await prisma.user.update({
            where: { id: user.id },
            data: {
                tempEmail: emailNormalizado,
                verificationCode: codigo,
                verificationExpires: validade
            }
        });

        // 5. Envia E-mail
        const emailService = new EmailService();
        const html = emailService.getTemplateVerificacaoEmail(user.nome, codigo);
        await emailService.sendEmail(emailNormalizado, "Codigo de Verificacao", html);

        return NextResponse.json({ success: true });

    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
