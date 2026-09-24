import { withApiGuard } from '@/app/utils/api-route';
import { NextResponse } from 'next/server';
import { prisma } from '@/app/utils/prisma';
import { NfsePortalInscricaoClient } from '@/app/services/portal/NfsePortalInscricaoClient';
import { validateRequest } from '@/app/utils/api-security';
import { validarCPF } from '@/app/utils/cpf';
import { resolveEmpresaContexto } from '@/app/utils/access-control';
import { checkRateLimit } from '@/app/utils/rate-limit';
import { validateJsonContentLength } from '@/app/utils/request-guards';

const MAX_CONSULTA_CPF_ATTEMPTS = 2;
const RETRY_DELAY_MS = 1500;

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function consultationFailureCategory(error: unknown) {
  const cause = error instanceof Error && error.cause instanceof Error ? error.cause : error;
  const message = cause instanceof Error ? cause.message.toLowerCase() : '';
  if (message.includes('navegador automatizado')) return 'BROWSER_UNAVAILABLE';
  if (message.includes('login por certificado') || message.includes('sessao autenticada') || message.includes('link de acesso por certificado')) return 'PORTAL_AUTH';
  if (message.includes('abrir e validar o certificado') || message.includes('certificado digital ausente') ||
      message.includes('senha do certificado digital ausente') || message.includes('pkcs') || message.includes('cadeia de confiança')) return 'CERTIFICATE';
  if (message.includes('http ') || message.includes('resposta invalida') || message.includes('nome/razao social')) return 'PORTAL_RESPONSE';
  if (message.includes('timeout') || message.includes('timed out')) return 'TIMEOUT';
  return 'UNKNOWN';
}

export const POST = withApiGuard(async function POST(request: Request) {
  const { targetId, errorResponse } = await validateRequest(request);
  if (errorResponse) return errorResponse;

  try {
    const user = await prisma.user.findUnique({ where: { id: targetId } });
    if (!user) return NextResponse.json({ error: 'Proibido' }, { status: 401 });

    const sizeError = validateJsonContentLength(request, 8 * 1024);
    if (sizeError) return sizeError;
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
    const clienteExistente = await prisma.cliente.findFirst({ where: { empresaId: empresaIdAlvo, documento: cpf, arquivadoEm: null } });
    if (clienteExistente) {
      return NextResponse.json({
        origem: 'BANCO_DADOS',
        cpf,
        nome: clienteExistente.nome,
      });
    }
    if (process.env.NODE_ENV === 'production' && process.env.ENABLE_PORTAL_CPF_AUTOMATION !== 'true') {
      return NextResponse.json({
        error: 'A consulta automática de CPF está desativada. Informe o nome manualmente.',
        code: 'PORTAL_CPF_AUTOMATION_DISABLED',
      }, { status: 409 });
    }
    if (!await checkRateLimit(`cpf_portal:${user.id}:${empresaIdAlvo}`, 5, 10 * 60 * 1000)) {
      return NextResponse.json({ error: 'Limite de consultas oficiais atingido. Aguarde até dez minutos antes de tentar novamente. Você pode preencher o nome manualmente.', code: 'PORTAL_CPF_RATE_LIMITED' }, { status: 429 });
    }

    const empresa = await prisma.empresa.findUnique({
      where: { id: empresaIdAlvo },
      select: { id: true, documento: true, certificadoA1: true, senhaCertificado: true },
    });

    if (!empresa?.certificadoA1 || !empresa?.senhaCertificado) {
      return NextResponse.json({
        error: 'Configure o certificado A1 da empresa antes de consultar CPF no Portal Nacional.',
      }, { status: 400 });
    }

    const client = new NfsePortalInscricaoClient();
    let info = null;

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
            expectedCnpj: empresa.documento,
          },
        );
        break;
      } catch (error) {
        // Do not log CPF, certificate material, Playwright URLs or raw responses.
        const category = consultationFailureCategory(error);
        console.warn('[CPF_PORTAL_CONSULTATION_FAILED]', { category, attempt: tentativa });
        if (category === 'BROWSER_UNAVAILABLE' || category === 'CERTIFICATE') break;
        if (tentativa < MAX_CONSULTA_CPF_ATTEMPTS) await delay(RETRY_DELAY_MS);
      }
    }

    if (!info) {
      return NextResponse.json({
        error: 'Não foi possível concluir a consulta oficial agora. Você pode informar o nome manualmente e tentar novamente mais tarde. O endereço completo continua obrigatório para emitir.',
        code: 'PORTAL_CPF_UNAVAILABLE',
      }, { status: 424 });
    }

    return NextResponse.json({
      origem: 'PORTAL_NACIONAL',
      cpf: info.cpf,
      inscricao: info.inscricao,
      nome: info.nomeRazaoSocial,
      codigoPais: info.codigoPais,
      dataConsulta: info.dataConsulta,
    });
  } catch {
    return NextResponse.json({
      error: 'Nao foi possivel consultar o CPF no Portal Nacional.',
    }, { status: 502 });
  }
}, { maxBodyBytes: 8 * 1024 });
