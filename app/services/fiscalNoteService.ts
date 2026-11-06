import { createHash, randomUUID } from 'node:crypto';
import type { FiscalNoteOperation, Prisma, User } from '@prisma/client';
import { prisma } from '@/app/utils/prisma';
import { hasCustomerCompanyAccess, isAdminRole, isSupportRole } from '@/app/utils/access-control';
import { fiscalCnpj, isNfseAccessKey } from '@/app/utils/fiscal-identifiers';
import { cancellationReason } from './emissor/validation/CancellationEvent';
import { fiscalXml } from './emissor/validation/FiscalXml';
import { originalNfseEnvironment, validateNfseDocument } from './emissor/validation/AuthorizedNfseValidator';
import { EmissorFactory } from './emissor/factories/EmissorFactory';
import type { IEmissorStrategy, IResultadoCancelamento } from './emissor/interfaces/IEmissorStrategy';

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

const CANCELLATION_EVENT_TYPES = ['101101', '105102', '105104', '305101'];

function confirmsCancellationEventAbsence(result: IResultadoCancelamento) {
  const diagnostic = result.portalDiagnostic;
  if (result.sucesso || diagnostic?.stage !== 'CANCEL_EVENT_LOOKUP' || diagnostic.category !== 'CANCELLATION_EVENT_ABSENT') return false;
  const checks = diagnostic.eventChecks || [];
  return CANCELLATION_EVENT_TYPES.every((type) => checks.some((check) => check.type === type && check.status === 404));
}

/** Administrative terminal path for an old, ambiguous cancellation POST.
 * It performs two GET-only complete checks before releasing the local lock.
 * A discovered event is never ignored: the operation is requeued for the
 * normal worker to validate and persist the official cancellation XML. */
export async function closeUnconfirmedCancellation(actorId: string, operationId: string, justification: string, suppliedStrategy?: IEmissorStrategy) {
  const reason = String(justification || '').trim();
  if (reason.length < 10 || reason.length > 2000) fiscalError('Informe uma justificativa de 10 a 2.000 caracteres.', 400);
  const [actor, operation] = await Promise.all([
    prisma.user.findUnique({ where: { id: actorId }, select: { role: true } }),
    prisma.fiscalNoteOperation.findUnique({ where: { id: operationId }, include: { nota: { select: { status: true, vendaId: true } } } }),
  ]);
  if (!actor || !isAdminRole(actor.role)) fiscalError('Operação não permitida.', 403);
  if (!operation || operation.tipo !== 'CANCELAR' || !['ERRO_TEMPORARIO', 'RECONCILIACAO_MANUAL'].includes(operation.status)
    || !operation.transmissionStartedAt || !operation.signedRequestXml || operation.nota.status !== 'AUTORIZADA') {
    fiscalError('Cancelamento não elegível para encerramento administrativo. Atualize a bancada.', 409);
  }
  const storedCompany = await prisma.empresa.findUnique({ where: { id: operation.empresaId } });
  if (!storedCompany || storedCompany.arquivadoEm) fiscalError('Empresa indisponível para a conferência fiscal.', 409);
  const company = { ...storedCompany, ambiente: operation.ambiente, documento: operation.issuerDocument };
  const strategy = suppliedStrategy || EmissorFactory.getStrategy(company);

  const first = await strategy.conciliarCancelamento(operation.signedRequestXml, operation.chaveAcesso, company);
  if (!first.sucesso && !confirmsCancellationEventAbsence(first)) fiscalError('O Portal não confirmou a ausência dos eventos. A conciliação continuará bloqueada.', 409);
  if (!first.sucesso) await new Promise((resolve) => setTimeout(resolve, 1500));
  const second = first.sucesso ? first : await strategy.conciliarCancelamento(operation.signedRequestXml, operation.chaveAcesso, company);

  if (second.sucesso) {
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "FiscalNoteOperation" WHERE "id" = ${operation.id} FOR UPDATE`;
      const current = await tx.fiscalNoteOperation.findUniqueOrThrow({ where: { id: operation.id } });
      if (!['ERRO_TEMPORARIO', 'RECONCILIACAO_MANUAL'].includes(current.status)) fiscalError('A operação mudou durante a conferência. Atualize a bancada.', 409);
      await tx.fiscalNoteOperation.update({ where: { id: current.id }, data: { status: 'ERRO_TEMPORARIO', nextAttemptAt: new Date(),
        maxAttempts: current.attempts + 2, finishedAt: null, statusMessage: 'Evento oficial localizado. Conclusão do cancelamento agendada.' } });
      await tx.systemLog.create({ data: { level: 'INFO', action: 'FISCAL_CANCELLATION_EVENT_FOUND', userId: actorId,
        empresaId: current.empresaId, vendaId: operation.nota.vendaId, message: 'Evento oficial localizado na conferência administrativa; persistência agendada no worker.',
        details: JSON.stringify({ operationId: current.id, notaId: current.notaId, justification: reason }) } });
    });
    return { outcome: 'EVENT_FOUND' as const };
  }
  if (!confirmsCancellationEventAbsence(second)) fiscalError('A segunda consulta não confirmou a ausência dos eventos. A conciliação continuará bloqueada.', 409);

  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "FiscalNoteOperation" WHERE "id" = ${operation.id} FOR UPDATE`;
    await tx.$queryRaw`SELECT "id" FROM "NotaFiscal" WHERE "id" = ${operation.notaId} FOR UPDATE`;
    const [current, note] = await Promise.all([
      tx.fiscalNoteOperation.findUniqueOrThrow({ where: { id: operation.id } }),
      tx.notaFiscal.findUniqueOrThrow({ where: { id: operation.notaId } }),
    ]);
    if (!['ERRO_TEMPORARIO', 'RECONCILIACAO_MANUAL'].includes(current.status) || note.status !== 'AUTORIZADA' || note.chaveAcesso !== current.chaveAcesso) {
      fiscalError('A situação fiscal mudou durante a conferência. Atualize a bancada.', 409);
    }
    const statusMessage = 'Conciliação encerrada: duas consultas completas não localizaram evento de cancelamento. A nota permanece autorizada e uma nova solicitação foi liberada.';
    await tx.fiscalNoteOperation.update({ where: { id: current.id }, data: { status: 'ERRO_FINAL', resultStatus: 'AUTORIZADA',
      statusMessage, nextAttemptAt: null, leaseToken: null, leaseUntil: null, finishedAt: new Date() } });
    await tx.systemLog.create({ data: { level: 'ALERTA', action: 'FISCAL_CANCELLATION_CLOSED_AS_NOT_CANCELLED', userId: actorId,
      empresaId: current.empresaId, vendaId: note.vendaId, message: statusMessage,
      details: JSON.stringify({ operationId: current.id, notaId: current.notaId, justification: reason,
        firstCheck: first.portalDiagnostic, secondCheck: second.portalDiagnostic }) } });
    await tx.appNotification.createMany({ skipDuplicates: true, data: [{ recipientId: current.actorUserId, empresaId: current.empresaId,
      vendaId: note.vendaId, notaId: note.id, type: 'CANCELAMENTO_NAO_CONCLUIDO', title: 'Nota permanece autorizada', message: statusMessage,
      eventKey: `fiscal-note:${current.id}:CLOSED_AS_NOT_CANCELLED`, priority: 'HIGH', payloadJson: JSON.stringify({ notaId: note.id, operationId: current.id }) }] });
  });
  return { outcome: 'CLOSED_AS_NOT_CANCELLED' as const };
}
