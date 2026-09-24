import type { Prisma } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { prisma } from '@/app/utils/prisma';
import {
  FISCAL_ENTITY_PUBLIC_FIELDS, effectiveFiscalEntity, ensureCanonicalFiscalEntity,
  type FiscalEntityPublicField, type FiscalRegistryResult,
} from './fiscalEntityService';

export class AdminFiscalEntityError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

const limits: Record<FiscalEntityPublicField, number> = {
  razaoSocial: 200, nomeFantasia: 200, situacaoCadastral: 100, cep: 11, logradouro: 200,
  numero: 20, complemento: 100, bairro: 100, cidade: 100, uf: 2, pais: 100, codigoIbge: 7,
};

function identifier(input: unknown) {
  if (typeof input !== 'string' || !/^[a-z0-9_-]{1,100}$/i.test(input)) throw new AdminFiscalEntityError('Identidade fiscal inválida.');
  return input;
}

function text(input: unknown, field: FiscalEntityPublicField) {
  if (input === null || input === '') return null;
  // eslint-disable-next-line no-control-regex -- cadastro fiscal rejeita bytes de controle.
  if (typeof input !== 'string' || input.trim().length > limits[field] || /[\u0000-\u001f\u007f]/.test(input)) throw new AdminFiscalEntityError(`Campo ${field} inválido.`);
  const value = input.trim();
  if (field === 'razaoSocial' && value.length < 2) throw new AdminFiscalEntityError('Razão social deve ter ao menos dois caracteres.');
  if (field === 'cep' && value && !/^\d{8}$/.test(value.replace(/\D/g, ''))) throw new AdminFiscalEntityError('CEP inválido.');
  if (field === 'codigoIbge' && value && !/^\d{7}$/.test(value)) throw new AdminFiscalEntityError('Código IBGE inválido.');
  if (field === 'uf' && value && !'AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' ').includes(value.toUpperCase())) throw new AdminFiscalEntityError('UF inválida.');
  return field === 'uf' ? value.toUpperCase() : field === 'cep' ? value.replace(/\D/g, '') : value;
}

export function parseAdminFiscalEntityQuery(search: URLSearchParams) {
  const page = Number(search.get('page') || 1); const limit = Number(search.get('limit') || 20);
  const query = search.get('search') || '';
  if (!Number.isSafeInteger(page) || page < 1 || page > 100_000 || !Number.isSafeInteger(limit) || limit < 1 || limit > 50 || query.length > 120) throw new AdminFiscalEntityError('Parâmetros de consulta inválidos.');
  return { page, limit, search: query.trim() };
}

export function parseAdminFiscalEntityMutation(input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AdminFiscalEntityError('Operação inválida.');
  const body = input as Record<string, unknown>;
  if (Object.keys(body).some(key => !['id', 'expectedVersion', 'action', 'data', 'fields', 'adminPassword', 'justification', 'sourceHash'].includes(key))) throw new AdminFiscalEntityError('Campos não permitidos na operação.');
  const id = identifier(body.id);
  const expectedVersion = Number(body.expectedVersion);
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) throw new AdminFiscalEntityError('Versão da identidade fiscal inválida. Recarregue a tela.');
  if (!['CORRECT', 'RESET', 'REFRESH'].includes(String(body.action))) throw new AdminFiscalEntityError('Ação administrativa inválida.');
  const action = body.action as 'CORRECT' | 'RESET' | 'REFRESH';
  const password = typeof body.adminPassword === 'string' ? body.adminPassword : '';
  const justification = typeof body.justification === 'string' ? body.justification.trim() : '';
  if (!password || Buffer.byteLength(password, 'utf8') > 72) throw new AdminFiscalEntityError('Informe sua senha administrativa atual.');
  // eslint-disable-next-line no-control-regex -- permite quebras de linha, mas rejeita outros controles.
  if (justification.length < 10 || justification.length > 2000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(justification)) throw new AdminFiscalEntityError('Informe uma justificativa entre 10 e 2.000 caracteres.');
  const data: Partial<Record<FiscalEntityPublicField, string | null>> = {};
  if (action === 'CORRECT') {
    if (!body.data || typeof body.data !== 'object' || Array.isArray(body.data)) throw new AdminFiscalEntityError('Informe as correções públicas.');
    for (const [field, value] of Object.entries(body.data as Record<string, unknown>)) {
      if (!(FISCAL_ENTITY_PUBLIC_FIELDS as readonly string[]).includes(field)) throw new AdminFiscalEntityError('Documento, e-mail, telefone e inscrições particulares não podem ser corrigidos nesta base.');
      data[field as FiscalEntityPublicField] = text(value, field as FiscalEntityPublicField);
    }
    if (!Object.keys(data).length) throw new AdminFiscalEntityError('Informe ao menos uma correção.');
  }
  let fields: FiscalEntityPublicField[] = [];
  if (action === 'RESET') {
    if (!Array.isArray(body.fields) || !body.fields.length || body.fields.some(field => typeof field !== 'string' || !(FISCAL_ENTITY_PUBLIC_FIELDS as readonly string[]).includes(field))) throw new AdminFiscalEntityError('Selecione correções válidas para remover.');
    fields = [...new Set(body.fields as FiscalEntityPublicField[])];
  }
  const sourceHash = typeof body.sourceHash === 'string' ? body.sourceHash : '';
  if (action === 'REFRESH' && !/^[a-f0-9]{64}$/.test(sourceHash)) throw new AdminFiscalEntityError('A prévia da fonte pública expirou ou é inválida. Consulte novamente.');
  if (action !== 'REFRESH' && body.sourceHash !== undefined) throw new AdminFiscalEntityError('A prévia pública só pode ser usada para aplicar uma atualização consultada.');
  return { id, expectedVersion, action, data, fields, password, justification, sourceHash };
}

