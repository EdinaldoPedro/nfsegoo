import bcrypt from 'bcryptjs';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/app/utils/prisma';
import { CommercialError } from '@/app/utils/commercial-pricing';
import { parseCompanyRegistration, registerCompanyInTransaction } from './companyRegistrationService';

type Tx = Prisma.TransactionClient;
export const accountCompanySelect = { id: true, documento: true, razaoSocial: true, ambiente: true,
  arquivadoEm: true, updatedAt: true } satisfies Prisma.EmpresaSelect;

/** Explicitly reject old payloads, even when mixed with another recognized action. */
export function assertNoLegacyCompanyMutation(input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new CommercialError('Informe uma operação JSON válida.');
  if (['newCnpj', 'unlinkCompany', 'addEmpresaProprietaria', 'removeEmpresaProprietariaId', 'empresaId', 'proprietarioUserId', 'donoFaturamentoId', 'contadorCustodianteId'].some(key => Object.hasOwn(input, key))) {
    throw new CommercialError('Este atalho de vínculo foi encerrado. Atualize a tela e use Empresas da conta. CNPJ existente e titularidade não podem ser substituídos por esta operação.', 409);
  }
}

function identifier(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-z0-9_-]{1,100}$/i.test(value)) throw new CommercialError('Identificador inválido. Atualize a tela.');
  return value;
}
export function parseAccountCompanyQuery(query: URLSearchParams) {
  const integer = (key: string, fallback: number, max: number) => {
    const raw = query.get(key) ?? String(fallback);
    if (!/^[1-9]\d{0,5}$/.test(raw) || Number(raw) > max) throw new CommercialError(`Parâmetro ${key} inválido.`);
    return Number(raw);
  };
  const search = (query.get('search') ?? '').trim();
  if (search.length > 120 || Array.from(search).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) throw new CommercialError('Busca inválida (máximo 120 caracteres).');
  return { page: integer('page', 1, 100000), limit: integer('limit', 10, 25), search };
}
export function parseAccountCompanyMutation(input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new CommercialError('Informe um objeto de dados válido.');
  const body = input as Record<string, unknown>;
  const allowed = body.action === 'REGISTER_NEW' ? ['action', 'documento', 'razaoSocial', 'adminPassword', 'justification']
    : ['action', 'empresaId', 'expectedUserUpdatedAt', 'adminPassword', 'justification'];
  if (Object.keys(body).some(key => !allowed.includes(key))) throw new CommercialError('Campos não permitidos. Cadastro, principal e titularidade são operações separadas.');
  if (body.action !== 'REGISTER_NEW' && body.action !== 'SET_PRIMARY') throw new CommercialError('Operação inválida.');
  if (typeof body.adminPassword !== 'string' || !body.adminPassword || Buffer.byteLength(body.adminPassword, 'utf8') > 72) throw new CommercialError('Informe sua senha administrativa atual (até 72 bytes).');
  if (typeof body.justification !== 'string' || body.justification.trim().length < 10 || body.justification.length > 2000 || Array.from(body.justification).some(char => (char.charCodeAt(0) < 32 && !['\n', '\r', '\t'].includes(char)) || char.charCodeAt(0) === 127)) throw new CommercialError('Informe uma justificativa entre 10 e 2.000 caracteres.');
  const authorization = { password: body.adminPassword, justification: body.justification.trim() };
  if (body.action === 'REGISTER_NEW') return { action: body.action, company: parseCompanyRegistration({ documento: body.documento, razaoSocial: body.razaoSocial }), ...authorization } as const;
  const version = body.expectedUserUpdatedAt;
  if (typeof version !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(version) || !Number.isFinite(Date.parse(version)) || new Date(version).toISOString() !== version) throw new CommercialError('Versão da conta ausente ou inválida. Recarregue antes de confirmar.');
  return { action: body.action, empresaId: body.empresaId === null ? null : identifier(body.empresaId), version, ...authorization } as const;
}

async function accounts(tx: Tx, actorId: string, targetId: string, reauthenticate = false) {
  const actor = await tx.user.findUnique({ where: { id: actorId }, select: { role: true, senha: reauthenticate } });
  if (!actor || !['MASTER', 'ADMIN'].includes(actor.role)) throw new CommercialError('Acesso administrativo não permitido.', 403);
  const target = await tx.user.findUnique({ where: { id: targetId }, select: { id: true, nome: true, role: true, empresaId: true, updatedAt: true } });
  if (!target) throw new CommercialError('Conta não encontrada.', 404);
  if (!['COMUM', 'CONTADOR'].includes(target.role)) throw new CommercialError('A conta deve ter o papel atual de cliente ou contador. Salve o acesso antes de cadastrar empresas.', 409);
  return { actor, target };
}

