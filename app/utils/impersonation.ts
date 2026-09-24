import { createHash, randomBytes } from 'crypto';
import { cookies } from 'next/headers';
import { prisma } from '@/app/utils/prisma';
import { verifyJWT } from '@/app/utils/auth';

export const IMPERSONATION_COOKIE = 'impersonation_token';
export const IMPERSONATION_DURATION_MINUTES = 30;

export function hashImpersonationToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

export function createImpersonationToken() {
  return randomBytes(32).toString('base64url');
}

export function getImpersonationExpiry() {
  return new Date(Date.now() + IMPERSONATION_DURATION_MINUTES * 60 * 1000);
}

export async function getActiveImpersonation(params: {
  actorUserId: string;
  targetUserId: string;
}) {
  const rawToken = (await cookies()).get(IMPERSONATION_COOKIE)?.value;
  if (!rawToken) return null;
  const authToken = (await cookies()).get('auth_token')?.value;
  const authPayload = authToken ? await verifyJWT(authToken) : null;
  if (typeof authPayload?.jti !== 'string' || authPayload.sub !== params.actorUserId) return null;

  return prisma.impersonationSession.findFirst({
    where: {
      tokenHash: hashImpersonationToken(rawToken),
      actorUserId: params.actorUserId,
      actorSessionId: authPayload.jti,
      targetUserId: params.targetUserId,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
  });
}

export async function revokeCurrentImpersonation(actorUserId: string) {
  const rawToken = (await cookies()).get(IMPERSONATION_COOKIE)?.value;
  if (!rawToken) return;

  await prisma.impersonationSession.updateMany({
    where: {
      tokenHash: hashImpersonationToken(rawToken),
      actorUserId,
      revokedAt: null,
    },
    data: { revokedAt: new Date() },
  });
}

export function isSafeImpersonationMethod(method: string) {
  return ['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase());
}
