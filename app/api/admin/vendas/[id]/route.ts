import { NextResponse } from 'next/server';
import { getAuthenticatedUser, forbidden, unauthorized } from '@/app/utils/api-middleware';
import { isSupportRole } from '@/app/utils/access-control';
import { prisma } from '@/app/utils/prisma';
import { sanitizeLogValue } from '@/app/services/logger';
import { stripEmpresaSecrets } from '@/app/utils/safe-data';

async function ensureSupport(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return unauthorized();
  if (!isSupportRole(user.role)) return forbidden();
  return null;
}

function sanitizeStoredDetails(details: string | null) {
  if (!details) return details;
  try {
    return JSON.stringify(sanitizeLogValue(JSON.parse(details)), null, 2);
  } catch {
    return sanitizeLogValue(details);
  }
}

export async function GET(request: Request, { params }: { params: { id: string } }) {
  const authError = await ensureSupport(request);
  if (authError) return authError;

  try {
    const venda = await prisma.venda.findUnique({
      where: { id: params.id },
      include: {
        empresa: true,
        cliente: true,
        notas: true,
        logs: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!venda) return NextResponse.json({ error: 'Venda nÃ£o encontrada' }, { status: 404 });

    const logsSeguros = venda.logs.map((log) => ({
      ...log,
      details: sanitizeStoredDetails(log.details),
    }));
    const logDps = logsSeguros.find((l) => l.action === 'EMISSAO_INICIADA' || l.action === 'DPS_GERADA');
    const logErro = logsSeguros.find((l) => l.level === 'ERRO' && l.details?.includes('<'));

    return NextResponse.json({
      ...venda,
      empresa: stripEmpresaSecrets(venda.empresa),
      logs: logsSeguros,
      payloadJson: logDps ? logDps.details : null,
      xmlErro: logErro ? logErro.details : null,
    });
  } catch {
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}

export async function PUT(request: Request, { params }: { params: { id: string } }) {
  const authError = await ensureSupport(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    const updated = await prisma.venda.update({
      where: { id: params.id },
      data: {
        valor: body.valor ? parseFloat(body.valor) : undefined,
        descricao: body.descricao,
      },
    });
    return NextResponse.json(updated);
  } catch {
    return NextResponse.json({ error: 'Erro ao atualizar venda.' }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  const authError = await ensureSupport(request);
  if (authError) return authError;

  try {
    const { id } = params;
    const temNotaAutorizada = await prisma.notaFiscal.findFirst({
      where: { vendaId: id, status: 'AUTORIZADA' },
    });

    if (temNotaAutorizada) {
      return NextResponse.json(
        { error: 'NÃ£o Ã© possÃ­vel excluir uma venda com Nota Autorizada. Cancele a nota primeiro.' },
        { status: 403 },
      );
    }

    await prisma.systemLog.deleteMany({ where: { vendaId: id } });
    await prisma.notaFiscal.deleteMany({ where: { vendaId: id } });
    await prisma.venda.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Erro ao excluir venda.' }, { status: 500 });
  }
}
