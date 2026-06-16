import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { getAuthenticatedUser, forbidden, unauthorized } from '@/app/utils/api-middleware';
import { registrarEventoCrm } from '@/app/services/crmService';
import { prisma } from '@/app/utils/prisma';
import { stripUserSecrets } from '@/app/utils/safe-data';
import { marcarEmpresasProprietariasDoContador } from '@/app/services/contadorOwnershipService';
import { EmailService } from '@/app/services/EmailService';
import { parsePedidoMetadata } from '@/app/utils/manual-contracting';
import { ativarPlanoContadorPadrao } from '@/app/services/contadorPlanService';
import { createLog } from '@/app/services/logger';

const STAFF_ROLES = ['MASTER', 'ADMIN', 'SUPORTE', 'SUPORTE_TI'];

export async function GET(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return unauthorized();
  if (!STAFF_ROLES.includes(user.role)) return forbidden();

  const users = await prisma.user.findMany({
    include: {
      empresa: true,
      historicoPlanos: { where: { status: 'ATIVO' }, include: { plan: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  const safeUsers = users.map((u) => {
    const { historicoPlanos, ...rest } = u;
    return { ...stripUserSecrets(rest), planHistories: historicoPlanos };
  });

  return NextResponse.json(safeUsers);
}

async function assertAdminPassword(params: {
  adminId: string;
  adminPassword?: string;
  justification?: string;
}) {
  if (!params.adminPassword || !params.justification) {
    return NextResponse.json({ error: 'Senha e justificativa sao obrigatorias.' }, { status: 400 });
  }

  const adminDb = await prisma.user.findUnique({ where: { id: params.adminId } });
  if (!adminDb) return unauthorized();

  const senhaValida = await bcrypt.compare(params.adminPassword, adminDb.senha);
  if (!senhaValida) return NextResponse.json({ error: 'Senha incorreta.' }, { status: 403 });

  return null;
}

export async function PUT(request: Request) {
  const userAuth = await getAuthenticatedUser(request);
  if (!userAuth) return unauthorized();
  if (!['MASTER', 'ADMIN'].includes(userAuth.role)) return forbidden();

  try {
    const body = await request.json();

    if (!body.id) {
      return NextResponse.json({ error: 'Usuario nao informado.' }, { status: 400 });
    }

    if (body.plano) {
      const errorResponse = await assertAdminPassword({
        adminId: userAuth.id,
        adminPassword: body.adminPassword,
        justification: body.justification,
      });
      if (errorResponse) return errorResponse;
    }

    if (body.resetEmail) {
      const tempPlaceholder = `reset_${Date.now()}_${String(body.id).substring(0, 5)}@sistema.temp`;
      await prisma.user.update({ where: { id: body.id }, data: { email: tempPlaceholder } });

      await registrarEventoCrm(body.id, 'SISTEMA', 'E-mail resetado', 'O admin resetou o e-mail de acesso.');
      await createLog({
        level: 'ALERTA',
        action: 'USER_EMAIL_RESET_BY_ADMIN',
        module: 'USUARIOS',
        userId: userAuth.id,
        message: 'E-mail de usuario resetado pelo administrativo.',
        details: { targetUserId: body.id },
      });

      return NextResponse.json({ success: true, message: 'E-mail resetado.' });
    }

    if (body.unlinkCompany) {
      await prisma.user.update({ where: { id: body.id }, data: { empresaId: null } });

      await registrarEventoCrm(body.id, 'SISTEMA', 'Empresa desvinculada', 'A empresa foi desvinculada manualmente.');
      await createLog({
        level: 'ALERTA',
        action: 'USER_PRIMARY_COMPANY_UNLINKED',
        module: 'USUARIOS',
        userId: userAuth.id,
        message: 'Empresa primaria desvinculada de usuario pelo administrativo.',
        details: { targetUserId: body.id },
      });

      return NextResponse.json({ success: true, message: 'Empresa desvinculada.' });
    }

    if (body.newCnpj) {
      const cnpjLimpo = String(body.newCnpj).replace(/\D/g, '');
      if (cnpjLimpo.length !== 14) return NextResponse.json({ error: 'CNPJ invalido.' }, { status: 400 });

      const empresaExistente = await prisma.empresa.findUnique({
        where: { documento: cnpjLimpo },
        include: { donoUser: true },
      });

      if (empresaExistente) {
        if (empresaExistente.donoUser && empresaExistente.donoUser.id !== body.id) {
          return NextResponse.json({ error: `CNPJ pertence a ${empresaExistente.donoUser.nome}.` }, { status: 409 });
        }

        await prisma.user.update({ where: { id: body.id }, data: { empresaId: empresaExistente.id } });
        await registrarEventoCrm(body.id, 'SISTEMA', 'Novo vinculo PJ', `O cliente foi vinculado ao CNPJ ${cnpjLimpo}.`);
        await createLog({
          level: 'INFO',
          action: 'USER_COMPANY_LINKED_BY_ADMIN',
          module: 'USUARIOS',
          userId: userAuth.id,
          empresaId: empresaExistente.id,
          message: 'Usuario vinculado a empresa existente pelo administrativo.',
          details: { targetUserId: body.id, documento: cnpjLimpo },
        });

        return NextResponse.json({ success: true, message: 'Usuario vinculado.' });
      }

      if (body.empresaId) {
        await prisma.empresa.update({ where: { id: body.empresaId }, data: { documento: cnpjLimpo } });
        await createLog({
          level: 'ALERTA',
          action: 'COMPANY_DOCUMENT_UPDATED_BY_ADMIN',
          module: 'USUARIOS',
          userId: userAuth.id,
          empresaId: body.empresaId,
          message: 'CNPJ de empresa atualizado pelo administrativo.',
          details: { targetUserId: body.id, documento: cnpjLimpo },
        });

        return NextResponse.json({ success: true, message: 'CNPJ atualizado.' });
      }

      return NextResponse.json({ error: 'Empresa nao encontrada.' }, { status: 400 });
    }

    if (body.plano) {
      const userAlvo = await prisma.user.findUnique({ where: { id: body.id } });
      await createLog({
        level: 'ALERTA',
        action: 'MANUAL_PLAN_CHANGE',
        module: 'PLANOS',
        userId: userAuth.id,
        message: `Alteracao manual de plano para: ${userAlvo?.email || userAlvo?.nome || body.id}`,
        details: {
          targetUserId: body.id,
          newPlan: body.plano,
          planCycle: body.planoCiclo,
          justification: body.justification,
        },
      });

      if (body.plano === 'SUSPENDED') {
        await prisma.planHistory.updateMany({
          where: { userId: body.id, status: 'ATIVO' },
          data: { status: 'CANCELADO_ADM', dataFim: new Date() },
        });
        await prisma.user.update({
          where: { id: body.id },
          data: { plano: 'SEM_PLANO', planoStatus: 'suspended', planoExpiresAt: new Date() },
        });

        await registrarEventoCrm(body.id, 'FINANCEIRO', 'Plano suspenso', `Justificativa do admin: ${body.justification}`);
        return NextResponse.json({ success: true, message: 'Acesso suspenso.' });
      }

      const novoPlano = await prisma.plan.findUnique({ where: { slug: body.plano } });
      if (!novoPlano) return NextResponse.json({ error: 'Plano nao encontrado.' }, { status: 404 });

      if (novoPlano.tipo === 'PLANO') {
        const dataFimFinal =
          body.planoCiclo === 'ANUAL'
            ? new Date(new Date().setFullYear(new Date().getFullYear() + 1))
            : new Date(new Date().setDate(new Date().getDate() + 30));

        const historicosAtivos = await prisma.planHistory.findMany({
          where: { userId: body.id, status: 'ATIVO' },
          include: { plan: true },
        });

        await Promise.all(
          historicosAtivos
            .filter((hist) => hist.plan.tipo === 'PLANO' || hist.plan.tipo === 'CUSTOM')
            .map((hist) =>
              prisma.planHistory.update({
                where: { id: hist.id },
                data: { status: 'FINALIZADO', dataFim: new Date() },
              }),
            ),
        );

        await prisma.planHistory.create({
          data: {
            userId: body.id,
            planId: novoPlano.id,
            status: 'ATIVO',
            dataInicio: new Date(),
            dataFim: dataFimFinal,
            notasEmitidas: 0,
          },
        });

        await prisma.user.update({
          where: { id: body.id },
          data: {
            plano: novoPlano.slug,
            planoStatus: 'active',
            planoExpiresAt: dataFimFinal,
            planoCiclo: body.planoCiclo || 'MENSAL',
          },
        });

        await registrarEventoCrm(
          body.id,
          'FINANCEIRO',
          'Plano alterado',
          `Mudou para o plano ${novoPlano.name}. Justificativa: ${body.justification}`,
        );

        if (body.pedidoId) {
          const pedido = await prisma.pedido.findUnique({
            where: { id: body.pedidoId },
            include: { user: true },
          });

          if (pedido && pedido.userId === body.id) {
            const detalhes = parsePedidoMetadata(pedido.gatewayId);
            await prisma.pedido.update({
              where: { id: pedido.id },
              data: {
                status: 'ATIVADO_MANUALMENTE',
                gatewayId: JSON.stringify({
                  ...detalhes,
                  ativadoPor: userAuth.id,
                  ativadoEm: new Date().toISOString(),
                  justificativaAtivacao: body.justification,
                }),
              },
            });

            await createLog({
              level: 'INFO',
              action: 'PEDIDO_CONTRATACAO_ATIVADO',
              module: 'FINANCEIRO',
              userId: userAuth.id,
              message: `Pedido de contratacao ${pedido.id} ativado junto com plano.`,
              details: {
                pedidoId: pedido.id,
                targetUserId: body.id,
                plan: novoPlano.slug,
              },
            });

            const emailService = new EmailService();
            await emailService.sendEmail(
              pedido.user.email,
              'Seu plano foi ativado',
              emailService.getTemplateContratacaoManual({
                nome: pedido.user.nome,
                titulo: 'Seu plano foi ativado',
                mensagem: 'A contratacao foi conferida e seu acesso ja foi liberado na plataforma.',
                pedidoId: pedido.id,
                ticketProtocolo: detalhes.ticketProtocolo,
                plano: novoPlano.name,
                link: process.env.NEXT_PUBLIC_APP_URL
                  ? `${process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, '')}/cliente/dashboard`
                  : '/cliente/dashboard',
              }),
            );
          }
        }

        return NextResponse.json({ success: true, message: 'Plano atualizado.' });
      }

      await prisma.planHistory.create({
        data: {
          userId: body.id,
          planId: novoPlano.id,
          status: 'ATIVO',
          dataInicio: new Date(),
          dataFim: null,
          notasEmitidas: 0,
        },
      });

      if (novoPlano.tipo === 'PACOTE_PJ') {
        await prisma.user.update({
          where: { id: body.id },
          data: { empresasAdicionais: { increment: 1 } },
        });
      }

      await registrarEventoCrm(
        body.id,
        'FINANCEIRO',
        'Pacote manual adicionado',
        `Pacote ${novoPlano.name} liberado manualmente. Justificativa: ${body.justification}`,
      );
      await createLog({
        level: 'INFO',
        action: 'PACOTE_MANUAL_ADICIONADO',
        module: 'PLANOS',
        userId: userAuth.id,
        message: 'Pacote manual adicionado ao usuario.',
        details: {
          targetUserId: body.id,
          planSlug: novoPlano.slug,
          planType: novoPlano.tipo,
          justification: body.justification,
        },
      });

      return NextResponse.json({ success: true, message: 'Pacote adicionado com sucesso.' });
    }

    const dataToUpdate: Record<string, unknown> = {};
    if (body.role) {
      dataToUpdate.role = body.role;

      if (body.role === 'CONTADOR') {
        const { plano } = await ativarPlanoContadorPadrao(body.id, 'ANUAL');
        dataToUpdate.plano = plano.slug;
        dataToUpdate.planoStatus = 'active';
        dataToUpdate.planoCiclo = 'ANUAL';

        await createLog({
          level: 'INFO',
          action: 'CONTA_PROMOVIDA_CONTADOR',
          module: 'PLANOS',
          userId: userAuth.id,
          message: 'Conta promovida para contador com plano padrao privado.',
          details: { targetUserId: body.id, planSlug: plano.slug },
        });
        await registrarEventoCrm(body.id, 'SISTEMA', 'Conta promovida a contador', 'O usuario agora e um contador parceiro.');
      }
    }

    if (Object.keys(dataToUpdate).length > 0) {
      await prisma.user.update({ where: { id: body.id }, data: dataToUpdate });
      if (body.role === 'CONTADOR') {
        await marcarEmpresasProprietariasDoContador(body.id);
      }
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
