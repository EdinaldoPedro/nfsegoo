import { NextResponse } from 'next/server';
import { withApiGuard } from '@/app/utils/api-route';
import { getAuthenticatedUser, forbidden, unauthorized } from '@/app/utils/api-middleware';
import { canOperateFiscalNote, fiscalOperationSelect } from '@/app/services/fiscalNoteService';
import { prisma } from '@/app/utils/prisma';

export const GET = withApiGuard(async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser(request);
  if (!user) return unauthorized();
  const customerMode = request.headers.get('x-portal-mode') === 'customer';
  const { id } = await params;
  const operation = await prisma.fiscalNoteOperation.findUnique({ where: { id }, select: fiscalOperationSelect });
  if (!operation || !await canOperateFiscalNote(user, operation.empresaId, 'CONSULTAR', prisma, customerMode)) return forbidden();
  return NextResponse.json({ operation });
});
