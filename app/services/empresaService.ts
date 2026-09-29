import type { Prisma } from '@prisma/client';
import { prisma } from '@/app/utils/prisma';
import { CommercialError } from '@/app/utils/commercial-pricing';
import { normalizeCnpj, validarCNPJ } from '@/app/utils/cnpj';
import { commercialTransaction } from './commercialService';
import { getEffectivePlanLimits } from './planService';
import { consultPublicCompanyRegistry } from './publicCompanyRegistryService';

const pendingStatuses = ['PENDENTE', 'PENDENTE_DONO', 'PENDENTE_CUSTODIANTE'];

async function lookupNewCompany(documento: string) {
  const registry = await consultPublicCompanyRegistry(documento);
  if (registry.status === 'NOT_FOUND') throw new CommercialError('CNPJ não encontrado nas fontes cadastrais públicas. Confira o número informado. Nenhuma empresa foi alterada.', 422);
  if (registry.status === 'INVALID_RESPONSE') throw new CommercialError('A fonte cadastral devolveu dados inválidos ou incompletos. Nenhuma empresa foi alterada.', 502);
  if (registry.status !== 'FOUND') throw new CommercialError('Consulta cadastral temporariamente indisponível. Tente novamente em alguns minutos. Nenhuma empresa foi alterada.', 503);
  const publicData = registry.data;
  const data = { razaoSocial: publicData.razaoSocial, nomeFantasia: publicData.nomeFantasia || publicData.razaoSocial,
    email: publicData.emailPublico, cep: publicData.cep, logradouro: publicData.logradouro, numero: publicData.numero,
    complemento: publicData.complemento, bairro: publicData.bairro, cidade: publicData.cidade, uf: publicData.uf,
    codigoIbge: publicData.codigoIbge, cadastroCompleto: false };
  return { data, cnaes: publicData.atividades.map(item => ({ ...item, descricao: item.descricao || 'CNAE cadastral' })),
    source: registry.source, consultedAt: registry.consultedAt };
}

/** Requesting an accounting link must never update or expose another tenant.
 * Existing records require owner/custodian approval, including orphan records. */
export async function upsertEmpresaAndLinkUser(documento: string, userId: string, _dadosManuais?: unknown, _userRole?: string) {
  const doc = normalizeCnpj(documento);
  if (!validarCNPJ(doc)) throw new CommercialError('CNPJ inválido. Confira os dígitos verificadores.');
  const actor = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
  if (actor?.role !== 'CONTADOR') throw new CommercialError('Apenas contadores podem solicitar vínculos.', 403);
  const known = await prisma.empresa.findUnique({ where: { documento: doc }, select: { id: true } });
  const lookup = known ? null : await lookupNewCompany(doc);
  return commercialTransaction(userId, async (tx) => {
    const contador = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { role: true } });
    if (contador.role !== 'CONTADOR') throw new CommercialError('O papel da conta foi alterado. Entre novamente.', 403);
    const existingId = await tx.empresa.findUnique({ where: { documento: doc }, select: { id: true } });
    if (existingId) await tx.$queryRaw`SELECT "id" FROM "Empresa" WHERE "id" = ${existingId.id} FOR UPDATE`;
    const existing = existingId ? await tx.empresa.findUniqueOrThrow({ where: { id: existingId.id }, select: {
      id: true, arquivadoEm: true, proprietarioUserId: true, contadorCustodianteId: true,
      donoUser: { select: { id: true } },
    } }) : null;
    if (existing?.arquivadoEm) throw new CommercialError('Cadastro requer revisão pelo atendimento.', 409);
    const previous = existing ? await tx.contadorVinculo.findUnique({ where: { contadorId_empresaId: { contadorId: userId, empresaId: existing.id } } }) : null;
    if (previous && !previous.arquivadoEm && ['APROVADO', ...pendingStatuses].includes(previous.status)) return { id: existing!.id, _statusVinculo: previous.status, reused: true };
    const limits = await getEffectivePlanLimits(userId, tx);
    if (!limits.allowedBase) throw new CommercialError(limits.reason || 'Assinatura não vigente.', 403);
    const pendingCount = await tx.contadorVinculo.count({ where: { contadorId: userId, status: { in: pendingStatuses }, arquivadoEm: null, empresa: { arquivadoEm: null } } });
    if (!limits.unlimited && limits.empresasUsadas + pendingCount >= limits.limiteEmpresas) throw new CommercialError('Limite de empresas atingido, incluindo solicitações pendentes.', 403);
    let status = 'APROVADO';
    let companyId: string;
    if (existing) {
      companyId = existing.id;
      const owner = existing.proprietarioUserId || existing.donoUser?.id;
      status = owner && owner !== userId ? 'PENDENTE_DONO'
        : owner === userId || existing.contadorCustodianteId === userId ? 'APROVADO' : 'PENDENTE_CUSTODIANTE';
      // No company update or CNAE overwrite here: even an orphan has protected history.
    } else {
      if (!lookup) throw new CommercialError('Cadastro mudou durante a solicitação. Tente novamente.', 409);
      const company = await tx.empresa.create({ data: { documento: doc, ...lookup.data, ambiente: 'HOMOLOGACAO',
        donoFaturamentoId: userId, contadorCustodianteId: userId, statusPropriedade: 'CUSTODIADA',
        modoCobranca: 'RESPONSAVEL_UNICO', lastApiCheck: lookup.consultedAt }, select: { id: true } });
      companyId = company.id;
      if (lookup.cnaes.length) await tx.cnae.createMany({ data: lookup.cnaes.map((item) => ({ ...item, empresaId: companyId })) as Prisma.CnaeCreateManyInput[] });
    }
    await tx.contadorVinculo.upsert({ where: { contadorId_empresaId: { contadorId: userId, empresaId: companyId } },
      create: { contadorId: userId, empresaId: companyId, status, clientePodeAcessarPortal: false, nivelPortal: 'NENHUM' },
      update: { status, arquivadoEm: null, arquivadoPor: null, motivoArquivamento: null, clientePodeAcessarPortal: false, nivelPortal: 'NENHUM' } });
    await tx.systemLog.create({ data: { level: 'INFO', action: existing ? 'ACCOUNTANT_LINK_REQUESTED' : 'ACCOUNTANT_COMPANY_CREATED',
      module: 'VINCULOS', userId, empresaId: companyId, message: 'Solicitação de vínculo contábil processada sem transferência de propriedade.',
      details: JSON.stringify({ status, existing: !!existing, registrySource: lookup?.source || null }) } });
    return { id: companyId, _statusVinculo: status, reused: false };
  });
}
