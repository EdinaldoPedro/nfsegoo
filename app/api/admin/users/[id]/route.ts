import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { getAuthenticatedUser, forbidden } from '@/app/utils/api-middleware';
import { stripUserSecrets } from '@/app/utils/safe-data';
import { marcarEmpresasProprietariasDoContador } from '@/app/services/contadorOwnershipService';
import { aplicarPlanoContadorCustom, ativarPlanoContadorPadrao } from '@/app/services/contadorPlanService';
import { createLog } from '@/app/services/logger';

const prisma = new PrismaClient();

export async function GET(request: Request, { params }: { params: { id: string } }) {
  const admin = await getAuthenticatedUser(request);
  if (!admin || !['MASTER', 'ADMIN'].includes(admin.role)) return forbidden();

  try {
    const user = await prisma.user.findUnique({
      where: { id: params.id },
      include: {
        empresa: true,
        empresasContabeis: {
          include: { empresa: true },
        },
        empresasProprietarias: true,
        historicoPlanos: {
          include: { plan: true },
          orderBy: { createdAt: 'desc' },
          take: 5,
        },
      },
    });

    if (!user) return NextResponse.json({ error: 'Usuario nao encontrado' }, { status: 404 });

    const { historicoPlanos, ...safeUser } = user;
    return NextResponse.json({ ...stripUserSecrets(safeUser), planHistories: historicoPlanos });
  } catch (error) {
    return NextResponse.json({ error: 'Erro ao buscar' }, { status: 500 });
  }
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const admin = await getAuthenticatedUser(request);
  if (!admin || !['MASTER', 'ADMIN'].includes(admin.role)) return forbidden();

  try {
    const body = await request.json();
    const {
      limiteEmpresas,
      role,
      limiteNotas,
      limiteClientes,
      assinaturaAtiva,
      renovacaoAutomatica,
      aplicarPlanoPadrao,
      addEmpresaProprietaria,
      removeEmpresaProprietariaId,
    } = body;

    const userAtual = await prisma.user.findUnique({ where: { id: params.id } });
    if (!userAtual) return NextResponse.json({ error: 'Usuario nao encontrado' }, { status: 404 });

    if (addEmpresaProprietaria) {
      const cnpjLimpo = String(addEmpresaProprietaria.documento || '').replace(/\D/g, '');
      if (cnpjLimpo.length !== 14) return NextResponse.json({ error: 'CNPJ invalido.' }, { status: 400 });

      const empresaExistente = await prisma.empresa.findUnique({ where: { documento: cnpjLimpo } });
      const proprietarioAtual = empresaExistente ? (empresaExistente as any).proprietarioUserId : null;

      if (proprietarioAtual && proprietarioAtual !== params.id) {
        return NextResponse.json({ error: 'Esta empresa ja possui outro proprietario.' }, { status: 409 });
      }

      const empresa = empresaExistente
        ? await prisma.empresa.update({
            where: { id: empresaExistente.id },
            data: {
              proprietarioUserId: params.id,
              contadorCustodianteId: params.id,
              statusPropriedade: 'PROPRIETARIA',
              donoFaturamentoId: (empresaExistente as any).donoFaturamentoId || params.id,
            } as any,
          })
        : await prisma.empresa.create({
            data: {
              documento: cnpjLimpo,
              razaoSocial: addEmpresaProprietaria.razaoSocial || `Empresa ${cnpjLimpo}`,
              proprietarioUserId: params.id,
              contadorCustodianteId: params.id,
              donoFaturamentoId: params.id,
              statusPropriedade: 'PROPRIETARIA',
            } as any,
          });

      await prisma.contadorVinculo.upsert({
        where: { contadorId_empresaId: { contadorId: params.id, empresaId: empresa.id } },
        create: { contadorId: params.id, empresaId: empresa.id, status: 'APROVADO' } as any,
        update: {
          status: 'APROVADO',
          arquivadoEm: null,
          arquivadoPor: null,
          motivoArquivamento: null,
        } as any,
      });

      await createLog({
        level: 'INFO',
        action: 'EMPRESA_PROPRIETARIA_MARCADA',
        module: 'VINCULOS',
        userId: admin.id,
        empresaId: empresa.id,
        message: 'Empresa marcada como proprietaria de contador pelo administrativo.',
        details: {
          contadorId: params.id,
          documento: cnpjLimpo,
          razaoSocial: empresa.razaoSocial,
          empresaExistente: !!empresaExistente,
        },
      });

      return NextResponse.json({ success: true, empresa });
    }

    if (removeEmpresaProprietariaId) {
      const empresaAntes = await prisma.empresa.findFirst({
        where: { id: removeEmpresaProprietariaId, proprietarioUserId: params.id } as any,
        select: { id: true, documento: true, razaoSocial: true },
      });

      await prisma.empresa.updateMany({
        where: { id: removeEmpresaProprietariaId, proprietarioUserId: params.id } as any,
        data: { proprietarioUserId: null } as any,
      });

      await createLog({
        level: 'ALERTA',
        action: 'EMPRESA_PROPRIETARIA_REMOVIDA',
        module: 'VINCULOS',
        userId: admin.id,
        empresaId: removeEmpresaProprietariaId,
        message: 'Empresa deixou de ser proprietaria de contador pelo administrativo.',
        details: {
          contadorId: params.id,
          empresa: empresaAntes,
        },
      });

      return NextResponse.json({ success: true });
    }

    const data: Record<string, unknown> = {};
    if (role) data.role = role;
    if (limiteEmpresas !== undefined) data.limiteEmpresas = parseInt(limiteEmpresas, 10);

    const updated = await prisma.user.update({
      where: { id: params.id },
      data,
    });

    if (limiteEmpresas !== undefined && Number(limiteEmpresas) !== userAtual.limiteEmpresas) {
      await createLog({
        level: 'INFO',
        action: 'LIMITE_EMPRESAS_CONTADOR_ATUALIZADO',
        module: 'PLANOS',
        userId: admin.id,
        message: 'Limite de empresas do contador atualizado pelo administrativo.',
        details: {
          targetUserId: updated.id,
          limiteAnterior: userAtual.limiteEmpresas,
          limiteNovo: parseInt(limiteEmpresas, 10),
        },
      });
    }

    if (role === 'CONTADOR' && (userAtual.role !== 'CONTADOR' || aplicarPlanoPadrao)) {
      await marcarEmpresasProprietariasDoContador(updated.id);
      const { plano } = await ativarPlanoContadorPadrao(updated.id, 'ANUAL');

      await createLog({
        level: 'INFO',
        action: aplicarPlanoPadrao ? 'PLANO_CONTADOR_PADRAO_APLICADO' : 'CONTA_PROMOVIDA_CONTADOR',
        module: 'PLANOS',
        userId: admin.id,
        message: aplicarPlanoPadrao
          ? 'Plano padrao de contador aplicado pela edicao administrativa.'
          : 'Conta promovida para contador pela edicao administrativa.',
        details: { targetUserId: updated.id, planSlug: plano.slug },
      });
    }

    if (
      role === 'CONTADOR' &&
      (limiteNotas !== undefined ||
        limiteClientes !== undefined ||
        assinaturaAtiva !== undefined ||
        renovacaoAutomatica !== undefined)
    ) {
      const planoCustom = await aplicarPlanoContadorCustom({
        userId: updated.id,
        limiteNotas: limiteNotas !== undefined ? parseInt(limiteNotas, 10) : undefined,
        limiteClientes: limiteClientes !== undefined ? parseInt(limiteClientes, 10) : undefined,
        assinaturaAtiva: assinaturaAtiva !== false,
        renovacaoAutomatica: !!renovacaoAutomatica,
      });

      await createLog({
        level: 'INFO',
        action: 'PLANO_CONTADOR_CUSTOM_ATUALIZADO',
        module: 'PLANOS',
        userId: admin.id,
        message: 'Plano individual do contador atualizado pelo administrativo.',
        details: {
          targetUserId: updated.id,
          planSlug: planoCustom.plano.slug,
          limiteNotas: planoCustom.plano.maxNotasMensal,
          limiteClientes: planoCustom.plano.maxClientes,
          assinaturaAtiva: planoCustom.assinaturaAtiva,
          renovacaoAutomatica: !!renovacaoAutomatica,
        },
      });

      const userAtualizado = await prisma.user.findUnique({ where: { id: updated.id } });
      return NextResponse.json(stripUserSecrets(userAtualizado));
    }

    return NextResponse.json(stripUserSecrets(updated));
  } catch (error) {
    console.error('Erro no PATCH:', error);
    return NextResponse.json({ error: 'Erro ao atualizar' }, { status: 500 });
  }
}

