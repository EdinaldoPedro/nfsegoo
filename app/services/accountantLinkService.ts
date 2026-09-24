import { prisma } from '@/app/utils/prisma';
import { isAdminRole } from '@/app/utils/access-control';
import { CommercialError } from '@/app/utils/commercial-pricing';
import { commercialTransaction } from './commercialService';
import { getEffectivePlanLimits } from './planService';

export type LinkAction = 'APROVAR' | 'LIBERAR_ACESSO' | 'TRANSFERIR_CUSTODIA' | 'REJEITAR' | 'REVOGAR';
const pending = ['PENDENTE', 'PENDENTE_DONO', 'PENDENTE_CUSTODIANTE'];

export function validateLinkDecision(input: { action: unknown; status: string; archived: boolean;
  actorIsAdmin: boolean; actorIsOwner: boolean; actorIsCustodian: boolean; actorIsRequester: boolean }) {
  const action = input.action;
  if (!['APROVAR', 'LIBERAR_ACESSO', 'TRANSFERIR_CUSTODIA', 'REJEITAR', 'REVOGAR'].includes(String(action))) throw new CommercialError('Ação de vínculo inválida.');
  const mayManage = input.actorIsAdmin || input.actorIsOwner || input.actorIsCustodian;
  if (action === 'REVOGAR') {
    if (!mayManage && !input.actorIsRequester) throw new CommercialError('Sem permissão para revogar este vínculo.', 403);
    if (!input.archived && !['APROVADO', ...pending].includes(input.status)) throw new CommercialError('Vínculo já encerrado.', 409);
    return;
  }
  if (!mayManage || (input.actorIsRequester && !input.actorIsOwner && !input.actorIsAdmin)) throw new CommercialError('Somente titular, custodiante principal ou administrador pode decidir.', 403);
  if (input.archived || !pending.includes(input.status)) throw new CommercialError('Solicitação já resolvida. Atualize a página.', 409);
  if (input.status !== 'PENDENTE_CUSTODIANTE' && !input.actorIsOwner && !input.actorIsAdmin) throw new CommercialError('Esta solicitação depende do titular da empresa.', 403);
  if (action === 'TRANSFERIR_CUSTODIA' && input.status !== 'PENDENTE_CUSTODIANTE') throw new CommercialError('Esta solicitação não é uma transferência de custódia.', 409);
}

export async function decideAccountantLink(input: { actorId: string; linkId: unknown; action: unknown;
  adminReauthenticated?: boolean; customerMode?: boolean; justification?: string }) {
  if (typeof input.linkId !== 'string' || !input.linkId || input.linkId.length > 100) throw new CommercialError('Vínculo inválido.');
  const reference = await prisma.contadorVinculo.findUnique({ where: { id: input.linkId }, select: { contadorId: true, empresaId: true } });
  if (!reference) throw new CommercialError('Vínculo não encontrado.', 404);
  return commercialTransaction(reference.contadorId, async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Empresa" WHERE "id" = ${reference.empresaId} FOR UPDATE`;
    const link = await tx.contadorVinculo.findUniqueOrThrow({ where: { id: String(input.linkId) } });
    const [actor, requester, company] = await Promise.all([
      tx.user.findUnique({ where: { id: input.actorId }, select: { role: true } }),
      tx.user.findUniqueOrThrow({ where: { id: link.contadorId }, select: { role: true, empresaId: true } }),
      tx.empresa.findUniqueOrThrow({ where: { id: link.empresaId }, select: { arquivadoEm: true, proprietarioUserId: true,
        contadorCustodianteId: true, donoFaturamentoId: true, donoUser: { select: { id: true } } } }),
    ]);
    const admin = isAdminRole(actor?.role) && !input.customerMode;
    if (!actor || (admin && !input.adminReauthenticated)) throw new CommercialError('Reautenticação administrativa obrigatória.', 403);
    if (company.arquivadoEm) throw new CommercialError('Empresa arquivada. Revise o cadastro antes de modificar vínculos.', 409);
    const ownerId = company.proprietarioUserId || company.donoUser?.id;
    validateLinkDecision({ action: input.action, status: link.status, archived: !!link.arquivadoEm, actorIsAdmin: admin,
      actorIsOwner: ownerId === input.actorId, actorIsCustodian: actor.role === 'CONTADOR' && company.contadorCustodianteId === input.actorId,
      actorIsRequester: link.contadorId === input.actorId });
    const closing = input.action === 'REJEITAR' || input.action === 'REVOGAR';
    const now = new Date();
    if (!closing) {
      if (requester.role !== 'CONTADOR') throw new CommercialError('O solicitante não é mais contador.', 409);
      const limits = await getEffectivePlanLimits(link.contadorId, tx);
      const alreadyCounted = ownerId === link.contadorId || company.donoFaturamentoId === link.contadorId || requester.empresaId === link.empresaId;
      if (!limits.allowedBase || (!alreadyCounted && limits.empresasUsadas >= limits.limiteEmpresas)) throw new CommercialError('O contador precisa de assinatura vigente e limite de empresas disponível.', 409);
    }
    if (closing) {
      await tx.contadorVinculo.update({ where: { id: link.id }, data: { status: input.action === 'REVOGAR' ? 'DESVINCULADO' : 'REJEITADO',
        arquivadoEm: now, arquivadoPor: input.actorId, motivoArquivamento: input.justification || 'Encerramento solicitado pelo usuário autorizado.' } });
      if (company.contadorCustodianteId === link.contadorId) await tx.empresa.update({ where: { id: link.empresaId }, data: {
        contadorCustodianteId: null,
        ...(company.donoFaturamentoId === link.contadorId && ownerId !== link.contadorId ? { donoFaturamentoId: null } : {}),
      } });
    } else {
      await tx.contadorVinculo.update({ where: { id: link.id }, data: { status: 'APROVADO', arquivadoEm: null, arquivadoPor: null, motivoArquivamento: null } });
      if (input.action === 'TRANSFERIR_CUSTODIA') {
        const previous = company.contadorCustodianteId;
        if (previous && previous !== link.contadorId) await tx.contadorVinculo.updateMany({
          where: { empresaId: link.empresaId, contadorId: previous, status: 'APROVADO', arquivadoEm: null },
          data: { status: 'DESVINCULADO', arquivadoEm: now, arquivadoPor: input.actorId, motivoArquivamento: 'Custódia transferida explicitamente.' },
        });
        await tx.empresa.update({ where: { id: link.empresaId }, data: { contadorCustodianteId: link.contadorId,
          ...(!ownerId ? { statusPropriedade: 'CUSTODIADA' } : {}),
          ...(!company.donoFaturamentoId || company.donoFaturamentoId === previous ? { donoFaturamentoId: link.contadorId } : {}),
        } });
      }
    }
    await tx.systemLog.create({ data: { level: 'ALERTA', module: 'VINCULOS', action: 'ACCOUNTANT_LINK_DECISION', userId: input.actorId,
      empresaId: link.empresaId, message: 'Decisão explícita de acesso contábil; propriedade da empresa preservada.',
      details: JSON.stringify({ linkId: link.id, action: input.action, previousStatus: link.status, requesterId: link.contadorId,
        previousCustodianId: company.contadorCustodianteId, justification: input.justification }) } });
    return { success: true, message: closing ? 'Vínculo encerrado. Dados históricos preservados.' : 'Vínculo aprovado conforme a ação escolhida.' };
  });
}
