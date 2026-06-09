import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { getAuthenticatedUser, unauthorized } from '@/app/utils/api-middleware';
import { prisma } from '@/app/utils/prisma';
import { checkRateLimit } from '@/app/utils/rate-limit';
import { validateJsonContentLength, validateSameOrigin } from '@/app/utils/request-guards';

function senhaForte(senha: string) {
  return senha.length >= 8 && /[A-Z]/.test(senha) && /[0-9]/.test(senha) && /[^A-Za-z0-9]/.test(senha);
}

export async function POST(request: Request) {
  const originError = validateSameOrigin(request);
  if (originError) return originError;

  const userAuth = await getAuthenticatedUser(request);
  if (!userAuth) return unauthorized();

  try {
    const sizeError = validateJsonContentLength(request);
    if (sizeError) return sizeError;

    const { currentPassword, newPassword, confirmPassword } = await request.json();

    if (!currentPassword || !newPassword || !confirmPassword) {
      return NextResponse.json({ error: 'Preencha todos os campos.' }, { status: 400 });
    }

    const allowed = await checkRateLimit(`change_password_${userAuth.id}`, 5, 30 * 60 * 1000);
    if (!allowed) {
      return NextResponse.json({ error: 'Muitas tentativas. Aguarde e tente novamente.' }, { status: 429 });
    }

    if (newPassword !== confirmPassword) {
      return NextResponse.json({ error: 'A nova senha e a confirmacao nao coincidem.' }, { status: 400 });
    }

    if (!senhaForte(newPassword)) {
      return NextResponse.json({
        error: 'A senha deve ter pelo menos 8 caracteres, 1 letra maiuscula, 1 numero e 1 caractere especial.',
      }, { status: 400 });
    }

    if (currentPassword === newPassword) {
      return NextResponse.json({ error: 'A nova senha precisa ser diferente da senha atual.' }, { status: 400 });
    }

    const user = await prisma.user.findUnique({ where: { id: userAuth.id } });
    if (!user?.senha) {
      return NextResponse.json({ error: 'Usuario invalido.' }, { status: 400 });
    }

    const senhaAtualValida = await bcrypt.compare(currentPassword, user.senha);
    if (!senhaAtualValida) {
      return NextResponse.json({ error: 'Senha atual incorreta.' }, { status: 401 });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({
      where: { id: user.id },
      data: {
        senha: hashedPassword,
        resetToken: null,
        resetExpires: null,
      },
    });

    try {
      await prisma.systemLog.create({
        data: {
          level: 'INFO',
          action: 'PASSWORD_CHANGED',
          message: `Senha alterada pelo usuario: ${user.email}`,
        },
      });
    } catch {}

    return NextResponse.json({ success: true, message: 'Senha alterada com sucesso.' });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Erro interno ao alterar a senha.' }, { status: 500 });
  }
}
