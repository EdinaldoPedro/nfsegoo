import bcrypt from 'bcryptjs';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/app/utils/prisma';
import { getEffectivePlanLimits } from './planService';
import type { FiscalRegistryResult } from './fiscalEntityService';

export class AdminCompanyError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
type Tx = Prisma.TransactionClient;
const companySummary = { id: true, documento: true, razaoSocial: true, arquivadoEm: true } as const;
const commonSelect = { id: true, documento: true, email: true, nomeFantasia: true, inscricaoMunicipal: true,
  cep: true, logradouro: true, numero: true, complemento: true, bairro: true, cidade: true, uf: true,
  codigoIbge: true, updatedAt: true, arquivadoEm: true } as const;
export const adminCompanySelect = { ...commonSelect, razaoSocial: true, ambiente: true,
  lastApiCheck: true,
  proprietarioUser: { select: { id: true, nome: true, email: true } },
  donoUser: { select: { id: true, nome: true, email: true } },
  _count: { select: { clientesCadastrados: true } } } satisfies Prisma.EmpresaSelect;
export const adminCustomerSelect = { ...commonSelect, nome: true, tipo: true, empresaId: true, telefone: true,
  inscricaoEstadual: true, pais: true, nif: true, moeda: true,
  empresa: { select: companySummary }, vinculos: { select: { arquivadoEm: true }, take: 1 } } satisfies Prisma.ClienteSelect;

export const COMPANY_PUBLIC_FIELDS = ['razaoSocial', 'nomeFantasia', 'cep', 'logradouro', 'numero',
  'complemento', 'bairro', 'cidade', 'uf', 'codigoIbge'] as const;
type CompanyPublicField = typeof COMPANY_PUBLIC_FIELDS[number];

export function companyPublicRegistryData(registry: FiscalRegistryResult): Record<CompanyPublicField, string | null> {
  return Object.fromEntries(COMPANY_PUBLIC_FIELDS.map(field => [field, registry.data[field]])) as Record<CompanyPublicField, string | null>;
}

export function companyPublicRegistryPatch(registry: FiscalRegistryResult): Partial<Record<CompanyPublicField, string>> {
  return Object.fromEntries(COMPANY_PUBLIC_FIELDS.flatMap(field => {
    const value = registry.data[field];
    return value === null ? [] : [[field, value]];
  })) as Partial<Record<CompanyPublicField, string>>;
}

