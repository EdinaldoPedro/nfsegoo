import { NextResponse } from 'next/server';
import { signJWT } from '@/app/utils/auth';
import { cookies } from 'next/headers';
import { prisma } from '@/app/utils/prisma';
import { checkRateLimit } from '@/app/utils/rate-limit';
import { validateJsonContentLength, validateSameOrigin } from '@/app/utils/request-guards';
import { registrarEventoCrm } from '@/app/services/crmService';

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

    const pending = await prisma.pendingRegistration.findUnique({ where: { email: emailNormalizado } });

    if (
      !pending ||
      pending.verificationCode !== String(code) ||
      !pending.verificationExpires ||
      new Date() > pending.verificationExpires
    ) {
      return NextResponse.json({ error: 'Codigo invalido ou expirado.' }, { status: 400 });
    }

    const existentes = await prisma.user.findMany({
      where: { OR: [{ email: pending.email }, { cpf: pending.cpf }] },
      select: { email: true, cpf: true },
      take: 2,
    });

    if (existentes.length > 0) {
      const errors: Record<string, string> = {};
      existentes.forEach((usuario) => {
        if (usuario.email === pending.email) errors.email = 'Este e-mail ja esta cadastrado.';
        if (usuario.cpf === pending.cpf) errors.cpf = 'Este CPF ja esta vinculado a uma conta existente.';
      });

      await prisma.pendingRegistration.delete({ where: { id: pending.id } });
      return NextResponse.json({
        error: Object.keys(errors).length > 1
          ? 'E-mail e CPF ja estao cadastrados.'
          : Object.values(errors)[0] || 'Nao foi possivel confirmar este cadastro.',
        code: 'ACCOUNT_ALREADY_EXISTS',
        errors,
        fields: Object.keys(errors),
      }, { status: 409 });
    }

    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          nome: pending.nome,
          email: pending.email,
          senha: pending.senhaHash,
          cpf: pending.cpf,
          telefone: pending.telefone,
          role: pending.role,
          verificationCode: null,
          verificationExpires: null,
          tutorialStep: 0,
          historicoPlanos: {
            create: {
              plan: { connect: { slug: 'TRIAL' } },
              status: 'ATIVO',
              dataFim: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
              notasEmitidas: 0,
            },
          },
        },
      });

      await tx.pendingRegistration.delete({ where: { id: pending.id } });
      return created;
    });

    await registrarEventoCrm(
      user.id,
      'SISTEMA',
      'Conta Criada',
      'O cliente confirmou o codigo por e-mail e o plano TRIAL de 7 dias foi ativado.',
    );

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
      user: { id: user.id, nome: user.nome, email: user.email, role: user.role },
    });
  } catch (error: any) {
    console.error('Erro confirmacao cadastro:', error);
    if (error?.code === 'P2025') {
      return NextResponse.json({ error: 'Erro de configuracao do sistema (Plano Base nao encontrado no banco).' }, { status: 500 });
    }
    return NextResponse.json({ error: 'Erro ao confirmar.' }, { status: 500 });
  }
}
