import { withApiGuard } from '@/app/utils/api-route';
import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { createAuthSession } from '@/app/utils/auth-session';
import { getRequestIp } from '@/app/utils/request-ip';
import { roleRequiresMfa } from '@/app/utils/mfa-policy';
import { createMfaLoginChallenge, consumeMfaLoginChallenge, trustCurrentDevice, validateTrustedDevice } from '@/app/services/mfaLoginService';
import { checkRateLimit, clearRateLimit, refundRateLimit } from '@/app/utils/rate-limit';
import { prisma } from '@/app/utils/prisma';
import { validateJsonContentLength, validateSameOrigin } from '@/app/utils/request-guards';

const DUMMY_PASSWORD_HASH = bcrypt.hashSync('not-a-real-account-password', 10);

async function loginResponse(user: any) {
  const [{ privacyVersion, termsVersion }, systemConfig] = await Promise.all([
    import('@/app/legal-content'),
    prisma.configuracaoSistema.findUnique({ where: { id: 'config' }, select: { manutencaoAtiva: true } }),
  ]);
  const legalAcceptanceRequired = await prisma.legalAcceptance.findUnique({
    where: { userId_termsVersion_privacyVersion: { userId: user.id, termsVersion, privacyVersion } }, select: { id: true },
  }).then(value => !value);
  const staffRoles = ['ADMIN', 'MASTER', 'SUPORTE', 'SUPORTE_TI', 'COMERCIAL'];
  return NextResponse.json({
    success: true, requireMfaSetup: roleRequiresMfa(user.role) && !user.mfaEnabledAt,
    legalAcceptanceRequired, maintenanceActive: Boolean(systemConfig?.manutencaoAtiva) && !staffRoles.includes(user.role),
    user: { id: user.id, nome: user.nome, email: user.email, role: user.role, empresaId: user.empresaId },
  });
}

export const POST = withApiGuard(async function POST(request: Request) {
  try {
    const originError = validateSameOrigin(request);
    if (originError) return originError;
    const sizeError = validateJsonContentLength(request);
    if (sizeError) return sizeError;
    const body = await request.json();
    const ip = getRequestIp(request);

    if (typeof body.mfaChallenge === 'string') {
      const method = body.mfaMethod === 'EMAIL' ? 'EMAIL' : body.mfaMethod === 'TOTP' ? 'TOTP' : null;
      if (!method || typeof body.otpCode !== 'string' || body.otpCode.length > 48) {
        return NextResponse.json({ error: 'Informe um código válido.', mfaRequired: true }, { status: 400 });
      }
      const challengeKey = `login_mfa_challenge_${body.mfaChallenge}`;
      const [ipAllowed, challengeAllowed] = await Promise.all([
        checkRateLimit(`login_mfa_ip_${ip}`, 10, 5 * 60 * 1000), checkRateLimit(challengeKey, 5, 5 * 60 * 1000),
      ]);
      if (!ipAllowed || !challengeAllowed) return NextResponse.json({ error: 'Muitas tentativas de código. Aguarde 5 minutos.', mfaRequired: true }, { status: 429 });
      const verified = await consumeMfaLoginChallenge(body.mfaChallenge, method, body.otpCode.trim());
      if (!verified) return NextResponse.json({ error: 'Código inválido, expirado ou já utilizado.', mfaRequired: true }, { status: 401 });
      await Promise.all([clearRateLimit(challengeKey), refundRateLimit(`login_mfa_ip_${ip}`)]);
      if (body.trustDevice === true && verified.proof !== 'RECOVERY') {
        await trustCurrentDevice(request, verified.user.id, verified.proof === 'EMAIL' ? 'EMAIL' : 'TOTP');
      }
      await createAuthSession(verified.user, request, true);
      await prisma.user.update({ where: { id: verified.user.id }, data: { lastLoginAt: new Date() } });
      return loginResponse(verified.user);
    }

    const { login, senha } = body;
    if (typeof login !== 'string' || typeof senha !== 'string' || !login || !senha || login.length > 254 || Buffer.byteLength(senha, 'utf8') > 72) {
      return NextResponse.json({ error: 'Credenciais inválidas.' }, { status: 400 });
    }
    const loginNormalizado = login.trim().toLowerCase();
    const passwordIpKey = `login_ip_${ip}`, passwordIdentityKey = `login_email_${loginNormalizado}`;
    const [ipAllowed, identityAllowed] = await Promise.all([
      checkRateLimit(passwordIpKey, 10, 5 * 60 * 1000), checkRateLimit(passwordIdentityKey, 5, 5 * 60 * 1000),
    ]);
    if (!ipAllowed || !identityAllowed) return NextResponse.json({ error: 'Muitas tentativas de login. Por segurança, aguarde 5 minutos e tente novamente.' }, { status: 429 });

    const loginLimpo = loginNormalizado.replace(/\D/g, '');
    const user = await prisma.user.findFirst({ where: { OR: [{ email: loginNormalizado }, { cpf: loginLimpo }] }, include: { empresa: true } });
    const passwordMatches = await bcrypt.compare(senha, user?.senha || DUMMY_PASSWORD_HASH);
    if (!user || user.privacyErasedAt || !passwordMatches) return NextResponse.json({ error: 'Credenciais inválidas.' }, { status: 401 });
    await Promise.all([clearRateLimit(passwordIdentityKey), refundRateLimit(passwordIpKey)]);

    if (user.mfaEnabledAt && !(await validateTrustedDevice(request, user.id))) {
      const challenge = await createMfaLoginChallenge(user.id);
      return NextResponse.json({ error: 'Confirme o segundo fator para continuar.', mfaRequired: true,
        mfaChallenge: challenge.token, challengeExpiresAt: challenge.expiresAt }, { status: 428 });
    }
    await createAuthSession(user, request, Boolean(user.mfaEnabledAt));
    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    return loginResponse(user);
  } catch {
    return NextResponse.json({ error: 'Erro interno.' }, { status: 500 });
  }
});