function id(input: unknown): string {
  if (typeof input !== 'string' || !/^[a-z0-9_-]{1,100}$/i.test(input)) throw new AdminCompanyError('Identificador inválido. Atualize a tela.');
  return input;
}
function record(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AdminCompanyError('Informe um objeto de dados válido.');
  return input as Record<string, unknown>;
}
function text(input: unknown, label: string, max: number, min = 0, multiline = false) {
  if (typeof input !== 'string' || input.length > max || input.trim().length < min || Array.from(input).some(char =>
    (char.charCodeAt(0) < 32 && !(multiline && ['\n', '\r', '\t'].includes(char))) || char.charCodeAt(0) === 127)) throw new AdminCompanyError(`${label}: texto inválido (mínimo ${min}, máximo ${max} caracteres).`);
  return input.trim();
}
export function parseAdminCompanyQuery(search: URLSearchParams) {
  const integer = (key: string, fallback: number, max: number) => {
    const raw = search.get(key) ?? String(fallback);
    if (!/^[1-9]\d{0,5}$/.test(raw) || Number(raw) > max) throw new AdminCompanyError(`Parâmetro ${key} inválido.`);
    return Number(raw);
  };
  const type = search.get('type') ?? 'PRESTADOR';
  const state = search.get('state') ?? 'ATIVOS';
  if (!['PRESTADOR', 'TOMADOR'].includes(type) || !['ATIVOS', 'ARQUIVADOS'].includes(state)) throw new AdminCompanyError('Categoria ou situação inválida.');
  const empresaId = search.has('empresaId') ? id(search.get('empresaId')) : undefined;
  if (empresaId && type !== 'TOMADOR') throw new AdminCompanyError('O filtro de empresa se aplica aos tomadores.');
  return { page: integer('page', 1, 100_000), limit: integer('limit', 10, 50), type, state, empresaId,
    search: text(search.get('search') ?? '', 'Busca', 120) };
}
export function parseAdminCompanyMutation(input: unknown) {
  const body = record(input);
  const keys = ['id', 'origem', 'empresaId', 'expectedUpdatedAt', 'action', 'data', 'adminPassword', 'justification', 'sourceHash'];
  if (Object.keys(body).some(key => !keys.includes(key))) throw new AdminCompanyError('Campos não permitidos. Atualize a tela.');
  if (typeof body.origem !== 'string' || !['PRESTADOR', 'TOMADOR'].includes(body.origem) || typeof body.action !== 'string' || !['UPDATE', 'ARCHIVE', 'RESTORE', 'REFRESH'].includes(body.action)) throw new AdminCompanyError('Operação ou categoria inválida.');
  if (body.action === 'REFRESH' && body.origem !== 'PRESTADOR') throw new AdminCompanyError('A consulta pública desta tela se aplica somente aos prestadores.');
  if (body.origem === 'PRESTADOR' && body.empresaId !== undefined && body.empresaId !== body.id) throw new AdminCompanyError('A empresa confirmada não corresponde ao cadastro selecionado.');
  const version = body.expectedUpdatedAt;
  if (typeof version !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(version) || !Number.isFinite(Date.parse(version))) throw new AdminCompanyError('Versão do cadastro ausente ou inválida. Atualize a tela.');
  const password = typeof body.adminPassword === 'string' ? body.adminPassword : '';
  if (!password || Buffer.byteLength(password, 'utf8') > 72) throw new AdminCompanyError('Informe sua senha administrativa atual (até 72 bytes).');
  const justification = text(body.justification, 'Justificativa', 2000, 10, true);
  if (body.action !== 'UPDATE' && body.data !== undefined) throw new AdminCompanyError('Esta operação não permite alterar campos manualmente.');
  const data = body.action === 'UPDATE' ? record(body.data) : {};
  const limits: Record<string, number> = { razaoSocial: 200, nomeFantasia: 200, email: 254, inscricaoMunicipal: 30,
    cep: 11, logradouro: 200, numero: 20, complemento: 100, bairro: 100, cidade: 100, uf: 50, codigoIbge: 7,
    ...(body.origem === 'TOMADOR' ? { telefone: 30, inscricaoEstadual: 30 } : {}) };
  const clean: Record<string, string> = {};
  for (const [key, value] of Object.entries(data)) {
    if (!Object.hasOwn(limits, key)) throw new AdminCompanyError('Identidade, vínculos, certificado e parâmetros fiscais não podem ser substituídos por esta operação.');
    clean[key] = text(value, key, limits[key], key === 'razaoSocial' ? 2 : 0);
  }
  if (body.action === 'UPDATE' && !Object.keys(clean).length) throw new AdminCompanyError('Informe os campos que serão atualizados.');
  if (clean.email !== undefined) {
    clean.email = clean.email.toLowerCase();
    if (clean.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean.email)) throw new AdminCompanyError('E-mail comercial inválido.');
  }
  const sourceHash = typeof body.sourceHash === 'string' ? body.sourceHash : '';
  if (body.action === 'REFRESH' && !/^[a-f0-9]{64}$/.test(sourceHash)) throw new AdminCompanyError('A prévia da fonte pública expirou ou é inválida. Consulte novamente.');
  if (body.action !== 'REFRESH' && body.sourceHash !== undefined) throw new AdminCompanyError('A prévia pública só pode ser aplicada na atualização consultada.');
  return { id: id(body.id), origem: body.origem as 'PRESTADOR' | 'TOMADOR',
    empresaId: body.origem === 'TOMADOR' ? id(body.empresaId) : id(body.id), version,
    action: body.action as 'UPDATE' | 'ARCHIVE' | 'RESTORE' | 'REFRESH', password, justification, data: clean, sourceHash };
}

