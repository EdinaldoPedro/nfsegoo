import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/app/utils/prisma';
import { normalizeCnpj, validarCNPJ } from '@/app/utils/cnpj';

type Db = Prisma.TransactionClient | typeof prisma;

export const FISCAL_ENTITY_PUBLIC_FIELDS = [
  'razaoSocial', 'nomeFantasia', 'situacaoCadastral', 'cep', 'logradouro',
  'numero', 'complemento', 'bairro', 'cidade', 'uf', 'pais', 'codigoIbge',
] as const;

export type FiscalEntityPublicField = typeof FISCAL_ENTITY_PUBLIC_FIELDS[number];
export type FiscalEntityPublicData = Omit<Record<FiscalEntityPublicField, string | null>, 'razaoSocial' | 'pais'> & {
  documento: string;
  razaoSocial: string;
  pais: string;
  emailPublico: string | null;
  telefonePublico: string | null;
};

export type FiscalRegistryResult = {
  data: FiscalEntityPublicData;
  atividades: Array<{ codigo: string; descricao: string | null; principal: boolean }>;
  fonte: 'BRASILAPI' | 'BRASILAPI_VIACEP';
  payloadHash: string;
  consultedAt: Date;
};

const fiscalEntityInclude = { correcoes: { orderBy: { updatedAt: 'asc' as const } } } as const;

function clean(value: unknown, max: number): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const normalized = String(value).trim();
  // eslint-disable-next-line no-control-regex -- resposta externa não pode carregar controles.
  if (!normalized || normalized.length > max || /[\u0000-\u001f\u007f]/.test(normalized)) return null;
  return normalized;
}

async function fetchJson(url: string, timeoutMs = 8_000): Promise<Record<string, any> | null> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs), redirect: 'error', cache: 'no-store', headers: {
        Accept: 'application/json',
        // BrasilAPI bloqueia alguns clientes HTTP sem identificação (403),
        // embora a mesma URL continue acessível pelo navegador.
        'User-Agent': 'NFSeGoo/1.0 (+https://nfsegoo.com.br)',
      },
    });
    const declared = Number(response.headers.get('content-length') || 0);
    if (!response.ok || declared > 2 * 1024 * 1024) return null;
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > 2 * 1024 * 1024) return null;
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function canonicalHash(value: unknown) {
  const sort = (item: unknown): unknown => Array.isArray(item) ? item.map(sort)
    : item && typeof item === 'object' ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, sort(entry)])) : item;
  return createHash('sha256').update(JSON.stringify(sort(value))).digest('hex');
}

/** BrasilAPI is a public aggregator, not represented as a direct Receita/Serpro
 * connection. Provenance is retained so a future official provider can replace it. */
export async function consultarEntidadeFiscalPublica(documento: string): Promise<FiscalRegistryResult | null> {
  const cnpj = normalizeCnpj(documento);
  if (!cnpj || !validarCNPJ(cnpj) || /[A-Z]/.test(cnpj)) return null;
  const raw = await fetchJson(`https://brasilapi.com.br/api/cnpj/v1/${encodeURIComponent(cnpj)}`);
  if (!raw) return null;
  const returnedDocument = normalizeCnpj(String(raw.cnpj || cnpj));
  if (returnedDocument !== cnpj) return null;
  const razaoSocial = clean(raw.razao_social, 200);
  if (!razaoSocial) return null;
  const cep = clean(raw.cep, 11)?.replace(/\D/g, '') || null;
  let codigoIbge = clean(raw.codigo_municipio, 7)?.replace(/\D/g, '') || null;
  let fonte: FiscalRegistryResult['fonte'] = 'BRASILAPI';
  const brasilAddress = {
    logradouro: clean(raw.logradouro, 200), complemento: clean(raw.complemento, 100),
    bairro: clean(raw.bairro, 100), cidade: clean(raw.municipio, 100),
    uf: clean(raw.uf, 2)?.toUpperCase() || null,
  };
  let viaCep: Record<string, any> | null = null;
  if (/^\d{8}$/.test(cep || '') && (!/^\d{7}$/.test(codigoIbge || '')
    || Object.values(brasilAddress).some(value => !value))) {
    viaCep = await fetchJson(`https://viacep.com.br/ws/${cep}/json/`, 5_000);
    const code = clean(viaCep?.ibge, 7)?.replace(/\D/g, '') || null;
    if (!/^\d{7}$/.test(codigoIbge || '') && /^\d{7}$/.test(code || '')) codigoIbge = code;
    if (viaCep && !viaCep.erro) fonte = 'BRASILAPI_VIACEP';
  }
  const data: FiscalEntityPublicData = {
    documento: cnpj,
    razaoSocial,
    nomeFantasia: clean(raw.nome_fantasia, 200),
    situacaoCadastral: clean(raw.descricao_situacao_cadastral || raw.situacao_cadastral, 100),
    emailPublico: clean(raw.email, 254)?.toLowerCase() || null,
    telefonePublico: clean(raw.ddd_telefone_1 || raw.telefone, 30),
    cep, logradouro: brasilAddress.logradouro || clean(viaCep?.logradouro, 200), numero: clean(raw.numero, 20),
    complemento: brasilAddress.complemento || clean(viaCep?.complemento, 100),
    bairro: brasilAddress.bairro || clean(viaCep?.bairro, 100),
    cidade: brasilAddress.cidade || clean(viaCep?.localidade, 100),
    uf: brasilAddress.uf || clean(viaCep?.uf, 2)?.toUpperCase() || null,
    pais: 'Brasil', codigoIbge,
  };
  const seen = new Set<string>();
  const atividades = [{ codigo: raw.cnae_fiscal, descricao: raw.cnae_fiscal_descricao, principal: true },
    ...(Array.isArray(raw.cnaes_secundarios) ? raw.cnaes_secundarios.slice(0, 200) : [])].flatMap((item: any) => {
      const codigo = String(item?.codigo || '').replace(/\D/g, '');
      if (!/^\d{7}$/.test(codigo) || seen.has(codigo)) return [];
      seen.add(codigo);
      return [{ codigo, descricao: clean(item?.descricao, 300), principal: item?.principal === true }];
    });
  return { data, atividades, fonte, payloadHash: canonicalHash({ data, atividades }), consultedAt: new Date() };
}

