import { normalizeCnpj, validarCNPJ } from '@/app/utils/cnpj';

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const USER_AGENT = 'NFSeGoo/1.0 (+https://nfsegoo.com.br)';

export type PublicCompanyRegistryData = {
  documento: string;
  razaoSocial: string;
  nomeFantasia: string | null;
  situacaoCadastral: string | null;
  emailPublico: string | null;
  telefonePublico: string | null;
  cep: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  codigoIbge: string | null;
  atividades: Array<{ codigo: string; descricao: string | null; principal: boolean }>;
};

export type PublicCompanyRegistryResult =
  | { status: 'FOUND'; source: 'BRASILAPI' | 'RECEITAWS'; data: PublicCompanyRegistryData; consultedAt: Date }
  | { status: 'NOT_FOUND' | 'TEMPORARY_UNAVAILABLE' | 'INVALID_RESPONSE' };

type ProviderResult =
  | { status: 'FOUND'; raw: Record<string, any> }
  | { status: 'NOT_FOUND' | 'TEMPORARY_UNAVAILABLE' | 'INVALID_RESPONSE' };

function clean(value: unknown, max: number): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const normalized = String(value).trim();
  // eslint-disable-next-line no-control-regex -- respostas externas não podem carregar controles.
  return normalized && normalized.length <= max && !/[\u0000-\u001f\u007f]/.test(normalized) ? normalized : null;
}

async function fetchProvider(url: string, provider: string): Promise<ProviderResult> {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(8_000), redirect: 'error', cache: 'no-store',
        headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
      });
      const declaredLength = Number(response.headers.get('content-length') || 0);
      if (declaredLength > MAX_RESPONSE_BYTES) return { status: 'INVALID_RESPONSE' };
      if (response.status === 404) return { status: 'NOT_FOUND' };
      if (!response.ok) {
        const temporary = response.status === 403 || response.status === 429 || response.status >= 500;
        console.warn('[PUBLIC_COMPANY_REGISTRY_FAILED]', { provider, category: temporary ? 'TEMPORARY' : 'INVALID_RESPONSE', status: response.status, attempt });
        if (temporary && attempt < 2 && response.status !== 403) {
          await new Promise(resolve => setTimeout(resolve, 300 * attempt));
          continue;
        }
        return { status: temporary ? 'TEMPORARY_UNAVAILABLE' : 'INVALID_RESPONSE' };
      }
      const text = await response.text();
      if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) return { status: 'INVALID_RESPONSE' };
      const parsed = JSON.parse(text);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? { status: 'FOUND', raw: parsed } : { status: 'INVALID_RESPONSE' };
    } catch (error) {
      console.warn('[PUBLIC_COMPANY_REGISTRY_FAILED]', { provider, category: 'NETWORK', attempt });
      if (attempt === 2) return { status: 'TEMPORARY_UNAVAILABLE' };
      await new Promise(resolve => setTimeout(resolve, 300 * attempt));
    }
  }
  return { status: 'TEMPORARY_UNAVAILABLE' };
}

function activities(items: Array<{ codigo: unknown; descricao: unknown; principal: boolean }>) {
  const seen = new Set<string>();
  return items.flatMap(item => {
    const codigo = String(item.codigo || '').replace(/\D/g, '');
    if (!/^\d{7}$/.test(codigo) || seen.has(codigo)) return [];
    seen.add(codigo);
    return [{ codigo, descricao: clean(item.descricao, 300), principal: item.principal }];
  }).slice(0, 201);
}

function normalizeBrasilApi(raw: Record<string, any>, requested: string): PublicCompanyRegistryData | null {
  const returned = normalizeCnpj(String(raw.cnpj || ''));
  const razaoSocial = clean(raw.razao_social, 200);
  if (returned !== requested || !razaoSocial) return null;
  return {
    documento: returned, razaoSocial, nomeFantasia: clean(raw.nome_fantasia, 200),
    situacaoCadastral: clean(raw.descricao_situacao_cadastral || raw.situacao_cadastral, 100),
    emailPublico: clean(raw.email, 254)?.toLowerCase() || null,
    telefonePublico: clean(raw.ddd_telefone_1 || raw.telefone, 30),
    cep: clean(raw.cep, 11)?.replace(/\D/g, '') || null,
    logradouro: clean(raw.logradouro, 200), numero: clean(raw.numero, 20),
    complemento: clean(raw.complemento, 100), bairro: clean(raw.bairro, 100),
    cidade: clean(raw.municipio, 100), uf: clean(raw.uf, 2)?.toUpperCase() || null,
    codigoIbge: /^\d{7}$/.test(String(raw.codigo_municipio || '').replace(/\D/g, ''))
      ? String(raw.codigo_municipio).replace(/\D/g, '') : null,
    atividades: activities([{ codigo: raw.cnae_fiscal, descricao: raw.cnae_fiscal_descricao, principal: true },
      ...(Array.isArray(raw.cnaes_secundarios) ? raw.cnaes_secundarios.slice(0, 200).map((item: any) => ({ ...item, principal: false })) : [])]),
  };
}

