import { NextResponse } from 'next/server';
import { withApiGuard } from '@/app/utils/api-route';
import { getAuthenticatedUser, forbidden, unauthorized } from '@/app/utils/api-middleware';
import { requireAdminReauthentication } from '@/app/utils/admin-security';
import { validateJsonContentLength } from '@/app/utils/request-guards';
import { prisma } from '@/app/utils/prisma';
import { createSecurityIncident, parseSecurityIncidentCreate, parseSecurityIncidentUpdate, SecurityIncidentError, updateSecurityIncident } from '@/app/services/securityIncidentService';

function canManage(role: string) { return ['MASTER', 'ADMIN'].includes(role); }
function failure(error: unknown) {
  return NextResponse.json({ error: error instanceof SecurityIncidentError ? error.message : 'Não foi possível tratar o incidente.' },
    { status: error instanceof SecurityIncidentError ? error.status : 500 });
}

export const GET = withApiGuard(async function GET(request: Request) {
  const user = await getAuthenticatedUser(request); if (!user) return unauthorized(); if (!canManage(user.role)) return forbidden();
  const query = new URL(request.url).searchParams;
  const page = Math.max(1, Math.min(100_000, Number(query.get('page') || 1) || 1));
  const limit = Math.max(1, Math.min(100, Number(query.get('limit') || 25) || 25));
  const status = String(query.get('status') || 'ABERTOS').toUpperCase();
  if (!['ABERTOS', 'ATRASADOS', 'ENCERRADOS', 'TODOS'].includes(status)) return NextResponse.json({ error: 'Filtro inválido.' }, { status: 400 });
  const now = new Date();
  const where = status === 'ABERTOS' ? { status: { not: 'ENCERRADO' } }
    : status === 'ATRASADOS' ? { status: { notIn: ['COMUNICADO', 'ENCERRADO'] }, riskToSubjects: 'RELEVANTE', regulatoryDeadlineAt: { lt: now } }
      : status === 'ENCERRADOS' ? { status: 'ENCERRADO' } : {};
  const [items, total] = await prisma.$transaction([
    prisma.securityIncident.findMany({ where, orderBy: [{ regulatoryDeadlineAt: 'asc' }, { detectedAt: 'desc' }], skip: (page - 1) * limit, take: limit,
      include: { createdBy: { select: { id: true, nome: true } }, updatedBy: { select: { id: true, nome: true } } } }),
    prisma.securityIncident.count({ where }),
  ]);
  return NextResponse.json({ data: items, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } });
});

export const POST = withApiGuard(async function POST(request: Request) {
  const user = await getAuthenticatedUser(request); if (!user) return unauthorized(); if (!canManage(user.role)) return forbidden();
  const sizeError = validateJsonContentLength(request, 32 * 1024); if (sizeError) return sizeError;
  try {
    const body = await request.json(); parseSecurityIncidentCreate(body);
    const denied = await requireAdminReauthentication({ actorId: user.id, password: body.password, justification: body.justification, action: 'SECURITY_INCIDENT_CREATE' });
    if (denied) return denied;
    return NextResponse.json(await createSecurityIncident(user.id, body), { status: 201 });
  } catch (error) { return failure(error); }
}, { maxBodyBytes: 32 * 1024 });

export const PUT = withApiGuard(async function PUT(request: Request) {
  const user = await getAuthenticatedUser(request); if (!user) return unauthorized(); if (!canManage(user.role)) return forbidden();
  const sizeError = validateJsonContentLength(request, 48 * 1024); if (sizeError) return sizeError;
  try {
    const body = await request.json(); parseSecurityIncidentUpdate(body);
    const denied = await requireAdminReauthentication({ actorId: user.id, password: body.password, justification: body.justification, action: 'SECURITY_INCIDENT_UPDATE' });
    if (denied) return denied;
    return NextResponse.json(await updateSecurityIncident(user.id, body));
  } catch (error) { return failure(error); }
}, { maxBodyBytes: 48 * 1024 });
