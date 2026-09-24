import { withApiGuard } from '@/app/utils/api-route';
import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { getAuthenticatedUser, unauthorized } from '@/app/utils/api-middleware';
import { prisma } from '@/app/utils/prisma';
import { clearAuthCookie, currentSessionId } from '@/app/utils/auth-session';
import { validateJsonContentLength } from '@/app/utils/request-guards';
import { createLog } from '@/app/services/logger';
import { checkRateLimit } from '@/app/utils/rate-limit';

export const GET = withApiGuard(async function GET(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return unauthorized();
  const currentId = await currentSessionId();
  const sessions = await prisma.authSession.findMany({
    where: { userId: user.id, revokedAt: null, expiresAt: { gt: new Date() }, sessionVersion: user.sessionVersion },
    select: { id: true, ipAddress: true, userAgent: true, createdAt: true, expiresAt: true, mfaVerifiedAt: true },
    orderBy: { createdAt: 'desc' }, take: 50,
  });
  return NextResponse.json(sessions.map((session) => ({ ...session, current: session.id === currentId })), { headers: { 'Cache-Control': 'no-store, private' } });
});

export const DELETE = withApiGuard(async function DELETE(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return unauthorized();
  const sizeError = validateJsonContentLength(request, 16 * 1024);
  if (sizeError) return sizeError;
  if (!(await checkRateLimit(`sessions_revoke_${user.id}`, 10, 15 * 60 * 1000))) return NextResponse.json({ error: 'Muitas tentativas.' }, { status: 429 });
  const body = await request.json().catch(() => ({}));
  const currentId = await currentSessionId();
  if (body.all === true) {
    if (typeof body.password !== 'string' || !(await bcrypt.compare(body.password, user.senha))) return NextResponse.json({ error: 'Senha incorreta.' }, { status: 403 });
    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { sessionVersion: { increment: 1 } } });
      await tx.authSession.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.impersonationSession.updateMany({ where: { actorUserId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
    });
    await clearAuthCookie();
  } else {
    if (typeof body.sessionId !== 'string') return NextResponse.json({ error: 'Sessao obrigatoria.' }, { status: 400 });
    await prisma.authSession.updateMany({ where: { id: body.sessionId, userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
    if (body.sessionId === currentId) await clearAuthCookie();
  }
  await createLog({ level: 'INFO', action: 'AUTH_SESSIONS_REVOKED', module: 'AUTH', userId: user.id, message: 'Sessoes encerradas pelo titular.', details: { all: body.all === true } });
  return NextResponse.json({ success: true, requiresLogin: body.all === true || body.sessionId === currentId });
}, { maxBodyBytes: 16 * 1024 });
