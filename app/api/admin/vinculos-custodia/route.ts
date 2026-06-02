import { NextResponse } from 'next/server';
import { prisma } from '@/app/utils/prisma';
import { getAuthenticatedUser, forbidden, unauthorized } from '@/app/utils/api-middleware';
import { createLog } from '@/app/services/logger';
import { stripEmpresaSecrets } from '@/app/utils/safe-data';

const ADMIN_ROLES = ['MASTER', 'ADMIN'];

export async function GET(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return unauthorized();
  if (!ADMIN_ROLES.includes(user.role)) return forbidden();

  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status') || 'PENDENTE_CUSTODIANTE';

  try {
    const vinculos = await prisma.contadorVinculo.findMany({
      where: {
        status,
        arquivadoEm: null,
      } as any,
      include: {
        contador: { select: { id: true, nome: true, email: true, telefone: true, role: true } },
        empresa: {
          include: {
            contadorCustodiante: { select: { id: true, nome: true, email: true, telefone: true, role: true } },
            donoUser: { select: { id: true, nome: true, email: true, telefone: true, role: true } },
          } as any,
        },
      },
      orderBy: { updatedAt: 'asc' },
    });

    return NextResponse.json({
      data: vinculos.map((vinculo: any) => ({
        ...vinculo,
        empresa: stripEmpresaSecrets(vinculo.empresa),
      })),
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Erro ao buscar vinculos.' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return unauthorized();
  if (!ADMIN_ROLES.includes(user.role)) return forbidden();

  try {
    const { vinculoId, acao, observacao } = await request.json();
    if (!vinculoId || !['LIBERAR', 'NEGAR'].includes(acao)) {
      return NextResponse.json({ error: 'Acao invalida.' }, { status: 400 });
    }

    const vinculo = await prisma.contadorVinculo.findUnique({
      where: { id: vinculoId },
      include: {
        contador: { select: { id: true, nome: true, email: true } },
        empresa: {
          select: {
            id: true,
            razaoSocial: true,
            documento: true,
            contadorCustodianteId: true,
            donoFaturamentoId: true,
          } as any,
        },
      },
    });

    if (!vinculo || vinculo.status !== 'PENDENTE_CUSTODIANTE' || (vinculo as any).arquivadoEm) {
      return NextResponse.json({ error: 'Solicitacao nao encontrada ou ja resolvida.' }, { status: 404 });
    }

    if (acao === 'NEGAR') {
      await prisma.contadorVinculo.update({
        where: { id: vinculoId },
        data: {
          status: 'REJEITADO',
          arquivadoEm: new Date(),
          arquivadoPor: user.id,
          motivoArquivamento: observacao || 'Solicitacao negada pela bancada interna.',
        } as any,
      });

      await createLog({
        level: 'INFO',
        action: 'VINCULO_CUSTODIA_NEGADO',
        message: `Vinculo de contador negado pela bancada interna para ${(vinculo as any).empresa.razaoSocial}.`,
        empresaId: vinculo.empresaId,
        details: { vinculoId, contadorSolicitanteId: vinculo.contadorId, observacao, adminId: user.id },
      });

      return NextResponse.json({ success: true, message: 'Solicitacao negada.' });
    }

    const empresa = (vinculo as any).empresa;
    const custodianteAnteriorId = empresa.contadorCustodianteId as string | null;
    const trocarCobranca = !empresa.donoFaturamentoId || empresa.donoFaturamentoId === custodianteAnteriorId;

    await prisma.$transaction([
      prisma.contadorVinculo.updateMany({
        where: {
          empresaId: vinculo.empresaId,
          contadorId: { not: vinculo.contadorId },
          status: 'APROVADO',
          arquivadoEm: null,
        } as any,
        data: {
          status: 'DESVINCULADO',
          arquivadoEm: new Date(),
          arquivadoPor: user.id,
          motivoArquivamento: 'Custodia transferida pela bancada interna.',
        } as any,
      }),
      prisma.contadorVinculo.update({
        where: { id: vinculoId },
        data: {
          status: 'APROVADO',
          arquivadoEm: null,
          arquivadoPor: null,
          motivoArquivamento: null,
        } as any,
      }),
      prisma.empresa.update({
        where: { id: vinculo.empresaId },
        data: {
          contadorCustodianteId: vinculo.contadorId,
          statusPropriedade: 'CUSTODIADA',
          ...(trocarCobranca ? { donoFaturamentoId: vinculo.contadorId } : {}),
        } as any,
      }),
    ]);

    await createLog({
      level: 'INFO',
      action: 'VINCULO_CUSTODIA_LIBERADO',
      message: `Custodia transferida para ${vinculo.contador.nome || vinculo.contador.email}.`,
      empresaId: vinculo.empresaId,
      details: {
        vinculoId,
        empresaId: vinculo.empresaId,
        contadorSolicitanteId: vinculo.contadorId,
        custodianteAnteriorId,
        observacao,
        adminId: user.id,
      },
    });

    return NextResponse.json({ success: true, message: 'Vinculo liberado e custodia transferida.' });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Erro ao resolver solicitacao.' }, { status: 500 });
  }
}
