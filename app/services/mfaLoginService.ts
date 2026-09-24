import crypto from 'node:crypto';
import { cookies } from 'next/headers';
import { prisma } from '@/app/utils/prisma';
import { privateHash } from '@/app/utils/private-hash';
import { consumeMfaProof } from './mfaService';

export const TRUSTED_DEVICE_COOKIE = 'trusted_device';
export const TOTP_TRUST_SECONDS = 7 * 24 * 60 * 60;
export const EMAIL_TRUST_SECONDS = 24 * 60 * 60;
const CHALLENGE_SECONDS = 10 * 60;

const tokenHash = (token: string) => privateHash('mfa-login-challenge', token);
const deviceHash = (token: string) => privateHash('mfa-trusted-device', token);
const agentHash = (request: Request) => privateHash('mfa-trusted-agent', (request.headers.get('user-agent') || '').slice(0, 500));
const emailCodeHash = (challengeId: string, code: string) => privateHash('mfa-email-code', `${challengeId}:${code}`);

function safeHashEqual(left: string | null, right: string) {
  if (!left || !/^[a-f0-9]{64}$/.test(left) || !/^[a-f0-9]{64}$/.test(right)) return false;
  return crypto.timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}

export async function createMfaLoginChallenge(userId: string) {
  const raw = crypto.randomBytes(32).toString('hex');
  const now = new Date();
  const challenge = await prisma.$transaction(async tx => {
    await tx.mfaLoginChallenge.updateMany({ where: { userId, consumedAt: null }, data: { consumedAt: now } });
    return tx.mfaLoginChallenge.create({ data: {
      userId, tokenHash: tokenHash(raw), expiresAt: new Date(now.getTime() + CHALLENGE_SECONDS * 1000),
    }, select: { id: true, expiresAt: true } });
  });
  return { token: raw, ...challenge };
}

export async function findMfaLoginChallenge(raw: string) {
  if (!/^[a-f0-9]{64}$/.test(raw)) return null;
  return prisma.mfaLoginChallenge.findFirst({
    where: { tokenHash: tokenHash(raw), consumedAt: null, expiresAt: { gt: new Date() }, attempts: { lt: 5 } },
    include: { user: true },
  });
}

export async function stageMfaEmailCode(raw: string) {
  const challenge = await findMfaLoginChallenge(raw);
  if (!challenge) return null;
  const code = crypto.randomInt(100000, 1000000).toString();
  const expiresAt = new Date(Date.now() + CHALLENGE_SECONDS * 1000);
  const storedHash = emailCodeHash(challenge.id, code);
  const changed = await prisma.mfaLoginChallenge.updateMany({
    where: { id: challenge.id, consumedAt: null, expiresAt: { gt: new Date() } },
    data: { emailCodeHash: storedHash, emailCodeExpiresAt: expiresAt, emailCodeSentAt: new Date() },
  });
  return changed.count === 1 ? { challenge, code, expiresAt, storedHash } : null;
}

export async function discardMfaEmailCode(challengeId: string, storedHash: string) {
  await prisma.mfaLoginChallenge.updateMany({ where: { id: challengeId, emailCodeHash: storedHash, consumedAt: null }, data: {
    emailCodeHash: null, emailCodeExpiresAt: null, emailCodeSentAt: null,
  } });
}

export async function consumeMfaLoginChallenge(raw: string, method: 'TOTP' | 'EMAIL', code: string) {
  const challenge = await findMfaLoginChallenge(raw);
  if (!challenge) return null;
  let proof: 'TOTP' | 'EMAIL' | 'RECOVERY' | null = null;
  if (method === 'EMAIL') {
    const expected = /^\d{6}$/.test(code) ? emailCodeHash(challenge.id, code) : '';
    if (challenge.emailCodeExpiresAt && challenge.emailCodeExpiresAt > new Date() && safeHashEqual(challenge.emailCodeHash, expected)) proof = 'EMAIL';
  } else {
    proof = await consumeMfaProof(challenge.userId, code);
  }
  if (!proof) {
    await prisma.mfaLoginChallenge.updateMany({ where: { id: challenge.id, consumedAt: null }, data: { attempts: { increment: 1 } } });
    return null;
  }
  const changed = await prisma.mfaLoginChallenge.updateMany({
    where: { id: challenge.id, tokenHash: challenge.tokenHash, consumedAt: null, expiresAt: { gt: new Date() } },
    data: { consumedAt: new Date() },
  });
  return changed.count === 1 ? { user: challenge.user, proof } : null;
}

export async function validateTrustedDevice(request: Request, userId: string) {
  const raw = (await cookies()).get(TRUSTED_DEVICE_COOKIE)?.value;
  if (!raw || !/^[a-f0-9]{64}$/.test(raw)) return false;
  const device = await prisma.mfaTrustedDevice.findFirst({ where: {
    userId, tokenHash: deviceHash(raw), userAgentHash: agentHash(request), revokedAt: null, expiresAt: { gt: new Date() },
  }, select: { id: true } });
  if (!device) return false;
  await prisma.mfaTrustedDevice.update({ where: { id: device.id }, data: { lastUsedAt: new Date() } });
  return true;
}

export async function trustCurrentDevice(request: Request, userId: string, method: 'TOTP' | 'EMAIL') {
  const raw = crypto.randomBytes(32).toString('hex');
  const duration = method === 'TOTP' ? TOTP_TRUST_SECONDS : EMAIL_TRUST_SECONDS;
  await prisma.mfaTrustedDevice.create({ data: {
    userId, tokenHash: deviceHash(raw), method, userAgentHash: agentHash(request), expiresAt: new Date(Date.now() + duration * 1000),
  } });
  (await cookies()).set({ name: TRUSTED_DEVICE_COOKIE, value: raw, httpOnly: true,
    secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/', maxAge: duration });
}

export async function revokeTrustedDevices(userId: string) {
  await prisma.mfaTrustedDevice.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  (await cookies()).set({ name: TRUSTED_DEVICE_COOKIE, value: '', httpOnly: true,
    secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/', maxAge: 0 });
}