export async function listAdminCompanies(search: URLSearchParams) {
  const query = parseAdminCompanyQuery(search);
  const skip = (query.page - 1) * query.limit;
  return prisma.$transaction(async tx => {
    const archived = query.state === 'ARQUIVADOS';
    if (query.type === 'TOMADOR') {
      const where: Prisma.ClienteWhereInput = { ...(query.empresaId ? { empresaId: query.empresaId } : {}), AND: [
        archived ? { OR: [{ arquivadoEm: { not: null } }, { vinculos: { none: { arquivadoEm: null } } }] }
          : { arquivadoEm: null, vinculos: { some: { arquivadoEm: null } } },
        ...(query.search ? [{ OR: [{ nome: { contains: query.search, mode: 'insensitive' as const } },
          { documento: { contains: query.search } }, { email: { contains: query.search, mode: 'insensitive' as const } }] }] : []),
      ] };
      const total = await tx.cliente.count({ where });
      const rows = await tx.cliente.findMany({ where, skip, take: query.limit, select: adminCustomerSelect, orderBy: [{ nome: 'asc' }, { id: 'asc' }] });
      return { data: rows.map(({ nome, vinculos, ...row }) => ({ ...row, razaoSocial: nome, origem: 'TOMADOR' as const,
        archived: !!row.arquivadoEm || !vinculos.some(link => !link.arquivadoEm) })), meta: { ...query, total, totalPages: Math.max(1, Math.ceil(total / query.limit)) } };
    }
    const where: Prisma.EmpresaWhereInput = { arquivadoEm: archived ? { not: null } : null,
      ...(query.search ? { OR: [{ razaoSocial: { contains: query.search, mode: 'insensitive' as const } }, { documento: { contains: query.search } }] } : {}) };
    const total = await tx.empresa.count({ where });
    const rows = await tx.empresa.findMany({ where, skip, take: query.limit, select: adminCompanySelect, orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }] });
    return { data: rows.map(row => ({ ...row, origem: 'PRESTADOR' as const, archived: !!row.arquivadoEm })),
      meta: { ...query, total, totalPages: Math.max(1, Math.ceil(total / query.limit)) } };
  }, { isolationLevel: 'RepeatableRead' });
}

