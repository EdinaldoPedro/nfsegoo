import { NextResponse } from 'next/server';
import { getAuthenticatedUser, forbidden, unauthorized } from '@/app/utils/api-middleware';
import { isSupportRole } from '@/app/utils/access-control';
import { prisma } from '@/app/utils/prisma';

async function ensureSupport(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return unauthorized();
  if (!isSupportRole(user.role)) return forbidden();
  return null;
}

export async function GET(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return unauthorized();

  try {
    const itens = await prisma.ticketCatalog.findMany({
      where: isSupportRole(user.role) ? {} : { ativo: true },
      orderBy: { titulo: 'asc' },
    });
    return NextResponse.json(itens);
  } catch (e: any) {
    return NextResponse.json({ error: `Erro ao buscar: ${e.message}` }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const authError = await ensureSupport(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    if (!body.titulo) return NextResponse.json({ error: 'TÃ­tulo obrigatÃ³rio' }, { status: 400 });

    const novo = await prisma.ticketCatalog.create({
      data: {
        titulo: body.titulo,
        prioridade: body.prioridade || 'MEDIA',
        instrucoes: body.instrucoes,
        ativo: body.ativo !== undefined ? body.ativo : true,
      },
    });
    return NextResponse.json(novo, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: `Erro ao criar: ${e.message}` }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const authError = await ensureSupport(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    const atualizado = await prisma.ticketCatalog.update({
      where: { id: body.id },
      data: {
        titulo: body.titulo,
        prioridade: body.prioridade,
        instrucoes: body.instrucoes,
        ativo: body.ativo,
      },
    });
    return NextResponse.json(atualizado);
  } catch {
    return NextResponse.json({ error: 'Erro ao atualizar' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const authError = await ensureSupport(request);
  if (authError) return authError;

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'ID necessÃ¡rio' }, { status: 400 });

  try {
    await prisma.ticketCatalog.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'Item em uso.' }, { status: 500 });
  }
}
