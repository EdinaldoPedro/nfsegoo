import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { prisma } from '@/app/utils/prisma';
import { CommercialError } from '@/app/utils/commercial-pricing';
import { passwordPolicyError } from '@/app/utils/password-policy';

const TOKEN_PATTERN = /^[a-f0-9]{64}$/;

function record(input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new CommercialError('Envie dados válidos.');
  return input as Record<string, unknown>;
}

export function normalizeRecoveryEmailInput(input: unknown) {
  const body = record(input);
  if (Object.keys(body).some(key => key !== 'email')) throw new CommercialError('Campos não permitidos.');
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new CommercialError('Informe um e-mail válido.');
  }
  return email;
}

export function normalizePasswordResetInput(input: unknown) {
  const body = record(input);
  if (Object.keys(body).some(key => !['token', 'senha'].includes(key))) throw new CommercialError('Campos não permitidos.');
  if (typeof body.token !== 'string' || !TOKEN_PATTERN.test(body.token)) throw new CommercialError('Link inválido ou expirado.');
  const passwordError = passwordPolicyError(body.senha);
  if (passwordError) throw new CommercialError(passwordError);
  return { token: body.token, password: body.senha as string };
}

export function passwordResetTokenHash(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export async function stagePasswordReset(email: string) {
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, email: true, nome: true } });
  if (!user) return null;
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = passwordResetTokenHash(token);
  const request = await prisma.passwordResetRequest.create({ data: {
    userId: user.id, tokenHash, expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  }, select: { id: true } });
  return { requestId: request.id, token, tokenHash, user };
}

export async function markPasswordResetDelivered(requestId: string, tokenHash: string) {
  const result = await prisma.passwordResetRequest.updateMany({
    where: { id: requestId, tokenHash, deliveredAt: null, deliveryFailedAt: null, consumedAt: null, revokedAt: null,
      expiresAt: { gt: new Date() } },
    data: { deliveredAt: new Date() },
  });
  return result.count === 1;
}

export async function markPasswordResetDeliveryFailed(requestId: string, tokenHash: string) {
  const now = new Date();
  const result = await prisma.passwordResetRequest.updateMany({
    where: { id: requestId, tokenHash, deliveredAt: null, deliveryFailedAt: null, consumedAt: null, revokedAt: null },
    data: { deliveryFailedAt: now, revokedAt: now },
  });
  return result.count === 1;
}

type LockedReset = {
  id: string;
  userId: string;
  expiresAt: Date;
  deliveredAt: Date | null;
  deliveryFailedAt: Date | null;
  consumedAt: Date | null;
  revokedAt: Date | null;
};

export async function consumePasswordReset(token: string, password: string) {
  const tokenHash = passwordResetTokenHash(token);
  const candidate = await prisma.passwordResetRequest.findUnique({ where: { tokenHash }, select: { userId: true } });
  if (!candidate) throw new CommercialError('Link inválido ou expirado.');
  const hashedPassword = await bcrypt.hash(password, 10);

  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${candidate.userId} FOR UPDATE`;
    const rows = await tx.$queryRaw<LockedReset[]>`SELECT "id", "userId", "expiresAt", "deliveredAt", "deliveryFailedAt", "consumedAt", "revokedAt"
      FROM "PasswordResetRequest" WHERE "tokenHash" = ${tokenHash} FOR UPDATE`;
    const request = rows[0], now = new Date();
    if (!request || request.userId !== candidate.userId || !request.deliveredAt || request.deliveryFailedAt
      || request.consumedAt || request.revokedAt || request.expiresAt <= now) {
      throw new CommercialError('Link inválido ou expirado.');
    }
    const user = await tx.user.findUniqueOrThrow({ where: { id: candidate.userId }, select: { id: true, senha: true } });
    if (await bcrypt.compare(password, user.senha)) throw new CommercialError('A nova senha precisa ser diferente da senha atual.');

    await tx.user.update({ where: { id: user.id }, data: {
      senha: hashedPassword, resetToken: null, resetExpires: null,
      tempEmail: null, verificationCode: null, verificationExpires: null,
      sessionVersion: { increment: 1 },
    } });
    await tx.passwordResetRequest.update({ where: { id: request.id }, data: { consumedAt: now } });
    await tx.passwordResetRequest.updateMany({ where: { userId: user.id, id: { not: request.id }, consumedAt: null, revokedAt: null }, data: { revokedAt: now } });
    await tx.authSession.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: now } });
    await tx.mfaTrustedDevice.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: now } });
    await tx.mfaLoginChallenge.updateMany({ where: { userId: user.id, consumedAt: null }, data: { consumedAt: now } });
    await tx.impersonationSession.updateMany({ where: { OR: [{ actorUserId: user.id }, { targetUserId: user.id }], revokedAt: null }, data: { revokedAt: now } });
    await tx.systemLog.create({ data: { level: 'ALERTA', action: 'PASSWORD_RESET', module: 'AUTH', userId: user.id,
      message: 'Senha redefinida pelo fluxo de recuperação; acessos revogados.', details: JSON.stringify({ resetRequestId: request.id }) } });
    return { userId: user.id };
  });
}
