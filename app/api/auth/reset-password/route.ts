import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { withApiGuard } from '@/app/utils/api-route';
import { checkRateLimit } from '@/app/utils/rate-limit';
import { getRequestIp } from '@/app/utils/request-ip';
import { CommercialError } from '@/app/utils/commercial-pricing';
import { consumePasswordReset, normalizePasswordResetInput } from '@/app/services/passwordRecoveryService';

export const POST = withApiGuard(async function POST(request: Request) {
  try {
    const { token, password } = normalizePasswordResetInput(await request.json());
    const tokenKey = crypto.createHash('sha256').update(token).digest('hex');
    const [ipAllowed, tokenAllowed] = await Promise.all([
      checkRateLimit(`reset_ip_${getRequestIp(request)}`, 5, 15 * 60 * 1000),
      checkRateLimit(`reset_token_${tokenKey}`, 5, 15 * 60 * 1000),
    ]);
    if (!ipAllowed || !tokenAllowed) {
      return NextResponse.json({ error: 'Muitas tentativas inválidas. Acesso temporariamente bloqueado.' }, { status: 429 });
    }
    await consumePasswordReset(token, password);
    return NextResponse.json({ success: true, requiresLogin: true, message: 'Senha redefinida. Entre novamente em sua conta.' });
  } catch (error) {
    if (error instanceof CommercialError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
}, { maxBodyBytes: 8 * 1024 });
