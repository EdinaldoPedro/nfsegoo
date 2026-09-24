import { NextResponse } from 'next/server';
import { withApiGuard } from '@/app/utils/api-route';
import { validateRequest } from '@/app/utils/api-security';
import { hasCustomerCompanyAccess, resolveEmpresaContexto } from '@/app/utils/access-control';
import { prisma } from '@/app/utils/prisma';

async function context(request: Request) {
  const auth = await validateRequest(request);
  if (auth.errorResponse) return { error: auth.errorResponse };
  if (!auth.user) return { error: NextResponse.json({ error: 'Autenticação necessária.' }, { status: 401 }) };
  const key = new URL(request.url).searchParams.get('key') || '';
  const company = await resolveEmpresaContexto(auth.user, request.headers.get('x-empresa-id'));
  if (!company || (key && !/^[a-z0-9:_-]{8,160}$/i.test(key))) return { error: NextResponse.json({ error: 'Solicitação indisponível.' }, { status: 404 }) };
  return { user: auth.user, key, company };
}

export const GET = withApiGuard(async function GET(request: Request) {
  const ctx = await context(request);
  if (ctx.error) return ctx.error;
  if (!ctx.key) {
    const job = await prisma.emissaoJob.findFirst({ where: { empresaId: ctx.company!, actorUserId: ctx.user!.id, acknowledgedAt: null },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, idempotencyKey: true, status: true, statusMessage: true, resultNotaId: true } });
    return NextResponse.json({ job });
  }
  const job = await prisma.emissaoJob.findUnique({ where: { empresaId_idempotencyKey: { empresaId: ctx.company!, idempotencyKey: ctx.key! } },
    select: { id: true, status: true, statusMessage: true } });
  return job ? NextResponse.json({ job }) : NextResponse.json({ error: 'Solicitação ainda não registrada.' }, { status: 404 });
});

// Atomically tombstone a request that never entered the queue. A delayed POST
// racing with this DELETE either already has a job, or is forbidden by the block.
// This endpoint NEVER cancels or deletes an existing fiscal job.
export const DELETE = withApiGuard(async function DELETE(request: Request) {
  const ctx = await context(request);
  if (ctx.error) return ctx.error;
  if (!ctx.key) return NextResponse.json({ error: 'Informe a solicitação.' }, { status: 400 });
  const result = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Empresa" WHERE "id" = ${ctx.company!} FOR UPDATE`;
    const actor = await tx.user.findUniqueOrThrow({ where: { id: ctx.user!.id } });
    if (!await hasCustomerCompanyAccess(actor, ctx.company, tx)) throw Object.assign(new Error('Permissão revogada.'), { status: 403 });
    const where = { empresaId_idempotencyKey: { empresaId: ctx.company!, idempotencyKey: ctx.key! } };
    const job = await tx.emissaoJob.findUnique({ where, select: { id: true, status: true } });
    if (job) return { discarded: false, job };
    await tx.emissionRequestBlock.upsert({ where, create: { empresaId: ctx.company!, idempotencyKey: ctx.key!, actorUserId: actor.id }, update: {} });
    return { discarded: true };
  });
  return NextResponse.json(result);
});

export const PUT = withApiGuard(async function PUT(request: Request) {
  const ctx = await context(request);
  if (ctx.error) return ctx.error;
  if (!ctx.key) return NextResponse.json({ error: 'Informe a solicitação.' }, { status: 400 });
  const result = await prisma.emissaoJob.updateMany({ where: { empresaId: ctx.company!, idempotencyKey: ctx.key!, actorUserId: ctx.user!.id,
    status: { in: ['AUTORIZADA', 'ERRO_FINAL'] } }, data: { acknowledgedAt: new Date() } });
  return result.count ? NextResponse.json({ acknowledged: true }) : NextResponse.json({ error: 'Solicitação ainda não concluída ou pertence a outro operador.' }, { status: 409 });
});
