import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { checkRateLimit } from '@/app/utils/rate-limit';
import { prisma } from '@/app/utils/prisma';
import { validateJsonContentLength, validateSameOrigin } from '@/app/utils/request-guards';

export async function POST(request: Request) {
    try {
        const originError = validateSameOrigin(request);
        if (originError) return originError;

        const sizeError = validateJsonContentLength(request);
        if (sizeError) return sizeError;

        const { token, senha } = await request.json();

        if (!token || !senha) {
            return NextResponse.json({ error: 'Token e nova senha são obrigatórios.' }, { status: 400 });
        }

        // === ESCUDO: RATE LIMITING ===
        const ip = request.headers.get('x-forwarded-for') || '127.0.0.1';
        
        // Limitamos severamente por IP e também tentativas atreladas ao próprio Token
        const ipAllowed = await checkRateLimit(`reset_ip_${ip}`, 5, 15 * 60 * 1000);
        const tokenAllowed = await checkRateLimit(`reset_token_${token}`, 5, 15 * 60 * 1000);

        if (!ipAllowed || !tokenAllowed) {
            return NextResponse.json({ 
                error: 'Muitas tentativas inválidas. Acesso temporariamente bloqueado.' 
            }, { status: 429 });
        }

        const isSenhaForte = senha.length >= 8 && /[A-Z]/.test(senha) && /[0-9]/.test(senha) && /[^A-Za-z0-9]/.test(senha);
        
        if (!isSenhaForte) {
            return NextResponse.json({ 
                error: 'A senha deve ter pelo menos 8 caracteres, 1 letra maiúscula, 1 número e 1 caractere especial.' 
            }, { status: 400 });
        }

        const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

        const user = await prisma.user.findFirst({
            where: {
                resetToken: hashedToken,
                resetExpires: { gt: new Date() } // <--- CORRIGIDO PARA resetExpires
            }
        });

        if (!user) {
            return NextResponse.json({ error: 'Token inválido ou expirado.' }, { status: 400 });
        }

        const hashedPassword = await bcrypt.hash(senha, 10);

        await prisma.user.update({
            where: { id: user.id },
            data: {
                senha: hashedPassword,
                resetToken: null,       
                resetExpires: null 
            }
        });
        
        // Log de Segurança no CRM (Opcional, mas muito bom para um SaaS)
        try {
            await prisma.systemLog.create({
                data: {
                    level: 'INFO',
                    action: 'PASSWORD_RESET',
                    message: `Palavra-passe redefinida com sucesso para o email: ${user.email}`,
                }
            });
        } catch (e) {}

        return NextResponse.json({ success: true, message: 'Palavra-passe redefinida com sucesso.' });
    } catch (error) {
        console.error(error);
        return NextResponse.json({ error: 'Erro interno ao redefinir a senha.' }, { status: 500 });
    }
}
