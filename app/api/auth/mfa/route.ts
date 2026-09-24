import { withApiGuard } from '@/app/utils/api-route';
import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import QRCode from 'qrcode';
import { getAuthenticatedUser, unauthorized } from '@/app/utils/api-middleware';
import { prisma } from '@/app/utils/prisma';
import { roleRequiresMfa } from '@/app/utils/mfa-policy';
import { checkRateLimit } from '@/app/utils/rate-limit';
import { validateJsonContentLength } from '@/app/utils/request-guards';
import { encrypt, decrypt } from '@/app/utils/crypto';
import { createRecoveryCodes, createTotpSecret, matchingTotpStep, totpProvisioningUri } from '@/app/utils/totp';
import { consumeMfaCode } from '@/app/services/mfaService';
import { createAuthSession } from '@/app/utils/auth-session';
import { createLog } from '@/app/services/logger';
import { revokeTrustedDevices, trustCurrentDevice } from '@/app/services/mfaLoginService';

const PRIVATE_HEADERS = { 'Cache-Control': 'no-store, private', Pragma: 'no-cache' };

export const GET = withApiGuard(async function GET(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return unauthorized();
  let recoveryCodesRemaining = 0;
  try {
    const recoveryCodes = JSON.parse(user.mfaRecoveryCodes || '[]');
    recoveryCodesRemaining = Array.isArray(recoveryCodes) ? recoveryCodes.length : 0;
  } catch {
    // Dados corrompidos nao indicam codigos de recuperacao utilizaveis.
  }
  return NextResponse.json({
    enabled: Boolean(user.mfaEnabledAt), required: roleRequiresMfa(user.role),
    enabledAt: user.mfaEnabledAt, recoveryCodesRemaining,
  }, { headers: PRIVATE_HEADERS });
});

export const POST = withApiGuard(async function POST(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return unauthorized();
  const sizeError = validateJsonContentLength(request, 16 * 1024);
  if (sizeError) return sizeError;
  if (!(await checkRateLimit(`mfa_settings_${user.id}`, 8, 15 * 60 * 1000))) {
    return NextResponse.json({ error: 'Muitas tentativas. Aguarde 15 minutos.' }, { status: 429 });
  }
  try {
    const { action, password, code } = await request.json();
    if (typeof password !== 'string' || Buffer.byteLength(password, 'utf8') > 72 || !(await bcrypt.compare(password, user.senha))) {
      return NextResponse.json({ error: 'Senha incorreta.' }, { status: 403 });
    }

    if (action === 'setup') {
      if (user.mfaEnabledAt && !(await consumeMfaCode(user.id, String(code || '')))) {
        return NextResponse.json({ error: 'Confirme um codigo do autenticador atual ou de recuperacao.' }, { status: 403 });
      }
      const secret = createTotpSecret();
      const uri = totpProvisioningUri(secret, user.email);
      await prisma.user.update({ where: { id: user.id }, data: {
        mfaPendingSecret: encrypt(secret), mfaPendingExpires: new Date(Date.now() + 10 * 60 * 1000),
      } });
      return NextResponse.json({ secret, qrCode: await QRCode.toDataURL(uri), expiresInSeconds: 600 }, { headers: PRIVATE_HEADERS });
    }

    if (action === 'enable') {
      if (!user.mfaPendingSecret || !user.mfaPendingExpires || user.mfaPendingExpires <= new Date()) {
        return NextResponse.json({ error: 'Configuracao expirada. Gere outro QR code.' }, { status: 400 });
      }
      const secret = decrypt(user.mfaPendingSecret);
      const step = secret ? matchingTotpStep(secret, String(code || '').trim()) : null;
      if (step === null) return NextResponse.json({ error: 'Codigo invalido. Verifique o relogio do autenticador.' }, { status: 400 });
      const recovery = createRecoveryCodes();
      const updated = await prisma.$transaction(async (tx) => {
        const changed = await tx.user.updateMany({
          where: { id: user.id, mfaPendingSecret: user.mfaPendingSecret, mfaPendingExpires: { gt: new Date() } },
          data: {
            mfaSecret: user.mfaPendingSecret, mfaPendingSecret: null, mfaPendingExpires: null,
            mfaEnabledAt: new Date(), mfaRecoveryCodes: JSON.stringify(recovery.hashes),
            mfaLastUsedStep: step, sessionVersion: { increment: 1 },
          },
        });
        if (changed.count !== 1) return null;
        await tx.authSession.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
        await tx.impersonationSession.updateMany({ where: { actorUserId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
        return tx.user.findUnique({ where: { id: user.id } });
      });
      if (!updated) return NextResponse.json({ error: 'Configuracao ja utilizada. Recomece.' }, { status: 409 });
      await revokeTrustedDevices(user.id);
      await trustCurrentDevice(request, user.id, 'TOTP');
      await createAuthSession(updated, request, true);
      await createLog({ level: 'ALERTA', action: 'MFA_ENABLED', module: 'AUTH', userId: user.id, message: 'Autenticador configurado; demais sessoes revogadas.' });
      return NextResponse.json({ success: true, recoveryCodes: recovery.codes }, { headers: PRIVATE_HEADERS });
    }

    if (!['disable', 'recovery-codes'].includes(action)) return NextResponse.json({ error: 'Acao invalida.' }, { status: 400 });
    if (action === 'disable' && roleRequiresMfa(user.role)) {
      return NextResponse.json({ error: 'MFA é obrigatório para equipe interna e contadores. Use a troca de autenticador.' }, { status: 403 });
    }
    if (!(await consumeMfaCode(user.id, String(code || '')))) return NextResponse.json({ error: 'Codigo invalido, expirado ou ja utilizado.' }, { status: 403 });

    if (action === 'recovery-codes') {
      const recovery = createRecoveryCodes();
      await prisma.user.update({ where: { id: user.id }, data: { mfaRecoveryCodes: JSON.stringify(recovery.hashes) } });
      await revokeTrustedDevices(user.id);
      await createLog({ level: 'ALERTA', action: 'MFA_RECOVERY_CODES_ROTATED', module: 'AUTH', userId: user.id, message: 'Codigos de recuperacao MFA renovados.' });
      return NextResponse.json({ success: true, recoveryCodes: recovery.codes }, { headers: PRIVATE_HEADERS });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.user.update({ where: { id: user.id }, data: {
        mfaSecret: null, mfaEnabledAt: null, mfaRecoveryCodes: null, mfaPendingSecret: null,
        mfaPendingExpires: null, mfaLastUsedStep: -1, sessionVersion: { increment: 1 },
      } });
      await tx.authSession.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
      return result;
    });
    await revokeTrustedDevices(user.id);
    await createAuthSession(updated, request);
    await createLog({ level: 'ALERTA', action: 'MFA_DISABLED', module: 'AUTH', userId: user.id, message: 'MFA desativado pelo titular; demais sessoes revogadas.' });
    return NextResponse.json({ success: true }, { headers: PRIVATE_HEADERS });
  } catch {
    return NextResponse.json({ error: 'Nao foi possivel concluir a configuracao de seguranca.' }, { status: 500 });
  }
}, { maxBodyBytes: 16 * 1024 });
