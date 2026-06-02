import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { getAuthenticatedUser, forbidden, unauthorized } from '@/app/utils/api-middleware';
import { registrarEventoCrm } from '@/app/services/crmService';
import { prisma } from '@/app/utils/prisma';
import { stripUserSecrets } from '@/app/utils/safe-data';
import { marcarEmpresasProprietariasDoContador } from '@/app/services/contadorOwnershipService';

export async function GET(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return unauthorized();
  const isStaff = ['MASTER', 'ADMIN', 'SUPORTE', 'SUPORTE_TI'].includes(user.role);
  if (!isStaff) return forbidden();

  const users = await prisma.user.findMany({
    include: {
      empresa: true,
      historicoPlanos: { where: { status: 'ATIVO' }, include: { plan: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  const safeUsers = users.map((u) => {
    // @ts-ignore
    const { historicoPlanos, ...rest } = u;
    return { ...stripUserSecrets(rest), planHistories: historicoPlanos };
  });

  return NextResponse.json(safeUsers);
}

export async function PUT(request: Request) {
  const userAuth = await getAuthenticatedUser(request);
  if (!userAuth) return unauthorized();
  if (!['MASTER', 'ADMIN'].includes(userAuth.role)) return forbidden();

  try {
    const body = await request.json();

    if (body.plano) {
      if (!body.adminPassword || !body.justification) {
        return NextResponse.json({ error: 'Senha e justificativa sÃ£o obrigatÃ³rios.' }, { status: 400 });
      }
      const adminDb = await prisma.user.findUnique({ where: { id: userAuth.id } });
      if (!adminDb) return unauthorized();

      const senhaValida = await bcrypt.compare(body.adminPassword, adminDb.senha);
      if (!senhaValida) return NextResponse.json({ error: 'Senha incorreta.' }, { status: 403 });
    }

    if (body.resetEmail) {
      const tempPlaceholder = `reset_${Date.now()}_${body.id.substring(0, 5)}@sistema.temp`;
      await prisma.user.update({ where: { id: body.id }, data: { email: tempPlaceholder } });

      await registrarEventoCrm(body.id, 'SISTEMA', 'E-mail Resetado', 'O Admin resetou o e-mail de acesso.');
      return NextResponse.json({ success: true, message: 'E-mail resetado.' });
    }

    if (body.unlinkCompany) {
      await prisma.user.update({ where: { id: body.id }, data: { empresaId: null } });
      await registrarEventoCrm(body.id, 'SISTEMA', 'Empresa Desvinculada', 'A empresa foi desvinculada manualmente.');
      return NextResponse.json({ success: true, message: 'Empresa desvinculada.' });
    }

    if (body.newCnpj) {
      const cnpjLimpo = body.newCnpj.replace(/\D/g, '');
      if (cnpjLimpo.length !== 14) return NextResponse.json({ error: 'CNPJ InvÃ¡lido' }, { status: 400 });

      const empresaExistente = await prisma.empresa.findUnique({
        where: { documento: cnpjLimpo },
        include: { donoUser: true },
      });

      if (empresaExistente) {
        if (empresaExistente.donoUser && empresaExistente.donoUser.id !== body.id) {
          return NextResponse.json({ error: `CNPJ pertence a ${empresaExistente.donoUser.nome}.` }, { status: 409 });
        }
        await prisma.user.update({ where: { id: body.id }, data: { empresaId: empresaExistente.id } });
        await registrarEventoCrm(body.id, 'SISTEMA', 'Novo VÃ­nculo PJ', `O cliente foi vinculado ao CNPJ ${cnpjLimpo}.`);
        return NextResponse.json({ success: true, message: 'UsuÃ¡rio vinculado.' });
      }

      if (body.empresaId) {
        await prisma.empresa.update({ where: { id: body.empresaId }, data: { documento: cnpjLimpo } });
        return NextResponse.json({ success: true, message: 'CNPJ atualizado.' });
      }

      return NextResponse.json({ error: 'Empresa nÃ£o encontrada.' }, { status: 400 });
    }

    if (body.plano) {
      const userAlvo = await prisma.user.findUnique({ where: { id: body.id } });
      await prisma.systemLog.create({
        data: {
          level: 'WARN',
          action: 'MANUAL_PLAN_CHANGE',
          message: `AlteraÃ§Ã£o manual de plano para: ${userAlvo?.email || userAlvo?.nome}`,
          details: JSON.stringify({
            adminId: userAuth.id,
            newPlan: body.plano,
            planCycle: body.planoCiclo,
            justification: body.justification,
          }),
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

        await registrarEventoCrm(body.id, 'FINANCEIRO', 'Plano Suspenso', `Justificativa do Admin: ${body.justification}`);
        return NextResponse.json({ success: true, message: 'Acesso suspenso.' });
      }

      const novoPlano = await prisma.plan.findUnique({ where: { slug: body.plano } });
      if (!novoPlano) return NextResponse.json({ error: 'Plano nÃ£o encontrado.' }, { status: 404 });

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
            .filter((hist) => hist.plan.tipo === 'PLANO')
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
          'Plano Alterado',
          `Mudou para o plano ${novoPlano.name}. Justificativa: ${body.justification}`,
        );
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
          data: {
            empresasAdicionais: { increment: 1 },
          },
        });
      }

      await registrarEventoCrm(
        body.id,
        'FINANCEIRO',
        'Pacote Manual Adicionado',
        `Pacote ${novoPlano.name} liberado manualmente. Justificativa: ${body.justification}`,
      );
      return NextResponse.json({ success: true, message: 'Pacote adicionado com sucesso.' });
    }

    const dataToUpdate: any = {};
    if (body.role) {
      dataToUpdate.role = body.role;

      if (body.role === 'CONTADOR') {
        const planoParceiro = await prisma.plan.findUnique({ where: { slug: 'PARCEIRO' } });
        if (planoParceiro) {
          await prisma.planHistory.updateMany({
            where: { userId: body.id, status: 'ATIVO' },
            data: { status: 'FINALIZADO', dataFim: new Date() },
          });
          await prisma.planHistory.create({
            data: { userId: body.id, planId: planoParceiro.id, status: 'ATIVO', dataInicio: new Date(), dataFim: null, notasEmitidas: 0 },
          });
          dataToUpdate.plano = 'PARCEIRO';
          dataToUpdate.planoStatus = 'active';
          dataToUpdate.planoCiclo = 'ANUAL';
        }
        await registrarEventoCrm(body.id, 'SISTEMA', 'Conta Promovida a Contador', 'O utilizador agora Ã© um Contador Parceiro.');
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
