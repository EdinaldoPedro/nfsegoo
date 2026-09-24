import { withApiGuard } from '@/app/utils/api-route';
import { NextResponse } from 'next/server';
import { validarCPF } from '@/app/utils/cpf';
import { getRequestIp } from '@/app/utils/request-ip';
import { checkRateLimit } from '@/app/utils/rate-limit';
import { validateJsonContentLength, validateSameOrigin } from '@/app/utils/request-guards';

export const POST = withApiGuard(async function POST(request: Request) {
  try {
    const originError = validateSameOrigin(request);
    if (originError) return originError;

    const sizeError = validateJsonContentLength(request);
    if (sizeError) return sizeError;

    const { email, cpf } = await request.json();
    const ip = getRequestIp(request);
    const ipAllowed = await checkRateLimit(`auth_check_ip_${ip}`, 20, 15 * 60 * 1000);

    if (!ipAllowed) {
      return NextResponse.json({ error: 'Muitas verificacoes. Aguarde e tente novamente.' }, { status: 429 });
    }

    const errors: Record<string, string> = {};

    if (email) {
      const emailNormalizado = String(email).trim().toLowerCase();
      if (emailNormalizado.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailNormalizado)) errors.email = 'E-mail invalido.';
    }

    if (cpf) {
      const cpfLimpo = String(cpf).replace(/\D/g, '');
      if (!validarCPF(cpfLimpo)) errors.cpf = 'CPF invalido.';
    }

    return NextResponse.json({
      success: Object.keys(errors).length === 0,
      errors,
    });
  } catch {
    return NextResponse.json({ error: 'Erro ao verificar dados.' }, { status: 500 });
  }
});
