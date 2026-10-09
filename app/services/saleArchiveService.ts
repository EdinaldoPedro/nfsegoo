import { prisma } from '@/app/utils/prisma';
import { hasCustomerCompanyAccess, isAdminRole } from '@/app/utils/access-control';
import { fiscalError } from './fiscalNoteService';

/** Archiving is not fiscal cancellation. Never hide an authorized/cancelled
 * document, an uncertain transmission, or an outstanding credit reservation. */
export async function archiveSale(actorId: string, saleId: string, administrative = false, justification?: string) {
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
    const reason = administrative && justification?.trim()
      ? justification.trim()
      : 'Arquivamento sem nota válida ou emissão em andamento.';
    const data = { arquivadoEm: new Date(), arquivadoPor: actorId, motivoArquivamento: reason };
    await tx.notaFiscal.updateMany({ where: { vendaId: sale.id }, data });
    await tx.venda.update({ where: { id: sale.id }, data: { ...data, status: 'DESCARTADA' } });
    await tx.systemLog.create({ data: { level: 'INFO', action: 'VENDA_ARQUIVADA', message: 'Venda arquivada após verificar obrigações fiscais.', userId: actorId, empresaId: sale.empresaId, vendaId: sale.id, details: JSON.stringify({ administrative, justification: administrative ? reason : undefined }) } });
  });
}

/** Removes a completed homologation test from operational listings without
 * deleting its documents or weakening the production-document safeguards. */
export async function archiveHomologationSale(actorId: string, saleId: string, justification: string) {
  const sale = await prisma.venda.findUnique({ where: { id: saleId }, select: { id: true, empresaId: true } });
  if (!sale) fiscalError('Venda não disponível.', 404);
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${actorId} FOR UPDATE`;
    await tx.$queryRaw`SELECT "id" FROM "Empresa" WHERE "id" = ${sale.empresaId} FOR UPDATE`;
    await tx.$queryRaw`SELECT "id" FROM "Venda" WHERE "id" = ${sale.id} FOR UPDATE`;

    const actor = await tx.user.findUnique({ where: { id: actorId }, select: { role: true } });
    if (!actor || !isAdminRole(actor.role)) fiscalError('Operação permitida somente para administradores.', 403);

    const current = await tx.venda.findUniqueOrThrow({ where: { id: sale.id } });
    if (current.empresaId !== sale.empresaId) fiscalError('Vínculo da venda alterado.');
    if (current.arquivadoEm) return;

    const notes = await tx.notaFiscal.findMany({
      where: { vendaId: sale.id },
      select: { id: true, ambiente: true, status: true, chaveAcesso: true },
    });
    const jobs = await tx.emissaoJob.findMany({
      where: { vendaId: sale.id },
      select: { id: true, ambiente: true, status: true, creditReservation: { select: { status: true } } },
    });
    const isHomologationOnly = (notes.length > 0 || jobs.length > 0)
      && notes.every((note) => note.ambiente === 'HOMOLOGACAO')
      && jobs.every((job) => job.ambiente === 'HOMOLOGACAO');
    if (!isHomologationOnly) {
      fiscalError('Somente vendas com artefatos exclusivamente de homologação podem ser ocultadas.', 409);
    }
    const hasUnsettledJob = jobs.some((job) => job.ambiente !== 'HOMOLOGACAO'
      || ['PENDENTE', 'PROCESSANDO', 'ERRO_TEMPORARIO', 'RECONCILIACAO_MANUAL'].includes(job.status)
      || job.creditReservation?.status === 'RESERVED');
    const hasActiveOperation = await tx.fiscalNoteOperation.count({
      where: { notaId: { in: notes.map((note) => note.id) }, status: { in: ['PENDENTE', 'PROCESSANDO', 'ERRO_TEMPORARIO', 'RECONCILIACAO_MANUAL'] } },
    });
    if (hasUnsettledJob || hasActiveOperation) {
      fiscalError('O teste possui emissão ou operação fiscal ainda não conciliada e não pode ser ocultado.', 409);
    }

    const archivedAt = new Date();
    const reason = 'Teste de homologação ocultado administrativamente; documentos e rastreabilidade preservados.';
    const archiveData = { arquivadoEm: archivedAt, arquivadoPor: actorId, motivoArquivamento: reason };
    await tx.notaFiscal.updateMany({ where: { vendaId: sale.id }, data: archiveData });
    await tx.venda.update({ where: { id: sale.id }, data: { ...archiveData, status: 'DESCARTADA' } });
    await tx.systemLog.create({
      data: {
        level: 'ALERTA',
        action: 'HOMOLOGACAO_OCULTADA',
        module: 'FISCAL',
        message: 'Teste concluído de homologação ocultado das listagens administrativas e do cliente.',
        userId: actorId,
        empresaId: sale.empresaId,
        vendaId: sale.id,
        details: JSON.stringify({ justification, archivedAt: archivedAt.toISOString(), noteIds: notes.map((note) => note.id), jobIds: jobs.map((job) => job.id) }),
      },
    });
  });
}