function normalizeReceitaWs(raw: Record<string, any>, requested: string): PublicCompanyRegistryData | null {
  if (String(raw.status || '').toUpperCase() === 'ERROR') return null;
  const returned = normalizeCnpj(String(raw.cnpj || ''));
  const razaoSocial = clean(raw.nome, 200);
  if (returned !== requested || !razaoSocial) return null;
  const principal = Array.isArray(raw.atividade_principal) ? raw.atividade_principal : [];
  const secondary = Array.isArray(raw.atividades_secundarias) ? raw.atividades_secundarias : [];
  return {
    documento: returned, razaoSocial, nomeFantasia: clean(raw.fantasia, 200),
    situacaoCadastral: clean(raw.situacao, 100), emailPublico: clean(raw.email, 254)?.toLowerCase() || null,
    telefonePublico: clean(raw.telefone, 30), cep: clean(raw.cep, 11)?.replace(/\D/g, '') || null,
    logradouro: clean(raw.logradouro, 200), numero: clean(raw.numero, 20),
    complemento: clean(raw.complemento, 100), bairro: clean(raw.bairro, 100),
    cidade: clean(raw.municipio, 100), uf: clean(raw.uf, 2)?.toUpperCase() || null, codigoIbge: null,
    atividades: activities([
      ...principal.map((item: any) => ({ codigo: item.code, descricao: item.text, principal: true })),
      ...secondary.slice(0, 200).map((item: any) => ({ codigo: item.code, descricao: item.text, principal: false })),
    ]),
  };
}

export async function consultPublicCompanyRegistry(documento: string): Promise<PublicCompanyRegistryResult> {
  const cnpj = normalizeCnpj(documento);
  if (!cnpj || !validarCNPJ(cnpj) || /[A-Z]/.test(cnpj)) return { status: 'INVALID_RESPONSE' };
  const brasil = await fetchProvider(`https://brasilapi.com.br/api/cnpj/v1/${encodeURIComponent(cnpj)}`, 'BRASILAPI');
  if (brasil.status === 'FOUND') {
    const data = normalizeBrasilApi(brasil.raw, cnpj);
    if (data) return { status: 'FOUND', source: 'BRASILAPI', data, consultedAt: new Date() };
  }
  const receita = await fetchProvider(`https://www.receitaws.com.br/v1/cnpj/${encodeURIComponent(cnpj)}`, 'RECEITAWS');
  if (receita.status === 'FOUND') {
    const providerMessage = String(receita.raw.message || '').toLocaleLowerCase('pt-BR');
    if (String(receita.raw.status || '').toUpperCase() === 'ERROR') {
      if (/limite|muitas consultas|temporariamente/.test(providerMessage)) return { status: 'TEMPORARY_UNAVAILABLE' };
      if (/não encontrado|nao encontrado|inválido|invalido/.test(providerMessage)) {
        return brasil.status === 'NOT_FOUND' ? { status: 'NOT_FOUND' } : { status: 'TEMPORARY_UNAVAILABLE' };
      }
      return { status: 'INVALID_RESPONSE' };
    }
    const data = normalizeReceitaWs(receita.raw, cnpj);
    if (data) return { status: 'FOUND', source: 'RECEITAWS', data, consultedAt: new Date() };
  }
  if (brasil.status === 'FOUND' || receita.status === 'FOUND') return { status: 'INVALID_RESPONSE' };
  if (brasil.status === 'NOT_FOUND' && receita.status === 'NOT_FOUND') return { status: 'NOT_FOUND' };
  if (brasil.status === 'INVALID_RESPONSE' && receita.status === 'INVALID_RESPONSE') return { status: 'INVALID_RESPONSE' };
  return { status: 'TEMPORARY_UNAVAILABLE' };
}