export async function listAdminFiscalEntities(search: URLSearchParams) {
  const query = parseAdminFiscalEntityQuery(search); const skip = (query.page - 1) * query.limit;
  const where: Prisma.EntidadeFiscalWhereInput = query.search ? { OR: [
    { documento: { contains: query.search } }, { razaoSocial: { contains: query.search, mode: 'insensitive' } },
    { nomeFantasia: { contains: query.search, mode: 'insensitive' } },
    { correcoes: { some: { campo: { in: ['razaoSocial', 'nomeFantasia'] }, valor: { contains: query.search, mode: 'insensitive' } } } },
  ] } : {};
  const [rows, total] = await prisma.$transaction([
    prisma.entidadeFiscal.findMany({ where, skip, take: query.limit, orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
      include: { correcoes: { select: { campo: true, valor: true, updatedAt: true } }, _count: { select: { clientes: true } } } }),
    prisma.entidadeFiscal.count({ where }),
  ]);
  return { data: rows.map(row => {
    const effective = effectiveFiscalEntity(row);
    return Object.fromEntries([...Object.entries({ id: row.id, documento: row.documento, version: row.version,
      fonte: row.fonte, fonteConsultadaEm: row.fonteConsultadaEm, updatedAt: row.updatedAt,
      relacionamentos: row._count.clientes, camposCorrigidos: row.correcoes.map(item => item.campo) }),
      ...FISCAL_ENTITY_PUBLIC_FIELDS.map(field => [field, effective[field]])]);
  }), meta: { ...query, total, totalPages: Math.max(1, Math.ceil(total / query.limit)) } };
}

