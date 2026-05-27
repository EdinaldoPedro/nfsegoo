import { NextResponse } from 'next/server';
import { signJWT } from '@/app/utils/auth';
import { cookies } from 'next/headers';
import { prisma } from '@/app/utils/prisma';
import { checkRateLimit } from '@/app/utils/rate-limit';
import { validateJsonContentLength, validateSameOrigin } from '@/app/utils/request-guards';

export async function POST(request: Request) {
  try {
    const originError = validateSameOrigin(request);
    if (originError) return originError;

    const sizeError = validateJsonContentLength(request);
    if (sizeError) return sizeError;

    const { email, code } = await request.json();
    const emailNormalizado = String(email || '').trim().toLowerCase();

    if (!emailNormalizado || !code) {
      return NextResponse.json({ error: 'Codigo invalido ou expirado.' }, { status: 400 });
    }

    const ip = request.headers.get('x-forwarded-for') || '127.0.0.1';
    const ipAllowed = await checkRateLimit(`confirm_account_ip_${ip}`, 8, 15 * 60 * 1000);
    const emailAllowed = await checkRateLimit(`confirm_account_email_${emailNormalizado}`, 5, 15 * 60 * 1000);

    if (!ipAllowed || !emailAllowed) {
      return NextResponse.json({ error: 'Muitas tentativas. Aguarde e tente novamente.' }, { status: 429 });
    }

    const user = await prisma.user.findUnique({ where: { email: emailNormalizado } });

    if (
      !user ||
      user.verificationCode !== String(code) ||
      !user.verificationExpires ||
      new Date() > user.verificationExpires
    ) {
      return NextResponse.json({ error: 'Codigo invalido ou expirado.' }, { status: 400 });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { verificationCode: null, verificationExpires: null },
    });

    const token = await signJWT({ sub: user.id, role: user.role });

    cookies().set({
      name: 'auth_token',
      value: token,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 8,
    });

    return NextResponse.json({
      success: true,
      user: { id: user.id, nome: user.nome, role: user.role },
    });
  } catch {
    return NextResponse.json({ error: 'Erro ao confirmar.' }, { status: 500 });
  }
}