export async function PUT(request: Request, { params }: { params: { id: string } }) {
  const admin = await getAuthenticatedUser(request);
  if (!admin || !['MASTER', 'ADMIN'].includes(admin.role)) return forbidden();

  try {
    const body = await request.json();

    const dataToUpdate: Record<string, unknown> = {};
    if (body.nome !== undefined) dataToUpdate.nome = body.nome;
    if (body.email !== undefined) dataToUpdate.email = body.email;
    if (body.status !== undefined) dataToUpdate.status = body.status;
    if (body.role !== undefined) dataToUpdate.role = body.role;

    if (body.plano) {
      const plan = await prisma.plan.findFirst({
        where: { OR: [{ id: body.plano }, { slug: body.plano }] },
      });

      if (plan) {
        dataToUpdate.plano = plan.slug;

        const historyExistente = await prisma.planHistory.findFirst({
          where: { userId: params.id, planId: plan.id, status: 'ATIVO' },
        });

        if (!historyExistente) {
          if (plan.tipo === 'PLANO') {
            const historicosAntigos = await prisma.planHistory.findMany({
              where: { userId: params.id, status: 'ATIVO' },
              include: { plan: true },
            });

            await Promise.all(
              historicosAntigos
                .filter((hist) => hist.plan?.tipo === 'PLANO')
                .map((hist) =>
                  prisma.planHistory.update({
                    where: { id: hist.id },
                    data: { status: 'CANCELADO' },
                  }),
                ),
            );
          }

          const dataFim = new Date();
          dataFim.setMonth(dataFim.getMonth() + 1);

          await prisma.planHistory.create({
            data: {
              userId: params.id,
              planId: plan.id,
              status: 'ATIVO',
              dataInicio: new Date(),
              dataFim,
              notasEmitidas: 0,
            },
          });

          dataToUpdate.planoStatus = 'active';
        }
      } else {
        dataToUpdate.plano = body.plano;
      }
    }

    const updatedUser = await prisma.user.update({
      where: { id: params.id },
      data: dataToUpdate,
    });

    return NextResponse.json(stripUserSecrets(updatedUser));
  } catch (error) {
    console.error('Erro no PUT User:', error);
    return NextResponse.json({ error: 'Erro ao atualizar' }, { status: 500 });
  }
}
