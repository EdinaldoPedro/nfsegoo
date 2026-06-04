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
  const { searchParams } = new URL(request.url);

  const page = parseInt(searchParams.get('page') || '0');
  const limit = parseInt(searchParams.get('limit') || '0');

  const search = searchParams.get('search') || '';
  const regime = searchParams.get('regime') || '';
  const uf = searchParams.get('uf') || '';
  const status = searchParams.get('status');

  try {
    const where: any = {};

    if (search) {
      where.OR = [
        { nome: { contains: search } },
        { uf: { contains: search.toUpperCase() } },
      ];
    }
    if (regime) where.regime = regime;
    if (uf) where.uf = uf;
    if (status && status !== '') where.status = parseInt(status);

    if (page > 0 && limit > 0) {
      const authError = await ensureSupport(request);
      if (authError) return authError;

      const skip = (page - 1) * limit;
      const [lista, total, todosMunicipios] = await prisma.$transaction([
        prisma.municipioHomologado.findMany({
          where,
          skip,
          take: limit,
          orderBy: [{ uf: 'asc' }, { nome: 'asc' }],
        }),
        prisma.municipioHomologado.count({ where }),
        prisma.municipioHomologado.findMany({
          select: { uf: true, regime: true, status: true },
          orderBy: [{ uf: 'asc' }, { nome: 'asc' }],
        }),
      ]);

      const ufs = Array.from(new Set(todosMunicipios.map((item) => item.uf).filter(Boolean))).sort();
      const regimes = Array.from(new Set(todosMunicipios.map((item) => item.regime).filter(Boolean))).sort();
      const statusCounts = todosMunicipios.reduce((acc: Record<string, number>, item) => {
        const key = String(item.status);
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {});

      return NextResponse.json({
        data: lista,
        meta: {
          total,
          totalGeral: todosMunicipios.length,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
          ufs,
          regimes,
          statusCounts,
        },
      });
    }

    const lista = await prisma.municipioHomologado.findMany({
      where,
      orderBy: [{ uf: 'asc' }, { nome: 'asc' }],
    });
    return NextResponse.json(lista);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Erro ao buscar cidades.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const authError = await ensureSupport(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    const { uf, nome, status, regime } = body;

    const novo = await prisma.municipioHomologado.create({
      data: {
        uf: uf.toUpperCase(),
        nome,
        status: parseInt(status),
        regime,
      },
    });

    return NextResponse.json(novo, { status: 201 });
  } catch {
    return NextResponse.json({ error: 'Erro ao criar.' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const authError = await ensureSupport(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    const { id, uf, nome, status, regime } = body;

    if (!id) return NextResponse.json({ error: 'ID obrigatÃ³rio.' }, { status: 400 });

    const atualizado = await prisma.municipioHomologado.update({
      where: { id },
      data: {
        uf: uf.toUpperCase(),
        nome,
        status: parseInt(status),
        regime,
      },
    });

    return NextResponse.json(atualizado, { status: 200 });
  } catch {
    return NextResponse.json({ error: 'Erro ao atualizar.' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const authError = await ensureSupport(request);
  if (authError) return authError;

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id) return NextResponse.json({ error: 'ID necessario' }, { status: 400 });

  await prisma.municipioHomologado.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
