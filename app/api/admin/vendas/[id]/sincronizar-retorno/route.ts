import { NextResponse } from 'next/server';
import { withApiGuard } from '@/app/utils/api-route';
import { getAuthenticatedUser, forbidden, unauthorized } from '@/app/utils/api-middleware';
import { isSupportRole } from '@/app/utils/access-control';
import { prisma } from '@/app/utils/prisma';
import { enqueueFiscalNoteOperation, fiscalError } from '@/app/services/fiscalNoteService';
import { checkRateLimit } from '@/app/utils/rate-limit';

export const POST = withApiGuard(async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser(request);
  if (!user) return unauthorized();
  if (!isSupportRole(user.role)) return forbidden();
  if (!await checkRateLimit('consult_note_' + user.id, 10, 60_000)) return NextResponse.json({ error: 'Aguarde antes de solicitar novas consultas.' }, { status: 429 });
  try {
    const { id } = await params;
    const notes = await prisma.notaFiscal.findMany({ where: { vendaId: id, chaveAcesso: { not: null }, arquivadoEm: null }, select: { id: true }, take: 2 });
    if (notes.length !== 1) fiscalError('Identifique uma única nota com chave de acesso antes de consultar.');
    const operation = await enqueueFiscalNoteOperation({ actorId: user.id, notaId: notes[0].id, tipo: 'CONSULTAR' });
    return NextResponse.json({ accepted: true, operation, message: 'Consulta fiscal agendada. Nenhum reenvio será realizado.' }, { status: 202 });
  } catch (error) {
    const failure = error as Error & { status?: number };
    if (failure.status && failure.status < 500) return NextResponse.json({ error: failure.message }, { status: failure.status });
    throw error;
  }
});
