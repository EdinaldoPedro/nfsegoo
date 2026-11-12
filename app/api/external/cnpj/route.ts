import { withApiGuard } from '@/app/utils/api-route';
import { NextResponse } from 'next/server';
import { getAuthenticatedUser, unauthorized } from '@/app/utils/api-middleware';
import { normalizeCnpj, validarCNPJ } from '@/app/utils/cnpj';
import { validateJsonContentLength } from '@/app/utils/request-guards';
import { consultPublicCompanyRegistry, resolveIbgeByCep } from '@/app/services/publicCompanyRegistryService';

export const POST = withApiGuard(async function POST(request: Request) {
  // 1. Segurança
  const user = await getAuthenticatedUser(request);
  if (!user) return unauthorized();

  try {
    const sizeError = validateJsonContentLength(request, 8 * 1024);
    if (sizeError) return sizeError;
    const { cnpj } = await request.json();
    const cnpjLimpo = normalizeCnpj(cnpj);

    if (!cnpjLimpo || !validarCNPJ(cnpjLimpo)) {
      return NextResponse.json({ error: 'CNPJ inválido' }, { status: 400 });
    }
    if (/[A-Z]/.test(cnpjLimpo)) {
      return NextResponse.json({
        error: 'A consulta automática pública ainda não suporta CNPJ alfanumérico. Preencha os dados cadastrais manualmente.',
        code: 'CNPJ_ALFANUMERICO_SEM_CONSULTA_PUBLICA',
      }, { status: 422 });
    }

    const registry = await consultPublicCompanyRegistry(cnpjLimpo);
    if (registry.status === 'FOUND') {
      const data = registry.data;
      const codigoIbge = data.codigoIbge || await resolveIbgeByCep(data.cep) || '';
      return NextResponse.json({
        razaoSocial: data.razaoSocial, nomeFantasia: data.nomeFantasia || data.razaoSocial,
        email: data.emailPublico, cep: data.cep, logradouro: data.logradouro, numero: data.numero,
        complemento: data.complemento, bairro: data.bairro, cidade: data.cidade, uf: data.uf,
        codigoIbge, cnaePrincipal: data.atividades.find(item => item.principal)?.codigo || '',
        cnaes: data.atividades, fonte: registry.source,
      });
    }
    if (registry.status === 'NOT_FOUND') return NextResponse.json({ error: 'CNPJ não encontrado nas fontes cadastrais públicas.' }, { status: 404 });
    if (registry.status === 'INVALID_RESPONSE') return NextResponse.json({ error: 'A fonte cadastral devolveu dados inválidos ou incompletos.' }, { status: 502 });
    return NextResponse.json({ error: 'As fontes cadastrais estão temporariamente indisponíveis. Tente novamente em alguns minutos.' }, { status: 503 });

  } catch (error) {
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}, { maxBodyBytes: 8 * 1024 });