/** No certificate, fiscal document or other tenant's ownership data is loaded. */
export async function listAccountCompanies(actorId: string, targetId: string, query: URLSearchParams) {
  identifier(targetId);
  const { page, limit, search } = parseAccountCompanyQuery(query);
  return prisma.$transaction(async tx => {
    const { target } = await accounts(tx, actorId, targetId);
    const where: Prisma.EmpresaWhereInput = { proprietarioUserId: target.id,
      ...(search ? { OR: [{ razaoSocial: { contains: search, mode: 'insensitive' } }, { documento: { contains: search, mode: 'insensitive' } }] } : {}) };
    const [companies, total, primary] = await Promise.all([
      tx.empresa.findMany({ where, select: accountCompanySelect, orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }], take: limit, skip: (page - 1) * limit }),
      tx.empresa.count({ where }),
      target.empresaId ? tx.empresa.findUnique({ where: { id: target.empresaId }, select: { ...accountCompanySelect, proprietarioUserId: true } }) : null,
    ]);
    const { proprietarioUserId, ...safePrimary } = primary ?? {};
    return { data: companies, primary: primary ? safePrimary : null,
      account: { ...target, canChangePrimary: !primary || proprietarioUserId === target.id },
      meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) } };
  }, { isolationLevel: 'RepeatableRead' });
}

/** The only operations here are NEW registration and changing a preference among
 * already owned companies. Transfer/recovery cannot be inferred from a public CNPJ. */
export async function mutateAccountCompany(actorId: string, targetId: string, input: unknown) {
  identifier(targetId);
  const mutation = parseAccountCompanyMutation(input);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await prisma.$transaction(async tx => {
        for (const userId of [...new Set([actorId, targetId])].sort()) await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
        const { actor, target } = await accounts(tx, actorId, targetId, true);
        if (!await bcrypt.compare(mutation.password, actor.senha)) throw new CommercialError('Senha administrativa incorreta.', 403);
        if (mutation.action === 'REGISTER_NEW') {
          return { success: true, ...await registerCompanyInTransaction(tx, target.id, mutation.company, { actorId, justification: mutation.justification }) };
        }
        if (target.updatedAt.toISOString() !== mutation.version) throw new CommercialError('Conta alterada por outra operação. Recarregue e confira a empresa principal.', 409);
        const companyIds = [...new Set([target.empresaId, mutation.empresaId].filter((value): value is string => !!value))].sort();
        for (const companyId of companyIds) await tx.$queryRaw`SELECT "id" FROM "Empresa" WHERE "id" = ${companyId} FOR UPDATE`;
        const companies = await tx.empresa.findMany({ where: { id: { in: companyIds } }, select: { id: true, proprietarioUserId: true, arquivadoEm: true,
          donoUser: { select: { id: true } } } });
        const current = companies.find(company => company.id === target.empresaId);
        // A legacy primary link may be the sole ownership/access anchor. Removing
        // it would orphan history; it requires a separate, verified recovery flow.
        if (target.empresaId && (!current || current.proprietarioUserId !== target.id)) throw new CommercialError('O vínculo principal legado precisa de revisão de titularidade. Nenhum acesso ou histórico foi removido.', 409);
        if (mutation.empresaId) {
          const chosen = companies.find(company => company.id === mutation.empresaId);
          if (!chosen || chosen.arquivadoEm || chosen.proprietarioUserId !== target.id || (chosen.donoUser && chosen.donoUser.id !== target.id)) throw new CommercialError('Selecione uma empresa ativa já pertencente a esta conta e sem outro vínculo principal. Nenhuma titularidade foi transferida.', 409);
        }
        if (target.empresaId === mutation.empresaId) return { success: true, changed: false, empresaId: target.empresaId, updatedAt: target.updatedAt.toISOString() };
        const updated = await tx.user.update({ where: { id: target.id }, data: { empresaId: mutation.empresaId,
          updatedAt: new Date(Math.max(Date.now(), target.updatedAt.getTime() + 1)) }, select: { updatedAt: true } });
        await tx.systemLog.create({ data: { level: 'ALERTA', action: 'USER_PRIMARY_COMPANY_SELECTED', module: 'EMPRESAS', userId: actorId,
          empresaId: mutation.empresaId ?? target.empresaId, message: 'Empresa principal alterada somente entre cadastros já pertencentes à conta. Propriedade, faturamento e histórico preservados.',
          details: JSON.stringify({ targetUserId: target.id, previousCompanyId: target.empresaId, nextCompanyId: mutation.empresaId,
            previousVersion: mutation.version, justification: mutation.justification }) } });
        return { success: true, changed: true, empresaId: mutation.empresaId, updatedAt: updated.updatedAt.toISOString() };
      }, { isolationLevel: 'ReadCommitted', timeout: 15000, maxWait: 5000 });
    } catch (error) {
      const code = (error as { code?: string })?.code;
      if (code === 'P2034' && attempt < 2) continue;
      if (code === 'P2034' || code === 'P2002') throw new CommercialError('Cadastro ou vínculo alterado por outra operação. Recarregue e confira antes de tentar novamente.', 409);
      throw error;
    }
  }
  throw new CommercialError('Operação não concluída.', 409);
}
