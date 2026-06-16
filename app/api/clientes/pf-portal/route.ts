import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { NfsePortalInscricaoClient } from '@/app/services/portal/NfsePortalInscricaoClient';
import { validateRequest } from '@/app/utils/api-security';
import { validarCPF } from '@/app/utils/cpf';
import { resolveEmpresaContexto } from '@/app/utils/access-control';

const prisma = new PrismaClient();
const MAX_CONSULTA_CPF_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1500;

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
    const empresaIdAlvo = await resolveEmpresaContexto(user, contextId);
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
    let info = null;
    let ultimoErro: any = null;

    for (let tentativa = 1; tentativa <= MAX_CONSULTA_CPF_ATTEMPTS; tentativa += 1) {
      try {
        info = await client.recuperarInfoInscricao(
          cpf,
          empresa.certificadoA1,
          empresa.senhaCertificado,
          empresa.id,
          undefined,
          {
            navigationTimeoutMs: 25000,
            authTimeoutMs: 20000,
            actionTimeoutMs: 6000,
          },
        );
        break;
      } catch (error: any) {
        ultimoErro = error;
        console.warn(`[CPF PORTAL] Tentativa ${tentativa}/${MAX_CONSULTA_CPF_ATTEMPTS} falhou: ${error.message}`);
        if (tentativa < MAX_CONSULTA_CPF_ATTEMPTS) await delay(RETRY_DELAY_MS);
      }
    }

    if (!info) {
      return NextResponse.json({
        error: 'Portal Nacional instavel: nao foi possivel consultar este CPF apos algumas tentativas. Voce pode tentar novamente em instantes ou salvar o cliente marcando a opcao de emitir sem informar endereco.',
        details: ultimoErro?.message,
      }, { status: 504 });
    }

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
