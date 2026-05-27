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

    if (email) {
      await prisma.user.findUnique({
        where: { email: String(email).trim().toLowerCase() },
        select: { id: true },
      });
    }

    if (cpf) {
      await prisma.user.findUnique({
        where: { cpf: String(cpf).replace(/\D/g, '') },
        select: { id: true },
      });
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'Erro ao verificar dados.' }, { status: 500 });
  }
}
