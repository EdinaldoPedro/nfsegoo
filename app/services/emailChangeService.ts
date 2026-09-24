import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { prisma } from '@/app/utils/prisma';
import { CommercialError } from '@/app/utils/commercial-pricing';
import { privateHash } from '@/app/utils/private-hash';

export const emailVerificationHash = (userId: string, code: string) =>
  privateHash('email-change-code', userId + ':' + code);
export function normalizeEmailChangeInput(input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new CommercialError('Dados inválidos.');
  const body = input as Record<string, unknown>;
  if (Object.keys(body).some(key => !['newEmail', 'password'].includes(key))) throw new CommercialError('Campos não permitidos.');
  const email = typeof body.newEmail === 'string' ? body.newEmail.trim().toLowerCase() : '';
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    || typeof body.password !== 'string' || !body.password || Buffer.byteLength(body.password, 'utf8') > 72) {
    throw new CommercialError('Novo e-mail e senha atual válidos são obrigatórios.');
  }
  return { email, password: body.password };
}
export function normalizeEmailCode(input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new CommercialError('Código inválido.');
  const body = input as Record<string, unknown>;
  if (Object.keys(body).some(key => key !== 'code') || typeof body.code !== 'string' || !/^\d{6}$/.test(body.code)) throw new CommercialError('Informe o código de seis dígitos.');
  return body.code;
}
function sameHash(left: string | null, right: string) {
  return !!left && /^[a-f0-9]{64}$/.test(left) && crypto.timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}
export async function stageEmailChange(userId: string, sessionVersion: number, email: string, password: string) {
  const code = crypto.randomInt(100000, 1000000).toString(), storedHash = emailVerificationHash(userId, code);
  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true, senha: true, sessionVersion: true } });
    if (user.sessionVersion !== sessionVersion) throw new CommercialError('Sessão alterada. Entre novamente.', 401);
    if (!await bcrypt.compare(password, user.senha)) throw new CommercialError('Senha atual incorreta.', 403);
    if (user.email === email) throw new CommercialError('Este já é o e-mail atual.', 409);
    if (await tx.user.findFirst({ where: { OR: [{ email }, { tempEmail: email }], id: { not: userId } }, select: { id: true } })) throw new CommercialError('Este e-mail já está em uso ou em confirmação.', 409);
    await tx.user.update({ where: { id: userId }, data: { tempEmail: email, verificationCode: storedHash,
      verificationExpires: new Date(Date.now() + 15 * 60 * 1000) } });
  });
  return { code, email, storedHash };
}
export async function discardStagedEmailChange(userId: string, email: string, storedHash: string) {
  await prisma.user.updateMany({ where: { id: userId, tempEmail: email, verificationCode: storedHash },
    data: { tempEmail: null, verificationCode: null, verificationExpires: null } });
}
export async function confirmEmailChange(userId: string, sessionVersion: number, code: string) {
  const expected = emailVerificationHash(userId, code);
  try {
    return await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId },
        select: { id: true, email: true, tempEmail: true, verificationCode: true, verificationExpires: true, sessionVersion: true } });
      if (user.sessionVersion !== sessionVersion) throw new CommercialError('Sessão alterada. Entre novamente.', 401);
      if (!sameHash(user.verificationCode, expected) || !user.tempEmail || !user.verificationExpires || user.verificationExpires <= new Date()) throw new CommercialError('Código inválido ou expirado.');
      if (await tx.user.findFirst({ where: { email: user.tempEmail, id: { not: user.id } }, select: { id: true } })) throw new CommercialError('Este e-mail já está em uso.', 409);
      const previousEmailHash = privateHash('email-audit', user.email);
      const nextEmailHash = privateHash('email-audit', user.tempEmail), nextEmail = user.tempEmail, now = new Date();
      await tx.user.update({ where: { id: user.id }, data: { email: nextEmail, tempEmail: null, verificationCode: null,
        verificationExpires: null, resetToken: null, resetExpires: null, sessionVersion: { increment: 1 } } });
      await tx.authSession.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: now } });
      await tx.mfaTrustedDevice.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: now } });
      await tx.mfaLoginChallenge.updateMany({ where: { userId: user.id, consumedAt: null }, data: { consumedAt: now } });
      await tx.impersonationSession.updateMany({ where: { OR: [{ actorUserId: user.id }, { targetUserId: user.id }], revokedAt: null }, data: { revokedAt: now } });
      await tx.systemLog.create({ data: { level: 'ALERTA', action: 'ACCOUNT_EMAIL_CHANGED', module: 'AUTH', userId: user.id,
        message: 'E-mail confirmado pelo titular; sessões revogadas.', details: JSON.stringify({ previousEmailHash, nextEmailHash }) } });
      return { email: nextEmail };
    });
  } catch (error) {
    if ((error as { code?: string }).code === 'P2002') throw new CommercialError('Este e-mail já está em uso.', 409);
    throw error;
  }
}