export function effectiveFiscalEntity<T extends Record<string, any>>(entity: T) {
  const effective: Record<string, unknown> = { ...entity };
  for (const correction of entity.correcoes || []) {
    if ((FISCAL_ENTITY_PUBLIC_FIELDS as readonly string[]).includes(correction.campo)) effective[correction.campo] = correction.valor;
  }
  return effective as T & Record<FiscalEntityPublicField, string | null>;
}

/** Canonical fields come from the shared identity. Email, phone, municipal and
 * state registrations always remain those of this issuer/customer relationship. */
export function mergeTenantCustomer<T extends Record<string, any>>(customer: T) {
  const { entidadeFiscal, ...relationship } = customer;
  if (!entidadeFiscal) return relationship;
  const entity = effectiveFiscalEntity(entidadeFiscal);
  const correctionUpdatedAt = (entidadeFiscal.correcoes || []).reduce((latest: Date, item: { updatedAt?: Date }) =>
    item.updatedAt instanceof Date && item.updatedAt > latest ? item.updatedAt : latest, entidadeFiscal.updatedAt);
  const relationshipUpdatedAt = (relationship as Record<string, any>).updatedAt;
  const effectiveUpdatedAt = relationshipUpdatedAt instanceof Date && relationshipUpdatedAt > correctionUpdatedAt
    ? relationshipUpdatedAt : correctionUpdatedAt;
  return {
    ...relationship,
    documento: entidadeFiscal.documento,
    nome: entity.razaoSocial,
    nomeFantasia: entity.nomeFantasia,
    cep: entity.cep,
    logradouro: entity.logradouro,
    numero: entity.numero,
    complemento: entity.complemento,
    bairro: entity.bairro,
    cidade: entity.cidade,
    uf: entity.uf,
    pais: entity.pais,
    codigoIbge: entity.codigoIbge,
    updatedAt: effectiveUpdatedAt,
    identidadeFiscal: {
      id: entidadeFiscal.id, version: entidadeFiscal.version, fonte: entidadeFiscal.fonte,
      fonteConsultadaEm: entidadeFiscal.fonteConsultadaEm, updatedAt: entidadeFiscal.updatedAt,
    },
  };
}

function fallbackPublicData(documento: string, input: Record<string, unknown>): FiscalEntityPublicData {
  const razaoSocial = clean(input.nome ?? input.razaoSocial, 200);
  if (!razaoSocial) throw Object.assign(new Error('Razão social obrigatória para criar a identidade fiscal.'), { status: 400 });
  return {
    documento, razaoSocial, nomeFantasia: clean(input.nomeFantasia, 200), situacaoCadastral: null,
    emailPublico: null, telefonePublico: null, cep: clean(input.cep, 11)?.replace(/\D/g, '') || null,
    logradouro: clean(input.logradouro, 200), numero: clean(input.numero, 20), complemento: clean(input.complemento, 100),
    bairro: clean(input.bairro, 100), cidade: clean(input.cidade, 100), uf: clean(input.uf, 2)?.toUpperCase() || null,
    pais: 'Brasil', codigoIbge: clean(input.codigoIbge, 7)?.replace(/\D/g, '') || null,
  };
}

function publicUpdate(result: FiscalRegistryResult) {
  // Ausência na fonte significa dado desconhecido, não uma ordem para apagar.
  // Remoções explícitas continuam sendo possíveis pelas edições manuais.
  return Object.fromEntries(Object.entries(result.data)
    .filter(([key, value]) => key !== 'documento' && value !== null));
}

function manualUpdate(documento: string, fallback: Record<string, unknown>) {
  const data = fallbackPublicData(documento, fallback);
  return Object.fromEntries(FISCAL_ENTITY_PUBLIC_FIELDS.flatMap(field => {
    // Situação cadastral só é conhecida pela fonte pública. Os demais campos
    // fazem parte do cadastro compartilhado preenchido pelo operador/cliente.
    if (field === 'situacaoCadastral') return [];
    return [[field, data[field]]];
  }));
}

