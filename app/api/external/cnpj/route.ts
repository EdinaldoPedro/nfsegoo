import { withApiGuard } from '@/app/utils/api-route';
import { NextResponse } from 'next/server';
import { getAuthenticatedUser, unauthorized } from '@/app/utils/api-middleware';
import { normalizeCnpj, validarCNPJ } from '@/app/utils/cnpj';
import { validateJsonContentLength } from '@/app/utils/request-guards';

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

    // 2. Tenta API Pública 1: BrasilAPI (Rápida e Grátis)
    try {
        const dataBrasil = await fetchSafe(`https://brasilapi.com.br/api/cnpj/v1/${cnpjLimpo}`);
        if (dataBrasil) {
            // CORREÇÃO: Tipagem explícita aqui também
            const cnaes: any[] = [];
            if (dataBrasil.cnae_fiscal) cnaes.push({ codigo: String(dataBrasil.cnae_fiscal), descricao: dataBrasil.cnae_fiscal_descricao, principal: true });
            if (dataBrasil.cnaes_secundarios) {
                dataBrasil.cnaes_secundarios.forEach((c: any) => cnaes.push({ codigo: String(c.codigo), descricao: c.descricao, principal: false }));
            }
            const codigoIbge = String(dataBrasil.codigo_municipio || '').replace(/\D/g, '') || await buscarIbgePorCep(dataBrasil.cep);

            return NextResponse.json({
                razaoSocial: dataBrasil.razao_social,
                nomeFantasia: dataBrasil.nome_fantasia || dataBrasil.razao_social,
                email: dataBrasil.email,
                cep: dataBrasil.cep,
                logradouro: dataBrasil.logradouro,
                numero: dataBrasil.numero,
                complemento: dataBrasil.complemento,
                bairro: dataBrasil.bairro,
                cidade: dataBrasil.municipio,
                uf: dataBrasil.uf,
                codigoIbge,
                cnaePrincipal: String(dataBrasil.cnae_fiscal),
                cnaes
            });
        }
    } catch { /* fallback abaixo */ }

    // 3. Fallback: ReceitaWS (Pública, lenta, rate limit)
    try {
       const dataReceita = await fetchSafe(`https://www.receitaws.com.br/v1/cnpj/${cnpjLimpo}`);
       if (dataReceita && dataReceita.status !== 'ERROR') {
         // CORREÇÃO: Adicionado tipo explícito aqui para resolver o erro
         const listaCnaes: any[] = [];
         
         if (dataReceita.atividade_principal) dataReceita.atividade_principal.forEach((c: any) => listaCnaes.push({ codigo: c.code.replace(/\D/g, ''), descricao: c.text, principal: true }));
         if (dataReceita.atividades_secundarias) dataReceita.atividades_secundarias.forEach((c: any) => listaCnaes.push({ codigo: c.code.replace(/\D/g, ''), descricao: c.text, principal: false }));

         const codigoIbge = await buscarIbgePorCep(dataReceita.cep);

         return NextResponse.json({
             razaoSocial: dataReceita.nome,
             nomeFantasia: dataReceita.fantasia || dataReceita.nome,
             email: dataReceita.email,
             cep: dataReceita.cep?.replace(/\D/g, ''),
             logradouro: dataReceita.logradouro,
             numero: dataReceita.numero,
             complemento: dataReceita.complemento,
             bairro: dataReceita.bairro,
             cidade: dataReceita.municipio,
             uf: dataReceita.uf,
             codigoIbge,
             cnaePrincipal: listaCnaes.find((c: any) => c.principal)?.codigo || '',
             cnaes: listaCnaes
         });
       }
    } catch { /* mensagem pública genérica abaixo */ }

    return NextResponse.json({ error: 'Não foi possível consultar este CNPJ no momento.' }, { status: 502 });

  } catch (error) {
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}, { maxBodyBytes: 8 * 1024 });
