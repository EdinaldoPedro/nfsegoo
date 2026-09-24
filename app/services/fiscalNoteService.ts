import { createHash, randomUUID } from 'node:crypto';
import type { FiscalNoteOperation, Prisma, User } from '@prisma/client';
import { prisma } from '@/app/utils/prisma';
import { hasCustomerCompanyAccess, isAdminRole, isSupportRole } from '@/app/utils/access-control';
import { fiscalCnpj, isNfseAccessKey } from '@/app/utils/fiscal-identifiers';
import { cancellationReason } from './emissor/validation/CancellationEvent';
import { fiscalXml } from './emissor/validation/FiscalXml';
import { originalNfseEnvironment, validateNfseDocument } from './emissor/validation/AuthorizedNfseValidator';

export const ACTIVE_NOTE_OPERATIONS = ['PENDENTE', 'PROCESSANDO', 'ERRO_TEMPORARIO', 'RECONCILIACAO_MANUAL'];
export function fiscalError(message: string, status = 409): never { throw Object.assign(new Error(message), { status }); }
export function fiscalXmlHash(value: string) { return createHash('sha256').update(fiscalXml(value)).digest('hex'); }
export const fiscalOperationSelect = { id: true, notaId: true, empresaId: true, tipo: true, ambiente: true, status: true, statusMessage: true,
  resultStatus: true, attempts: true, nextAttemptAt: true, createdAt: true, updatedAt: true, finishedAt: true } as const;
export function fiscalOperationDto(operation: FiscalNoteOperation) {
  return { id: operation.id, notaId: operation.notaId, tipo: operation.tipo, ambiente: operation.ambiente, status: operation.status,
    statusMessage: operation.statusMessage, resultStatus: operation.resultStatus, attempts: operation.attempts,
    nextAttemptAt: operation.nextAttemptAt, createdAt: operation.createdAt, updatedAt: operation.updatedAt, finishedAt: operation.finishedAt };
}

export async function canOperateFiscalNote(actor: Pick<User, 'id' | 'role' | 'empresaId'>, empresaId: string, tipo: string,
  tx: Prisma.TransactionClient = prisma, customerMode = false) {
  if (!customerMode && tipo === 'CONSULTAR' && isSupportRole(actor.role)) return true;
  return hasCustomerCompanyAccess(actor, empresaId, tx);
}

/** No fiscal HTTP or plan quota here. Cancellation/consultation preserve access
 * to past legal obligations even if a subscription has expired/exhausted. */