async function quotaParticipants(tx: Tx, empresaId: string) {
  const company = await tx.empresa.findUnique({ where: { id: empresaId }, select: { proprietarioUserId: true, donoFaturamentoId: true,
    donoUser: { select: { id: true } }, contadoresLink: { where: { status: 'APROVADO', arquivadoEm: null, contador: { role: 'CONTADOR' } }, take: 201, select: { contadorId: true } } } });
  if (!company) throw new AdminCompanyError('Empresa não encontrada.', 404);
  if (company.contadoresLink.length > 200) throw new AdminCompanyError('Empresa com muitos vínculos. Solicite revisão assistida.', 409);
  return [...new Set([company.proprietarioUserId, company.donoFaturamentoId, company.donoUser?.id,
    ...company.contadoresLink.map(link => link.contadorId)].filter((value): value is string => !!value))].sort();
}
function validateAddressPatch(data: Record<string, string | null>, exterior: boolean) {
  if (exterior) {
    if (data.codigoIbge) throw new AdminCompanyError('Tomador exterior não utiliza código IBGE nacional.');
    return;
  }
  if (data.cep !== undefined) {
    data.cep = data.cep?.replace('-', '') ?? null;
    if (data.cep && !/^\d{8}$/.test(data.cep)) throw new AdminCompanyError('CEP nacional inválido.');
  }
  if (data.uf !== undefined && data.uf !== null) {
    data.uf = data.uf.toUpperCase();
    if (data.uf && !'AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' ').includes(data.uf)) throw new AdminCompanyError('UF inválida.');
  }
  if (data.codigoIbge && !/^\d{7}$/.test(data.codigoIbge)) throw new AdminCompanyError('Código IBGE inválido.');
}
function assertVersion(actual: Date, expected: string) {
  if (actual.toISOString() !== expected) throw new AdminCompanyError('Cadastro alterado por outra operação. Recarregue e confira os dados antes de tentar novamente.', 409);
}

/** All writes share the company mutex with fiscal submissions. Reauthentication,
 * optimistic version, tenant scope, archive checks and audit commit together. */
export async function mutateAdminCompany(actorId: string, input: unknown, registry?: FiscalRegistryResult | null) {
  const mutation = parseAdminCompanyMutation(input);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const participants = mutation.action === 'RESTORE' ? await quotaParticipants(prisma, mutation.empresaId) : [];
      return await prisma.$transaction(async tx => {
        for (const userId of [...new Set([actorId, ...participants])].sort()) await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
        const actor = await tx.user.findUnique({ where: { id: actorId }, select: { role: true, senha: true } });
        if (!actor || !['ADMIN', 'MASTER'].includes(actor.role)) throw new AdminCompanyError('Acesso administrativo não permitido.', 403);
        if (!await bcrypt.compare(mutation.password, actor.senha)) throw new AdminCompanyError('Senha administrativa incorreta.', 403);
        await tx.$queryRaw`SELECT "id" FROM "Empresa" WHERE "id" = ${mutation.empresaId} FOR UPDATE`;
        const company = await tx.empresa.findUnique({ where: { id: mutation.empresaId }, select: { ...commonSelect, razaoSocial: true, regimeTributario: true,
          atividades: { take: 1, select: { id: true } } } });
        if (!company) throw new AdminCompanyError('Empresa não encontrada.', 404);
        if (mutation.action === 'RESTORE' && JSON.stringify(participants) !== JSON.stringify(await quotaParticipants(tx, company.id))) throw new AdminCompanyError('Vínculos alterados. Recarregue antes de restaurar.', 409);
        const archival = mutation.action === 'ARCHIVE' ? { arquivadoEm: new Date(), arquivadoPor: actorId, motivoArquivamento: mutation.justification }
          : { arquivadoEm: null, arquivadoPor: null, motivoArquivamento: null };
        let saved: { id: string; updatedAt: Date };
        if (mutation.origem === 'PRESTADOR') {
          assertVersion(company.updatedAt, mutation.version);
          if (mutation.action === 'RESTORE' ? !company.arquivadoEm : !!company.arquivadoEm) throw new AdminCompanyError('Situação alterada. Recarregue a lista.', 409);
          if (mutation.action === 'ARCHIVE') {
            const [notes, jobs, sales, drafts] = await Promise.all([
              tx.notaFiscal.count({ where: { empresaId: company.id } }), tx.emissaoJob.count({ where: { empresaId: company.id } }),
              tx.venda.count({ where: { empresaId: company.id } }), tx.notaRascunho.count({ where: { empresaId: company.id } }),
            ]);
            if (notes || jobs || sales || drafts) throw new AdminCompanyError('Empresa com histórico fiscal, vendas ou rascunhos não pode ser ocultada. Arquivamento não é cancelamento nem exclusão de dados.', 409);
          }
          if (mutation.action === 'RESTORE') {
            const restoredClients = await tx.vinculoCarteira.count({ where: { empresaId: company.id, arquivadoEm: null } });
            for (const userId of participants) {
              const limits = await getEffectivePlanLimits(userId, tx);
              const pending = await tx.contadorVinculo.count({ where: { contadorId: userId, status: { in: ['PENDENTE', 'PENDENTE_DONO', 'PENDENTE_CUSTODIANTE'] }, arquivadoEm: null, empresa: { arquivadoEm: null } } });
              if (!limits.unlimited && limits.empresasUsadas + pending >= limits.limiteEmpresas) throw new AdminCompanyError('Restauração excederia a cota de um responsável/vínculo. Regularize a capacidade e tente novamente.', 409);
              if (restoredClients && (!limits.allowedBase || (!limits.unlimited && limits.clientesUsados + restoredClients > limits.limiteClientes))) throw new AdminCompanyError('A carteira restaurada excederia a cota de clientes ou requer regularização do contrato de um responsável/vínculo.', 409);
            }
          }
          if (mutation.action === 'REFRESH' && (!registry || registry.data.documento !== company.documento
            || registry.payloadHash !== mutation.sourceHash)) throw new AdminCompanyError('A fonte pública mudou ou não confirmou este CNPJ. Consulte novamente antes de aplicar.', 409);
          const data = mutation.action === 'REFRESH' ? companyPublicRegistryPatch(registry!) : { ...mutation.data };
          if (mutation.action === 'REFRESH' && !data.razaoSocial) throw new AdminCompanyError('A fonte pública não retornou uma razão social válida.', 424);
          validateAddressPatch(data, false);
          const merged = { ...company, ...data };
          const cadastroCompleto = !!merged.razaoSocial && !!merged.regimeTributario && !!company.atividades.length &&
            ['cep', 'logradouro', 'numero', 'bairro', 'cidade', 'uf', 'codigoIbge'].every(key => !!(merged as Record<string, unknown>)[key]);
          saved = await tx.empresa.update({ where: { id: company.id }, data: {
            ...(['UPDATE', 'REFRESH'].includes(mutation.action)
              ? { ...(data as Prisma.EmpresaUpdateInput), cadastroCompleto, ...(mutation.action === 'REFRESH' ? { lastApiCheck: registry!.consultedAt } : {}) }
              : archival),
            updatedAt: new Date(Math.max(Date.now(), company.updatedAt.getTime() + 1)),
          }, select: { id: true, updatedAt: true } });
        } else {
          if (company.arquivadoEm) throw new AdminCompanyError('Restaure a empresa antes de alterar sua carteira.', 409);
          await tx.$queryRaw`SELECT "id" FROM "Cliente" WHERE "id" = ${mutation.id} FOR UPDATE`;
          const customer = await tx.cliente.findFirst({ where: { id: mutation.id, empresaId: company.id }, select: { id: true, updatedAt: true, arquivadoEm: true, tipo: true } });
          if (!customer) throw new AdminCompanyError('Tomador não encontrado nesta empresa. Nenhum vínculo foi alterado.', 404);
          assertVersion(customer.updatedAt, mutation.version);
          const link = await tx.vinculoCarteira.findUnique({ where: { empresaId_clienteId: { empresaId: company.id, clienteId: customer.id } }, select: { arquivadoEm: true } });
          const archived = !!customer.arquivadoEm || !link || !!link.arquivadoEm;
          if (mutation.action === 'RESTORE' ? !archived : archived) throw new AdminCompanyError('Situação da carteira alterada. Recarregue a lista.', 409);
          if (mutation.action === 'ARCHIVE') {
            const pending = await tx.emissaoJob.count({ where: { empresaId: company.id, clienteId: customer.id, OR: [
              { status: { notIn: ['AUTORIZADA', 'ERRO_FINAL'] } }, { creditReservation: { is: { status: 'RESERVED' } } },
              { transmissionStartedAt: { not: null }, status: 'ERRO_FINAL', OR: [{ creditReservation: { is: null } }, { creditReservation: { is: { status: { not: 'RELEASED' } } } }] },
            ] } });
            if (pending) throw new AdminCompanyError('Tomador com emissão pendente ou não conciliada. Conclua a análise antes de arquivar.', 409);
          }
          if (mutation.action === 'RESTORE') {
            if (!participants.length) throw new AdminCompanyError('Defina e verifique a responsabilidade pelo cadastro antes de restaurar a carteira.', 409);
            // An already active link was already counted, even in an inconsistent legacy record.
            if (!link || link.arquivadoEm) for (const userId of participants) {
              const limits = await getEffectivePlanLimits(userId, tx);
              if (!limits.allowedBase || (!limits.unlimited && limits.clientesUsados >= limits.limiteClientes)) throw new AdminCompanyError('Restauração excederia a cota de clientes ou não há contrato vigente de um responsável/vínculo.', 409);
            }
          }
          const { razaoSocial, ...data } = mutation.data; validateAddressPatch(data, customer.tipo === 'EXT');
          saved = await tx.cliente.update({ where: { id: customer.id }, data: {
            ...(mutation.action === 'UPDATE' ? { ...data, ...(razaoSocial === undefined ? {} : { nome: razaoSocial }) } : archival),
            updatedAt: new Date(Math.max(Date.now(), customer.updatedAt.getTime() + 1)),
          }, select: { id: true, updatedAt: true } });
          if (mutation.action !== 'UPDATE') await tx.vinculoCarteira.upsert({
            where: { empresaId_clienteId: { empresaId: company.id, clienteId: customer.id } },
            update: archival, create: { empresaId: company.id, clienteId: customer.id, ...archival },
          });
        }
        await tx.systemLog.create({ data: { userId: actorId, empresaId: company.id, level: 'ALERTA', module: 'EMPRESAS',
          action: `ADMIN_${mutation.origem}_${mutation.action}`, message: 'Manutenção administrativa com senha, versão e escopo conferidos; histórico preservado.',
          details: JSON.stringify({ targetId: mutation.id, justification: mutation.justification, previousVersion: mutation.version,
            newVersion: saved.updatedAt.toISOString(), fields: mutation.action === 'REFRESH' ? COMPANY_PUBLIC_FIELDS : Object.keys(mutation.data),
            ...(mutation.action === 'REFRESH' ? { fonte: registry!.fonte, sourceHash: registry!.payloadHash } : {}) }) } });
        return { success: true, id: saved.id, updatedAt: saved.updatedAt.toISOString() };
      }, { isolationLevel: 'ReadCommitted', timeout: 15000, maxWait: 5000 });
    } catch (error) {
      if ((error as { code?: string })?.code === 'P2034' && attempt < 2) continue;
      if ((error as { code?: string })?.code === 'P2034') throw new AdminCompanyError('Operação concorrente. Recarregue e tente novamente.', 409);
      throw error;
    }
  }
  throw new AdminCompanyError('Operação não concluída.', 409);
}