export async function ensureCanonicalFiscalEntity(
  tx: Prisma.TransactionClient,
  documento: string,
  fallback: Record<string, unknown>,
  registry: FiscalRegistryResult | null,
  actorUserId?: string,
  options: { origin?: 'CADASTRO_CLIENTE' } = {},
) {
  await tx.$queryRaw`SELECT 1::int AS "locked" FROM (SELECT pg_advisory_xact_lock(hashtextextended(${`entidade-fiscal:${documento}`}, 0))) AS fiscal_entity_lock`;
  const current = await tx.entidadeFiscal.findUnique({ where: { documento }, include: fiscalEntityInclude });
  const registration = options.origin === 'CADASTRO_CLIENTE';
  if (!current) {
    const manual = fallbackPublicData(documento, fallback);
    const base = registry
      ? registration
        ? { ...registry.data, ...manualUpdate(documento, fallback) } as FiscalEntityPublicData
        : Object.fromEntries(Object.entries(registry.data).map(([key, value]) => [key, value ?? (manual as any)[key] ?? null])) as FiscalEntityPublicData
      : manual;
    const created = await tx.entidadeFiscal.create({ data: {
      ...base, fonte: registration ? 'CADASTRO_CLIENTE' : registry?.fonte || 'CADASTRO_MANUAL', fonteConsultadaEm: registry?.consultedAt,
      fontePayloadHash: registration ? null : registry?.payloadHash,
      atividades: registry?.atividades.length ? { create: registry.atividades } : undefined,
      eventos: { create: { origem: registration ? 'CADASTRO_CLIENTE' : registry ? 'CONSULTA_PUBLICA' : 'CADASTRO_MANUAL', actorUserId,
        camposAlterados: JSON.stringify(['identidadeInicial']), snapshotJson: JSON.stringify(base) } },
    }, include: fiscalEntityInclude });
    return created;
  }
  const update = registration
    ? { ...(registry ? publicUpdate(registry) : {}), ...manualUpdate(documento, fallback) }
    : registry ? publicUpdate(registry) : manualUpdate(documento, fallback);
  const updatedFields = Object.keys(update) as FiscalEntityPublicField[];
  const supersededCorrections = current.correcoes.filter(item => updatedFields.includes(item.campo as FiscalEntityPublicField));
  const changed = Object.entries(update).filter(([key, value]) => (current as any)[key] !== value).map(([key]) => key);
  if (!changed.length && !supersededCorrections.length
    && (!registry || current.fontePayloadHash === registry.payloadHash)) return current;

  // Correções não são uma camada permanente: elas representam a última
  // atualização apenas até que uma origem posterior escreva o mesmo campo.
  if (supersededCorrections.length) await tx.entidadeFiscalCorrecao.deleteMany({
    where: { entidadeFiscalId: current.id, campo: { in: supersededCorrections.map(item => item.campo) } },
  });
  const eventFields = [...new Set([...changed, ...supersededCorrections.map(item => item.campo)])];
  const saved = await tx.entidadeFiscal.update({ where: { id: current.id }, data: {
    ...update, fonte: registration ? 'CADASTRO_CLIENTE' : registry?.fonte || 'CADASTRO_MANUAL',
    fonteConsultadaEm: registry?.consultedAt || null,
    fontePayloadHash: registration ? null : registry?.payloadHash || null, version: { increment: 1 },
    eventos: { create: { origem: registration ? 'CADASTRO_CLIENTE' : registry ? 'CONSULTA_PUBLICA' : 'CADASTRO_MANUAL', actorUserId,
      camposAlterados: JSON.stringify(eventFields), snapshotJson: JSON.stringify(registry?.data || update) } },
  }, include: fiscalEntityInclude });
  if (registry) {
    await tx.entidadeFiscalAtividade.deleteMany({ where: { entidadeFiscalId: current.id } });
    if (registry.atividades.length) await tx.entidadeFiscalAtividade.createMany({ data: registry.atividades.map(item => ({ ...item, entidadeFiscalId: current.id })) });
  }
  return saved;
}

export async function loadCanonicalFiscalEntity(documento: string, db: Db = prisma) {
  return db.entidadeFiscal.findUnique({ where: { documento }, include: fiscalEntityInclude });
}

export async function refreshCanonicalFiscalEntity(documento: string, actorUserId?: string) {
  const registry = await consultarEntidadeFiscalPublica(documento);
  if (!registry) throw Object.assign(new Error('A fonte cadastral pública não confirmou este CNPJ agora. Nenhum dado foi alterado.'), { status: 503 });
  return prisma.$transaction(async tx => ensureCanonicalFiscalEntity(tx, documento, registry.data, registry, actorUserId),
    { isolationLevel: 'ReadCommitted', timeout: 15_000, maxWait: 5_000 });
}

export const tenantCustomerFiscalInclude = fiscalEntityInclude;
