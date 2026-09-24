import { cookies } from 'next/headers';
import { randomUUID } from 'crypto';
import { prisma } from './prisma';
import { signJWT, verifyJWT } from './auth';
import { getRequestIp } from './request-ip';
import { privacyVersion, termsVersion } from '@/app/legal-content';

export const AUTH_COOKIE = 'auth_token';
export const SESSION_DURATION_SECONDS = 8 * 60 * 60;

export async function findActiveAuthSession(token: string) {
  const payload = await verifyJWT(token);
  if (typeof payload?.sub !== 'string' || typeof payload.jti !== 'string' || !Number.isInteger(payload.sv)) return null;
  const session = await prisma.authSession.findFirst({
    where: { id: payload.jti, userId: payload.sub, revokedAt: null, expiresAt: { gt: new Date() } },
    include: { user: { include: { legalAcceptances: { where: { termsVersion, privacyVersion }, select: { id: true }, take: 1 } } } },
  });
  if (!session || session.sessionVersion !== payload.sv || session.user.sessionVersion !== payload.sv || session.user.privacyErasedAt) return null;
  return session;
}

export async function createAuthSession(
  user: { id: string; role: string; sessionVersion: number },
  request: Request,
  mfaVerified = false,
) {
  const sessionId = randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_DURATION_SECONDS * 1000);
  await prisma.authSession.create({
    data: {
      id: sessionId, userId: user.id, sessionVersion: user.sessionVersion,
      ipAddress: getRequestIp(request), userAgent: (request.headers.get('user-agent') || '').slice(0, 500),
      expiresAt, mfaVerifiedAt: mfaVerified ? new Date() : null,
    },
  });
  const token = await signJWT({ sub: user.id, role: user.role, sv: user.sessionVersion, sessionId });
  (await cookies()).set({
    name: AUTH_COOKIE, value: token, httpOnly: true, secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax', path: '/', maxAge: SESSION_DURATION_SECONDS,
  });
  (await cookies()).set({ name: 'impersonation_token', value: '', httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/', maxAge: 0 });
  return { sessionId, expiresAt };
}

export async function currentSessionId() {
  const token = (await cookies()).get(AUTH_COOKIE)?.value;
  const payload = token ? await verifyJWT(token) : null;
  return typeof payload?.jti === 'string' ? payload.jti : null;
}

export async function clearAuthCookie() {
  (await cookies()).set({ name: AUTH_COOKIE, value: '', httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 0 });
}

export async function revokeCurrentAuthSession(userId: string) {
  const id = await currentSessionId();
  if (id) await prisma.authSession.updateMany({ where: { id, userId, revokedAt: null }, data: { revokedAt: new Date() } });
  await clearAuthCookie();
}
