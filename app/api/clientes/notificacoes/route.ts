import { withApiGuard } from '@/app/utils/api-route';
import { NextResponse } from 'next/server';
import { prisma } from '@/app/utils/prisma';
import { validateRequest } from '@/app/utils/api-security';


export const GET = withApiGuard(async function GET(request: Request) {
  // SEGURANÇA
  const { targetId, errorResponse } = await validateRequest(request);
  if (errorResponse) return errorResponse; // Se falhar, retorna erro (não 0)

  try {
    const count = await prisma.ticket.count({
      where: {
        solicitanteId: targetId,
        clientUnread: true
      }
    });
    return NextResponse.json({ count });
  } catch (error) {
    return NextResponse.json({ count: 0 });
  }
});
