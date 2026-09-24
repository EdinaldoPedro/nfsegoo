import { prisma } from '@/app/utils/prisma';
import { hasCustomerCompanyAccess, isAdminRole } from '@/app/utils/access-control';
import { fiscalError } from './fiscalNoteService';

/** Archiving is not fiscal cancellation. Never hide an authorized/cancelled
 * document, an uncertain transmission, or an outstanding credit reservation. */
export async function archiveSale(actorId: string, saleId: string, administrative = false) {
  const sale = await prisma.venda.findUnique({ where: { id: saleId }, select: { id: true, empresaId: true } });
  if (!sale) fiscalError('Venda não disponível.', 404);
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${actorId} FOR UPDATE`;
    await tx.$queryRaw`SELECT "id" FROM "Empresa" WHERE "id" = ${sale.empresaId} FOR UPDATE`;
    await tx.$queryRaw`SELECT "id" FROM "Venda" WHERE "id" = ${sale.id} FOR UPDATE`;
    const actor = await tx.user.findUnique({ where: { id: actorId } });
    if (!actor || (administrative ? !isAdminRole(actor.role) : !await hasCustomerCompanyAccess(actor, sale.empresaId, tx))) fiscalError('Operação não permitida.', 403);
    const current = await tx.venda.findUniqueOrThrow({ where: { id: sale.id } });
    if (current.empresaId !== sale.empresaId) fiscalError('Vínculo da venda alterado.');
    const official = await tx.notaFiscal.count({ where: { vendaId: sale.id, OR: [{ status: { in: ['AUTORIZADA', 'CANCELADA'] } }, { chaveAcesso: { not: null } }] } });
    const jobs = await tx.emissaoJob.findMany({ where: { vendaId: sale.id }, select: { status: true, transmissionStartedAt: true, creditReservation: { select: { status: true } } } });
    if (official || jobs.some((job) => job.status !== 'ERRO_FINAL' || job.creditReservation?.status === 'RESERVED' || (job.transmissionStartedAt && job.creditReservation?.status !== 'RELEASED'))) fiscalError('Venda com obrigação fiscal ou emissão não conciliada não pode ser arquivada.');
    if (current.arquivadoEm) return;
    const data = { arquivadoEm: new Date(), arquivadoPor: actorId, motivoArquivamento: 'Arquivamento sem nota válida ou emissão em andamento.' };
    await tx.notaFiscal.updateMany({ where: { vendaId: sale.id }, data });
    await tx.venda.update({ where: { id: sale.id }, data: { ...data, status: 'DESCARTADA' } });
    await tx.systemLog.create({ data: { level: 'INFO', action: 'VENDA_ARQUIVADA', message: 'Venda arquivada após verificar obrigações fiscais.', userId: actorId, empresaId: sale.empresaId, vendaId: sale.id, details: JSON.stringify({ administrative }) } });
  });
}
