import { commercialTransaction } from './commercialService';
import { CommercialError } from '@/app/utils/commercial-pricing';
import { normalizeCnpj, validarCNPJ } from '@/app/utils/cnpj';
import { getEffectivePlanLimits } from './planService';
import type { Prisma } from '@prisma/client';
import { hasCustomerAccountCapability } from '@/app/utils/access-control';

export function parseCompanyRegistration(input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new CommercialError('Informe CNPJ e razão social.');
  const body = input as Record<string, unknown>;
  if (Object.keys(body).some(key => !['documento', 'razaoSocial'].includes(key))) throw new CommercialError('Somente CNPJ e razão social são permitidos no cadastro inicial.');
  const documento = normalizeCnpj(body.documento);
  if (!validarCNPJ(documento)) throw new CommercialError('CNPJ inválido. Confira o formato e os dígitos verificadores.');
  const name = typeof body.razaoSocial === 'string' ? body.razaoSocial.trim() : '';
  if (name.length < 2 || name.length > 200 || Array.from(name).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) throw new CommercialError('Informe uma razão social entre 2 e 200 caracteres, sem caracteres de controle.');
  return { documento, razaoSocial: name };
}

/** Caller MUST hold the recipient User row lock. This creates NEW, empty records;
 * it cannot establish ownership of existing fiscal data, including orphan records. */
export async function registerCompanyInTransaction(tx: Prisma.TransactionClient, userId: string,
  input: ReturnType<typeof parseCompanyRegistration>, administrative?: { actorId: string; justification: string }) {
    const { documento, razaoSocial: name } = parseCompanyRegistration(input);
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true, role: true, empresaId: true } });
    if (!await hasCustomerAccountCapability(user, tx)) throw new CommercialError('Use uma conta cliente ou uma conta titular de empresa.', 403);
    const existing = await tx.empresa.findUnique({ where: { documento }, select: {
      id: true, documento: true, razaoSocial: true, ambiente: true, proprietarioUserId: true, arquivadoEm: true,
    } });
    if (existing) {
      if (!existing.arquivadoEm && existing.proprietarioUserId === userId) return {
        created: false, empresa: { id: existing.id, documento: existing.documento, razaoSocial: existing.razaoSocial, ambiente: existing.ambiente },
      };
      // Never claim an orphan/archived/custodied company based on a public CNPJ.
      throw new CommercialError('Não foi possível vincular este CNPJ. Solicite a verificação de titularidade ao atendimento.', 409);
    }
    const limits = await getEffectivePlanLimits(userId, tx);
    if (!limits.allowedBase) throw new CommercialError(limits.reason || 'Assinatura não vigente.', 403);
    const pending = user.role === 'CONTADOR' ? await tx.contadorVinculo.count({ where: { contadorId: userId,
      status: { in: ['PENDENTE', 'PENDENTE_DONO', 'PENDENTE_CUSTODIANTE'] }, arquivadoEm: null, empresa: { arquivadoEm: null } } }) : 0;
    if (!limits.unlimited && limits.empresasUsadas + pending >= limits.limiteEmpresas) throw new CommercialError('Limite de empresas atingido, incluindo solicitações pendentes. Consulte os benefícios ou pacotes adicionais.', 403);
    const empresa = await tx.empresa.create({ data: { documento, razaoSocial: name,
      donoFaturamentoId: userId, proprietarioUserId: userId, statusPropriedade: 'PROPRIETARIA',
      ambiente: 'HOMOLOGACAO', cadastroCompleto: false }, select: { id: true, documento: true, razaoSocial: true, ambiente: true } });
    await tx.systemLog.create({ data: { level: 'INFO', action: administrative ? 'ADMIN_NEW_COMPANY_REGISTERED' : 'ADDITIONAL_COMPANY_REGISTERED', module: 'EMPRESAS', userId: administrative?.actorId ?? userId,
      empresaId: empresa.id, message: 'Nova empresa em homologação registrada dentro da cota. Certificado e cadastro fiscal ainda precisam de validação.',
      ...(administrative ? { details: JSON.stringify({ targetUserId: userId, justification: administrative.justification }) } : {}) } });
    return { created: true, empresa };
}

/** Creating a new record is not proof of ownership of any existing fiscal data. */
export async function registerAdditionalCompany(userId: string, input: unknown) {
  const company = parseCompanyRegistration(input);
  return commercialTransaction(userId, tx => registerCompanyInTransaction(tx, userId, company));
}
