import { NextResponse } from 'next/server';
import { prisma } from '@/app/utils/prisma';
import { checkRateLimit } from '@/app/utils/rate-limit';
import { validateJsonContentLength, validateSameOrigin } from '@/app/utils/request-guards';

export async function POST(request: Request) {
  try {
    const originError = validateSameOrigin(request);
    if (originError) return originError;

    const sizeError = validateJsonContentLength(request);
    if (sizeError) return sizeError;

    const { email, cpf } = await request.json();
    const ip = request.headers.get('x-forwarded-for') || '127.0.0.1';
    const ipAllowed = await checkRateLimit(`auth_check_ip_${ip}`, 20, 15 * 60 * 1000);

    if (!ipAllowed) {
      return NextResponse.json({ error: 'Muitas verificacoes. Aguarde e tente novamente.' }, { status: 429 });
    }

    const errors: Record<string, string> = {};

    if (email) {
      const emailNormalizado = String(email).trim().toLowerCase();
      const userEmail = await prisma.user.findUnique({
        where: { email: emailNormalizado },
        select: { id: true },
      });

      if (userEmail) {
        errors.email = 'Este e-mail ja esta cadastrado.';
      }
    }

    if (cpf) {
      const cpfLimpo = String(cpf).replace(/\D/g, '');
      const userCpf = await prisma.user.findUnique({
        where: { cpf: cpfLimpo },
        select: { id: true },
      });

      if (userCpf) {
        errors.cpf = 'Este CPF ja esta vinculado a uma conta.';
      }
    }

    return NextResponse.json({
      success: Object.keys(errors).length === 0,
      errors,
    });
  } catch {
    return NextResponse.json({ error: 'Erro ao verificar dados.' }, { status: 500 });
  }
}
