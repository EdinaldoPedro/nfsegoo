import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { getAuthenticatedUser, unauthorized } from '@/app/utils/api-middleware';

const prisma = new PrismaClient();

function audienceForRole(role: string) {
  if (role === 'CONTADOR') return ['TODOS', 'CONTADORES'];
  return ['TODOS', 'CLIENTES'];
}

export async function GET(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return unauthorized();

  const now = new Date();

  const notices = await prisma.globalNotice.findMany({
    where: {
      status: 'ATIVO',
      publico: { in: audienceForRole(user.role) },
      OR: [{ iniciaEm: null }, { iniciaEm: { lte: now } }],
      AND: [{ OR: [{ terminaEm: null }, { terminaEm: { gte: now } }] }],
    },
    orderBy: [{ tipo: 'desc' }, { createdAt: 'desc' }],
    take: 10,
    select: {
      id: true,
      titulo: true,
      mensagem: true,
      tipo: true,
      publico: true,
      linkLabel: true,
      linkHref: true,
      anexoNome: true,
      anexoBase64: true,
      terminaEm: true,
      createdAt: true,
    },
  });

  return NextResponse.json(notices.map((notice) => ({
    id: notice.id,
    title: notice.titulo,
    description: notice.mensagem,
    tone:
      notice.tipo === 'CRITICAL'
        ? 'red'
        : notice.tipo === 'WARNING'
          ? 'amber'
          : notice.tipo === 'SUCCESS'
            ? 'emerald'
            : 'blue',
    action: notice.linkLabel || (notice.anexoNome ? 'Ver anexo' : 'Ver aviso'),
    href: notice.linkHref || '#',
    attachmentName: notice.anexoNome,
    attachmentBase64: notice.anexoBase64,
    expiresAt: notice.terminaEm,
    createdAt: notice.createdAt,
  })));
}
