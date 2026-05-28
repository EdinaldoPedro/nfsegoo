import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { NfsePortalInscricaoClient } from '@/app/services/portal/NfsePortalInscricaoClient';
import { validateRequest } from '@/app/utils/api-security';
import { validarCPF } from '@/app/utils/cpf';

const prisma = new PrismaClient();

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

    const empresaAdicional = await prisma.empresa.findFirst({
      where: { id: contextId, donoFaturamentoId: user.id, arquivadoEm: null } as any,
    });
    if (empresaAdicional) return contextId;

    return null;
  }

  return user.empresaId;
}

export async function POST(request: Request) {
  const { targetId, errorResponse } = await validateRequest(request);
  if (errorResponse) return errorResponse;

  try {
    const user = await prisma.user.findUnique({ where: { id: targetId } });
    if (!user) return NextResponse.json({ error: 'Proibido' }, { status: 401 });

    const body = await request.json();
    const cpf = String(body.cpf || '').replace(/\D/g, '');

    if (!validarCPF(cpf)) {
      return NextResponse.json({ error: 'CPF invalido.' }, { status: 400 });
    }

    const contextId = request.headers.get('x-empresa-id');
    const empresaIdAlvo = await getEmpresaContexto(user, contextId);
    if (!empresaIdAlvo) {
      return NextResponse.json({ error: 'Acesso negado a esta empresa.' }, { status: 403 });
    }

    const clienteExistente = await prisma.cliente.findUnique({ where: { documento: cpf } });
    if (clienteExistente) {
      return NextResponse.json({
        origem: 'BANCO_DADOS',
        cpf,
        nome: clienteExistente.nome,
      });
    }

    const empresa = await prisma.empresa.findUnique({
      where: { id: empresaIdAlvo },
      select: { id: true, certificadoA1: true, senhaCertificado: true },
    });

    if (!empresa?.certificadoA1 || !empresa?.senhaCertificado) {
      return NextResponse.json({
        error: 'Configure o certificado A1 da empresa antes de consultar CPF no Portal Nacional.',
      }, { status: 400 });
    }

    const client = new NfsePortalInscricaoClient();
    const info = await client.recuperarInfoInscricao(
      cpf,
      empresa.certificadoA1,
      empresa.senhaCertificado,
      empresa.id,
    );

    return NextResponse.json({
      origem: 'PORTAL_NACIONAL',
      cpf: info.cpf,
      inscricao: info.inscricao,
      nome: info.nomeRazaoSocial,
      codigoPais: info.codigoPais,
      dataConsulta: info.dataConsulta,
    });
  } catch (error: any) {
    return NextResponse.json({
      error: error.message || 'Nao foi possivel consultar o CPF no Portal Nacional.',
    }, { status: 502 });
  }
}
