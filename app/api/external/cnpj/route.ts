import { withApiGuard } from '@/app/utils/api-route';
import { NextResponse } from 'next/server';
import { getAuthenticatedUser, unauthorized } from '@/app/utils/api-middleware';
import { normalizeCnpj, validarCNPJ } from '@/app/utils/cnpj';
import { validateJsonContentLength } from '@/app/utils/request-guards';
import { consultPublicCompanyRegistry } from '@/app/services/publicCompanyRegistryService';

const MAX_EXTERNAL_JSON_BYTES = 2 * 1024 * 1024;

// Função auxiliar para retry com timeout
async function fetchSafe(url: string, options: any = {}, retries = 2) {
    for (let i = 0; i <= retries; i++) {
        let timeoutId: ReturnType<typeof setTimeout> | undefined;
        try {
            const controller = new AbortController();
            timeoutId = setTimeout(() => controller.abort(), 8000); // 8s timeout
            
            const res = await fetch(url, { ...options, signal: controller.signal, redirect: 'error' });
            const declaredLength = Number(res.headers.get('content-length') || 0);
            if (declaredLength > MAX_EXTERNAL_JSON_BYTES) return null;
            if (res.ok) {
                const text = await res.text();
                if (Buffer.byteLength(text, 'utf8') > MAX_EXTERNAL_JSON_BYTES) return null;
                return JSON.parse(text);
            }
            if (res.status === 429) { // Rate limit
                await new Promise(r => setTimeout(r, 2000)); // Espera 2s
                continue;
            }
        } catch (e) {
            if (i === retries) throw e;
        } finally {
            if (timeoutId) clearTimeout(timeoutId);
        }
    }
    return null;
}

async function buscarIbgePorCep(cep?: string | null): Promise<string> {
    const cepLimpo = String(cep || '').replace(/\D/g, '');
    if (cepLimpo.length !== 8) return '';

    try {
        const data = await fetchSafe(`https://viacep.com.br/ws/${cepLimpo}/json/`, {}, 1);
        return data && !data.erro && data.ibge ? String(data.ibge).replace(/\D/g, '') : '';
    } catch {
        return '';
    }
}

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
      const codigoIbge = data.codigoIbge || await buscarIbgePorCep(data.cep);
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