export async function mutateAdminFiscalEntity(actorId: string, input: unknown, registry?: FiscalRegistryResult | null) {
  const mutation = parseAdminFiscalEntityMutation(input);
  return prisma.$transaction(async tx => {
    const actor = await tx.user.findUnique({ where: { id: actorId }, select: { role: true, senha: true } });
    if (!actor || !['ADMIN', 'MASTER'].includes(actor.role)) throw new AdminFiscalEntityError('Acesso administrativo não permitido.', 403);
    if (!await bcrypt.compare(mutation.password, actor.senha)) throw new AdminFiscalEntityError('Senha administrativa incorreta.', 403);
    await tx.$queryRaw`SELECT "id" FROM "EntidadeFiscal" WHERE "id" = ${mutation.id} FOR UPDATE`;
    const entity = await tx.entidadeFiscal.findUnique({ where: { id: mutation.id }, include: { correcoes: true } });
    if (!entity) throw new AdminFiscalEntityError('Identidade fiscal não encontrada.', 404);
    if (entity.version !== mutation.expectedVersion) throw new AdminFiscalEntityError('Cadastro alterado por outra operação. Recarregue antes de salvar.', 409);
    if (mutation.action === 'REFRESH') {
      if (!registry || registry.data.documento !== entity.documento) throw new AdminFiscalEntityError('A fonte pública não confirmou este CNPJ. Nenhum dado foi alterado.', 503);
      const refreshed = await ensureCanonicalFiscalEntity(tx, entity.documento, registry.data, registry, actorId);
      await tx.systemLog.create({ data: { level: 'INFO', module: 'ENTIDADES_FISCAIS', action: 'ADMIN_ENTIDADE_FISCAL_REFRESH',
        userId: actorId, message: 'Consulta pública da identidade fiscal concluída após reautenticação administrativa.',
        details: JSON.stringify({ entidadeFiscalId: entity.id, documento: entity.documento, previousVersion: entity.version,
          newVersion: refreshed.version, justification: mutation.justification, changed: refreshed.version !== entity.version }) } });
      return { success: true, id: refreshed.id, version: refreshed.version };
    }
    if (mutation.action === 'CORRECT') for (const [campo, valor] of Object.entries(mutation.data)) {
      await tx.entidadeFiscalCorrecao.upsert({ where: { entidadeFiscalId_campo: { entidadeFiscalId: entity.id, campo } },
        create: { entidadeFiscalId: entity.id, campo, valor, justificativa: mutation.justification, actorUserId: actorId },
        update: { valor, justificativa: mutation.justification, actorUserId: actorId, version: { increment: 1 } } });
    }
    if (mutation.action === 'RESET') await tx.entidadeFiscalCorrecao.deleteMany({ where: { entidadeFiscalId: entity.id, campo: { in: mutation.fields } } });
    const saved = await tx.entidadeFiscal.update({ where: { id: entity.id }, data: { version: { increment: 1 }, eventos: { create: {
      origem: mutation.action === 'CORRECT' ? 'CORRECAO_ADMIN' : 'REMOCAO_CORRECAO_ADMIN', actorUserId: actorId,
      camposAlterados: JSON.stringify(mutation.action === 'CORRECT' ? Object.keys(mutation.data) : mutation.fields),
      snapshotJson: JSON.stringify(mutation.action === 'CORRECT' ? mutation.data : { removed: mutation.fields }),
    } } }, select: { id: true, version: true } });
    await tx.systemLog.create({ data: { level: 'ALERTA', module: 'ENTIDADES_FISCAIS', action: `ADMIN_ENTIDADE_FISCAL_${mutation.action}`,
      userId: actorId, message: 'Manutenção da identidade fiscal global registrada com reautenticação e justificativa.',
      details: JSON.stringify({ entidadeFiscalId: entity.id, documento: entity.documento, fields: mutation.action === 'CORRECT' ? Object.keys(mutation.data) : mutation.fields,
        previousVersion: entity.version, newVersion: saved.version, justification: mutation.justification }) } });
    return { success: true, id: saved.id, version: saved.version };
  }, { isolationLevel: 'ReadCommitted', timeout: 15_000, maxWait: 5_000 });
}
