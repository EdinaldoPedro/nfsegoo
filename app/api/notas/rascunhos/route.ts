import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/app/utils/prisma';
import { validateRequest } from '@/app/utils/api-security';
import { forbidden, unauthorized } from '@/app/utils/api-middleware';

const MAX_RASCUNHOS = 5;

async function getEmpresaContexto(user: any, contextId: string | null) {
  const isStaff = ['MASTER', 'ADMIN', 'SUPORTE', 'SUPORTE_TI'].includes(user.role);

  if (contextId && contextId !== 'null' && contextId !== 'undefined') {
    if (isStaff) return contextId;
    if (contextId === user.empresaId) return contextId;

    const colaborador = await prisma.userCliente.findUnique({
      where: { userId_empresaId: { userId: user.id, empresaId: contextId } },
    });
    if (colaborador) return contextId;

    const vinculo = await prisma.contadorVinculo.findUnique({
      where: { contadorId_empresaId: { contadorId: user.id, empresaId: contextId } },
    });
    if (vinculo && vinculo.status === 'APROVADO' && !(vinculo as any).arquivadoEm) return contextId;

    return null;
  }

  return user.empresaId;
}

function parsePayload(payloadJson: string) {
  try {
    return JSON.parse(payloadJson);
  } catch {
    return null;
  }
}

async function enforceLimit(userId: string, empresaId: string) {
  const excedentes = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "NotaRascunho"
    WHERE "userId" = ${userId} AND "empresaId" = ${empresaId}
    ORDER BY "createdAt" DESC
    OFFSET ${MAX_RASCUNHOS}
  `;

  if (excedentes.length > 0) {
    await prisma.$executeRaw`
      DELETE FROM "NotaRascunho"
      WHERE "id" IN (${Prisma.join(excedentes.map((item) => item.id))})
    `;
  }
}

export async function GET(request: Request) {
  const { user, targetId, errorResponse } = await validateRequest(request);
  if (errorResponse) return errorResponse;
  if (!user || !targetId) return unauthorized();

  const contextId = request.headers.get('x-empresa-id');
  const empresaId = await getEmpresaContexto(user, contextId);
  if (!empresaId) return forbidden();

  const rascunhos = await prisma.$queryRaw<any[]>`
    SELECT *
    FROM "NotaRascunho"
    WHERE "userId" = ${targetId} AND "empresaId" = ${empresaId}
    ORDER BY "createdAt" DESC
    LIMIT ${MAX_RASCUNHOS}
  `;

  return NextResponse.json({
    data: rascunhos.map((item: any) => ({
      ...item,
      payload: parsePayload(item.payloadJson),
      payloadJson: undefined,
    })),
  });
}

export async function POST(request: Request) {
  const { user, targetId, errorResponse } = await validateRequest(request);
  if (errorResponse) return errorResponse;
  if (!user || !targetId) return unauthorized();

  const contextId = request.headers.get('x-empresa-id');
  const empresaId = await getEmpresaContexto(user, contextId);
  if (!empresaId) return forbidden();

  const body = await request.json();
  const payload = body?.payload || {};
  const motivo = String(body?.motivo || 'Falha corrigivel na emissao.');
  const motivoTipo = String(body?.motivoTipo || 'RETORNO_CORRIGIVEL');

  if (!payload?.nfData?.clienteId) {
    return NextResponse.json({ error: 'Rascunho sem tomador.' }, { status: 400 });
  }

  const id = crypto.randomUUID();
  const payloadJson = JSON.stringify(payload);
  const [rascunho] = await prisma.$queryRaw<any[]>`
    INSERT INTO "NotaRascunho" (
      "id", "userId", "empresaId", "clienteId", "motivo", "motivoTipo", "payloadJson", "createdAt", "updatedAt"
    )
    VALUES (
      ${id}, ${targetId}, ${empresaId}, ${payload.nfData.clienteId}, ${motivo}, ${motivoTipo}, ${payloadJson}, NOW(), NOW()
    )
    RETURNING *
  `;

  await enforceLimit(targetId, empresaId);

  return NextResponse.json({
    success: true,
    data: {
      ...rascunho,
      payload: parsePayload(rascunho.payloadJson),
      payloadJson: undefined,
    },
  }, { status: 201 });
}

export async function DELETE(request: Request) {
  const { user, targetId, errorResponse } = await validateRequest(request);
  if (errorResponse) return errorResponse;
  if (!user || !targetId) return unauthorized();

  const contextId = request.headers.get('x-empresa-id');
  const empresaId = await getEmpresaContexto(user, contextId);
  if (!empresaId) return forbidden();

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Rascunho nao informado.' }, { status: 400 });

  await prisma.$executeRaw`
    DELETE FROM "NotaRascunho"
    WHERE "id" = ${id} AND "userId" = ${targetId} AND "empresaId" = ${empresaId}
  `;

  return NextResponse.json({ success: true });
}
