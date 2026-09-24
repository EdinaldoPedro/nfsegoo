import { NextResponse } from 'next/server';
import { withApiGuard } from '@/app/utils/api-route';
import { prisma } from '@/app/utils/prisma';
import { getAuthenticatedUser, unauthorized } from '@/app/utils/api-middleware';
import { noticeAudiences } from '@/app/services/globalNoticeService';
import { hasCustomerAccountCapability } from '@/app/utils/access-control';

export const GET = withApiGuard(async function GET(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return unauthorized();
  const now = new Date();
  const hybridCustomer = await hasCustomerAccountCapability(user);
  const notices = await prisma.globalNotice.findMany({ where: { status: 'ATIVO', publico: { in: noticeAudiences(user.role, hybridCustomer) },
    OR: [{ iniciaEm: null }, { iniciaEm: { lte: now } }], AND: [{ OR: [{ terminaEm: null }, { terminaEm: { gte: now } }] }] },
    orderBy: [{ tipo: 'desc' }, { createdAt: 'desc' }], take: 10,
    select: { id: true, titulo: true, mensagem: true, tipo: true, linkLabel: true, linkHref: true,
      anexoNome: true, terminaEm: true, createdAt: true } });
  return NextResponse.json(notices.map(notice => ({ id: notice.id, title: notice.titulo, description: notice.mensagem,
    tone: notice.tipo === 'CRITICAL' ? 'red' : notice.tipo === 'WARNING' ? 'amber' : notice.tipo === 'SUCCESS' ? 'emerald' : 'blue',
    action: notice.linkLabel || (notice.anexoNome ? 'Baixar anexo' : 'Ver aviso'), href: notice.linkHref || '#',
    attachmentName: notice.anexoNome, attachmentHref: notice.anexoNome ? `/api/avisos/${notice.id}/anexo` : null,
    expiresAt: notice.terminaEm, createdAt: notice.createdAt })));
});
