import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { signJWT } from '@/app/utils/auth';
import { cookies } from 'next/headers';
import { checkRateLimit } from '@/app/utils/rate-limit';
import { prisma } from '@/app/utils/prisma';
import { validateJsonContentLength, validateSameOrigin } from '@/app/utils/request-guards';

export async function POST(request: Request) {
  
  try {
        const originError = validateSameOrigin(request);
        if (originError) return originError;

        const sizeError = validateJsonContentLength(request);
        if (sizeError) return sizeError;

        const body = await request.json();
        const { login, senha } = body;

        if (!login || !senha) {
            return NextResponse.json({ error: 'Credenciais invalidas' }, { status: 400 });
        }

        const loginNormalizado = String(login).trim().toLowerCase();

        // === ESCUDO: RATE LIMITING ===
        // Captura o IP do usuário (funciona bem atrás de proxies/Vercel)
        const ip = request.headers.get('x-forwarded-for') || '127.0.0.1';
        
        // Regra 1: Max 10 tentativas por IP a cada 15 minutos
        const ipAllowed = await checkRateLimit(`login_ip_${ip}`, 10, 15 * 60 * 1000);
        // Regra 2: Max 5 tentativas para o mesmo E-mail a cada 15 minutos
        const emailAllowed = await checkRateLimit(`login_email_${loginNormalizado}`, 5, 15 * 60 * 1000);

        if (!ipAllowed || !emailAllowed) {
            return NextResponse.json({ 
                error: 'Muitas tentativas de login. Por segurança, aguarde 15 minutos e tente novamente.' 
            }, { status: 429 });
        }

    const loginLimpo = loginNormalizado.replace(/\D/g, ''); 

    const user = await prisma.user.findFirst({
        where: {
            OR: [
                { email: loginNormalizado },
                { cpf: loginLimpo }
            ]
        },
        include: { empresa: true } // Trazemos empresa para facilitar o front
    });

    if (!user || !(await bcrypt.compare(senha, user.senha))) {
      return NextResponse.json({ error: 'Credenciais inválidas.' }, { status: 401 });
    }

    // === GERAÇÃO DO TOKEN JWT (Item 3) ===
    const token = await signJWT({ sub: user.id, role: user.role });

    // === DEFINE O COOKIE HTTPONLY ===
    cookies().set({
        name: 'auth_token',
        value: token,
        httpOnly: true, // Protege contra XSS
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 60 * 60 * 8 // 8 horas, igual à expiração do token no auth.ts
    });

    // Retorna dados sem o token
    return NextResponse.json({
      success: true,
      user: {
          id: user.id,
          nome: user.nome,
          email: user.email,
          role: user.role,
          empresaId: user.empresaId
      }
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Erro interno.' }, { status: 500 });
  }
}
