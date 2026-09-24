import { NextResponse } from 'next/server';
import { withApiGuard } from '@/app/utils/api-route';
import { getAuthenticatedUser, forbidden, unauthorized } from '@/app/utils/api-middleware';
import { prisma } from '@/app/utils/prisma';
import { requireAdminReauthentication } from '@/app/utils/admin-security';
import { validateJsonContentLength } from '@/app/utils/request-guards';
import { parsePrivacyResolutionInput, PrivacyError, resolvePrivacyRequest } from '@/app/services/privacyService';

export const GET = withApiGuard(async function GET(request: Request) {
  const user = await getAuthenticatedUser(request); if (!user) return unauthorized();
  if (!['MASTER', 'ADMIN'].includes(user.role)) return forbidden();
  const query = new URL(request.url).searchParams;
  const page = Math.max(1, Math.min(100_000, Number(query.get('page') || 1) || 1));
  const limit = Math.max(1, Math.min(100, Number(query.get('limit') || 25) || 25));
  const status = String(query.get('status') || 'ABERTAS').toUpperCase();
  if (!['ABERTAS', 'TODAS', 'ATRASADAS', 'CONCLUIDAS'].includes(status)) return NextResponse.json({ error: 'Filtro inválido.' }, { status: 400 });
  const now = new Date();
  const where = status === 'ABERTAS' ? { status: { in: ['PENDENTE', 'EM_ANALISE', 'AGUARDANDO_TITULAR'] } }
    : status === 'ATRASADAS' ? { status: { in: ['PENDENTE', 'EM_ANALISE', 'AGUARDANDO_TITULAR'] }, dueAt: { lt: now } }
      : status === 'CONCLUIDAS' ? { status: { in: ['CONCLUIDA', 'RECUSADA'] } } : {};
  const [items, total] = await prisma.$transaction([
    prisma.privacyRequest.findMany({ where, orderBy: [{ dueAt: 'asc' }, { createdAt: 'asc' }], skip: (page - 1) * limit, take: limit,
      select: { id: true, type: true, status: true, description: true, identityVerifiedAt: true, dueAt: true, resolutionSummary: true,
        legalBasis: true, resolvedAt: true, version: true, createdAt: true, updatedAt: true,
        subject: { select: { id: true, nome: true, email: true, privacyErasedAt: true } }, resolvedBy: { select: { id: true, nome: true } } } }),
    prisma.privacyRequest.count({ where }),
  ]);
  return NextResponse.json({ data: items, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } });
});

export const PUT = withApiGuard(async function PUT(request: Request) {
  const user = await getAuthenticatedUser(request); if (!user) return unauthorized();
  if (!['MASTER', 'ADMIN'].includes(user.role)) return forbidden();
  const sizeError = validateJsonContentLength(request, 16 * 1024); if (sizeError) return sizeError;
  try {
    const body = await request.json();
    parsePrivacyResolutionInput(body);
    const denied = await requireAdminReauthentication({ actorId: user.id, password: body.password, justification: body.justification, action: 'PRIVACY_REQUEST_RESOLUTION' });
    if (denied) return denied;
    return NextResponse.json(await resolvePrivacyRequest(user.id, body));
  } catch (error) { return NextResponse.json({ error: error instanceof PrivacyError ? error.message : 'Não foi possível atualizar a solicitação.' }, { status: error instanceof PrivacyError ? error.status : 500 }); }
}, { maxBodyBytes: 16 * 1024 });