export async function enqueueFiscalNoteOperation(input: { actorId: string; notaId: string; tipo: 'CANCELAR' | 'CONSULTAR'; idempotencyKey?: unknown; reasonCode?: unknown; justification?: unknown; customerMode?: boolean }) {
  if (!['CANCELAR', 'CONSULTAR'].includes(input.tipo) || typeof input.notaId !== 'string' || !input.notaId || input.notaId.length > 100) fiscalError('Solicitação fiscal inválida.', 400);
  const actor = await prisma.user.findUnique({ where: { id: input.actorId } });
  const note = await prisma.notaFiscal.findUnique({ where: { id: input.notaId } });
  if (!actor || !note || !await canOperateFiscalNote(actor, note.empresaId, input.tipo, prisma, input.customerMode)) fiscalError('Nota não disponível para esta operação.', 403);
  if (!isNfseAccessKey(note.chaveAcesso) || note.arquivadoEm) fiscalError('Nota sem chave válida ou arquivada.');
  const reason = input.tipo === 'CANCELAR' ? cancellationReason(input.reasonCode, input.justification) : null;
  const key = input.idempotencyKey ?? (input.tipo === 'CONSULTAR' ? randomUUID() : '');
  if (typeof key !== 'string' || !/^[A-Za-z0-9:_-]{8,160}$/.test(key)) fiscalError('Identificador da solicitação obrigatório.', 400);
  const original = note.xmlAutorizadoBase64 || note.xmlBase64;
  let ambiente = note.ambiente;
  if (original) {
    let xmlEnvironment;
    try { xmlEnvironment = originalNfseEnvironment(original); }
    catch { fiscalError('Não foi possível identificar o ambiente no XML preservado. Solicite verificação ao suporte.'); }
    if (ambiente && ambiente !== xmlEnvironment) fiscalError('Ambiente registrado diverge do XML. É necessária conciliação.');
    ambiente = xmlEnvironment;
  }
  if (!ambiente || !['PRODUCAO', 'HOMOLOGACAO'].includes(ambiente)) fiscalError('Ambiente original desconhecido. Não será usado o ambiente atual da empresa.');
  const issuerDocument = fiscalCnpj(note.prestadorCnpj);
  if (!issuerDocument) fiscalError('Identidade fiscal original inválida para o esquema suportado.');
  if (input.tipo === 'CANCELAR') {
    if (!original) fiscalError('Recupere o XML autorizado antes de solicitar cancelamento.');
    try { await validateNfseDocument(original, ambiente, note.chaveAcesso, issuerDocument); }
    catch { fiscalError('O XML preservado não passou pela verificação fiscal. Nenhum cancelamento foi enviado; solicite análise ao suporte.'); }
  }
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${actor.id} FOR UPDATE`;
    await tx.$queryRaw`SELECT "id" FROM "Empresa" WHERE "id" = ${note.empresaId} FOR UPDATE`;
    await tx.$queryRaw`SELECT "id" FROM "NotaFiscal" WHERE "id" = ${note.id} FOR UPDATE`;
    const freshActor = await tx.user.findUniqueOrThrow({ where: { id: actor.id } });
    const current = await tx.notaFiscal.findUniqueOrThrow({ where: { id: note.id } });
    if (!await canOperateFiscalNote(freshActor, current.empresaId, input.tipo, tx, input.customerMode)) fiscalError('Permissão revogada.', 403);
    if (current.arquivadoEm || current.ambiente !== note.ambiente || current.empresaId !== note.empresaId || current.chaveAcesso !== note.chaveAcesso || current.xmlAutorizadoBase64 !== note.xmlAutorizadoBase64 || current.xmlBase64 !== note.xmlBase64 || current.prestadorCnpj !== note.prestadorCnpj) fiscalError('Nota alterada durante a solicitação. Atualize a tela.');
    const existing = await tx.fiscalNoteOperation.findUnique({ where: { notaId_idempotencyKey: { notaId: note.id, idempotencyKey: key } } });
    if (existing) {
      if (existing.actorUserId !== actor.id || existing.tipo !== input.tipo || existing.reasonCode !== (reason?.code || null) || existing.justification !== (reason?.justification || null)) fiscalError('Identificador já utilizado com outros dados.');
      return fiscalOperationDto(existing);
    }
    const active = await tx.fiscalNoteOperation.findFirst({ where: { OR: [{ notaId: note.id }, { ambiente: ambiente!, chaveAcesso: note.chaveAcesso! }], status: { in: ACTIVE_NOTE_OPERATIONS } } });
    if (active) {
      if (active.notaId === note.id && active.tipo === input.tipo && (!reason || active.reasonCode === reason.code && active.justification === reason.justification)) return fiscalOperationDto(active);
      fiscalError('A nota já possui uma operação pendente. Acompanhe o resultado antes de solicitar outra.');
    }
    if (input.tipo === 'CANCELAR' && current.status !== 'AUTORIZADA') fiscalError('Apenas nota autorizada pode receber nova solicitação de cancelamento.');
    const operation = await tx.fiscalNoteOperation.create({ data: { notaId: note.id, empresaId: note.empresaId, actorUserId: actor.id,
      tipo: input.tipo, ambiente: ambiente!, chaveAcesso: note.chaveAcesso!, issuerDocument, originalXmlHash: original ? fiscalXmlHash(original) : null,
      idempotencyKey: key, reasonCode: reason?.code, justification: reason?.justification,
      statusMessage: input.tipo === 'CANCELAR' ? 'Cancelamento solicitado. A nota permanece autorizada até confirmação fiscal.' : 'Consulta fiscal agendada; documentos locais preservados.' } });
    await tx.systemLog.create({ data: { level: 'INFO', action: 'FISCAL_NOTE_QUEUED', message: 'Operação fiscal registrada na fila durável.', userId: actor.id,
      empresaId: note.empresaId, vendaId: note.vendaId, details: JSON.stringify({ operationId: operation.id, tipo: operation.tipo, notaId: note.id, ambiente }) } });
    return fiscalOperationDto(operation);
  });
}

export async function requestFiscalDocument(tx: Prisma.TransactionClient, notaId: string, jobId?: string) {
  return tx.emissionDocumentTask.upsert({ where: { notaId }, create: { notaId, jobId }, update: {
    status: 'PENDENTE', attempts: 0, revision: { increment: 1 }, nextAttemptAt: null, completedAt: null, lastError: null, leaseToken: null, leaseUntil: null,
  } });
}

/** An administrator can only re-enable GET reconciliation. Never clear the
 * transmission marker, rewrite a request or authorize a fresh fiscal POST. */
export async function resumeFiscalNoteReconciliation(actorId: string, operationId: string, justification: string) {
  return prisma.$transaction(async (tx) => {
    const actor = await tx.user.findUnique({ where: { id: actorId }, select: { role: true } });
    if (!actor || !isAdminRole(actor.role)) fiscalError('Operação não permitida.', 403);
    const operation = await tx.fiscalNoteOperation.findUnique({ where: { id: operationId } });
    if (!operation || operation.status !== 'RECONCILIACAO_MANUAL'
      || (operation.tipo !== 'CONSULTAR' && (!operation.transmissionStartedAt || !operation.signedRequestXml))) fiscalError('Operação não elegível para conciliação. Nenhum pedido será reenviado.');
    const updated = await tx.fiscalNoteOperation.updateMany({ where: { id: operation.id, status: 'RECONCILIACAO_MANUAL' }, data: {
      status: 'ERRO_TEMPORARIO', nextAttemptAt: new Date(), maxAttempts: operation.attempts + 5,
      statusMessage: 'Conciliação solicitada pela administração. Apenas consultas serão realizadas.',
    } });
    if (!updated.count) fiscalError('A operação já foi retomada.');
    await tx.systemLog.create({ data: { level: 'ALERTA', action: 'FISCAL_NOTE_RECONCILE_REQUESTED',
      message: 'Conciliação GET-only solicitada, sem reenvio de pedido fiscal.', userId: actorId, empresaId: operation.empresaId,
      details: JSON.stringify({ operationId, notaId: operation.notaId, justification: justification.trim().slice(0, 500) }) } });
  });
}
