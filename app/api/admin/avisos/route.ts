import { NextResponse } from 'next/server';
import { withApiGuard } from '@/app/utils/api-route';
import { getAuthenticatedUser, forbidden, unauthorized } from '@/app/utils/api-middleware';
import { isAdminRole } from '@/app/utils/access-control';
import { requireAdminReauthentication } from '@/app/utils/admin-security';
import { CommercialError } from '@/app/utils/commercial-pricing';
import { prisma } from '@/app/utils/prisma';
import { archiveNotice, noticeMetadataSelect, parseNoticeArchive, parseNoticeMutation, saveNotice,
  serializeNotice } from '@/app/services/globalNoticeService';

const statuses = ['RASCUNHO', 'AGENDADO', 'ATIVO', 'PAUSADO', 'ARQUIVADO', 'TODOS'];
async function admin(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return { response: unauthorized(), user: null };
  if (!isAdminRole(user.role)) return { response: forbidden(), user: null };
  return { response: null, user };
}

export const GET = withApiGuard(async function GET(request: Request) {
  const access = await admin(request); if (access.response) return access.response;
  const params = new URL(request.url).searchParams;
  if (Array.from(params.keys()).some(key => !['page', 'status'].includes(key))) return NextResponse.json({ error: 'Filtro inválido.' }, { status: 400 });
  const pageText = params.get('page') || '1', status = params.get('status') || 'TODOS';
  if (!/^[1-9]\d{0,4}$/.test(pageText) || !statuses.includes(status)) return NextResponse.json({ error: 'Página ou situação inválida.' }, { status: 400 });
  const page = Number(pageText), where = status === 'TODOS' ? {} : status === 'AGENDADO'
    ? { status: 'ATIVO', iniciaEm: { gt: new Date() } } : { status };
  const [rows, total] = await prisma.$transaction([
    prisma.globalNotice.findMany({ where, orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * 25, take: 25, select: noticeMetadataSelect }),
    prisma.globalNotice.count({ where }),
  ]);
  return NextResponse.json({ data: rows.map(row => serializeNotice(row)), meta: { page, pageSize: 25, total, pages: Math.ceil(total / 25) } });
});

async function mutate(request: Request, mode: 'create' | 'update') {
  const access = await admin(request); if (access.response) return access.response;
  try {
    const mutation = parseNoticeMutation(await request.json(), mode);
    const reauth = await requireAdminReauthentication({ actorId: access.user!.id, password: mutation.adminPassword,
      justification: mutation.justification, action: mode === 'create' ? 'GLOBAL_NOTICE_CREATE' : 'GLOBAL_NOTICE_UPDATE' });
    if (reauth) return reauth;
    return NextResponse.json(await saveNotice(access.user!.id, mutation), { status: mode === 'create' ? 201 : 200 });
  } catch (error) {
    if (error instanceof CommercialError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
export const POST = withApiGuard((request: Request) => mutate(request, 'create'), { maxBodyBytes: 3 * 1024 * 1024 });
export const PUT = withApiGuard((request: Request) => mutate(request, 'update'), { maxBodyBytes: 3 * 1024 * 1024 });

export const DELETE = withApiGuard(async function DELETE(request: Request) {
  const access = await admin(request); if (access.response) return access.response;
  try {
    const mutation = parseNoticeArchive(await request.json());
    const reauth = await requireAdminReauthentication({ actorId: access.user!.id, password: mutation.adminPassword,
      justification: mutation.justification, action: 'GLOBAL_NOTICE_ARCHIVE' });
    if (reauth) return reauth;
    return NextResponse.json(await archiveNotice(access.user!.id, mutation));
  } catch (error) {
    if (error instanceof CommercialError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
}, { maxBodyBytes: 8 * 1024 });
