import { withApiGuard } from '@/app/utils/api-route';
import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { getAuthenticatedUser, unauthorized } from '@/app/utils/api-middleware';
import { prisma } from '@/app/utils/prisma';
import { checkRateLimit } from '@/app/utils/rate-limit';
import { validateJsonContentLength, validateSameOrigin } from '@/app/utils/request-guards';
import { revokeTrustedDevices } from '@/app/services/mfaLoginService';

export const GET = withApiGuard(async function GET(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return unauthorized();
  const devices = await prisma.mfaTrustedDevice.findMany({
    where: { userId: user.id, revokedAt: null, expiresAt: { gt: new Date() } },
    select: { id: true, method: true, createdAt: true, lastUsedAt: true, expiresAt: true },
    orderBy: { lastUsedAt: 'desc' }, take: 30,
  });
  return NextResponse.json(devices, { headers: { 'Cache-Control': 'no-store, private' } });
});

export const DELETE = withApiGuard(async function DELETE(request: Request) {
  const originError = validateSameOrigin(request);
  if (originError) return originError;
  const user = await getAuthenticatedUser(request);
  if (!user) return unauthorized();
  const sizeError = validateJsonContentLength(request, 8 * 1024);
  if (sizeError) return sizeError;
  if (!(await checkRateLimit(`trusted_device_revoke_${user.id}`, 10, 15 * 60 * 1000))) return NextResponse.json({ error: 'Muitas tentativas.' }, { status: 429 });
  const body = await request.json().catch(() => ({}));
  if (body.all === true) {
    if (typeof body.password !== 'string' || !(await bcrypt.compare(body.password, user.senha))) return NextResponse.json({ error: 'Senha incorreta.' }, { status: 403 });
    await revokeTrustedDevices(user.id);
  } else {
    if (typeof body.deviceId !== 'string') return NextResponse.json({ error: 'Dispositivo obrigatório.' }, { status: 400 });
    await prisma.mfaTrustedDevice.updateMany({ where: { id: body.deviceId, userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
  }
  return NextResponse.json({ success: true });
}, { maxBodyBytes: 8 * 1024 });
