import { randomUUID } from 'node:crypto';
import type { FiscalNoteOperation, Prisma } from '@prisma/client';
import { C14nCanonicalization } from 'xml-crypto';
import { prisma } from '@/app/utils/prisma';
import { normalizeCnpj } from '@/app/utils/cnpj';
import { retryDelayMs } from '@/app/utils/emission-outcome';
import { EmissorFactory } from './emissor/factories/EmissorFactory';
import type { IEmissorStrategy, IResultadoCancelamento, IResultadoConsulta } from './emissor/interfaces/IEmissorStrategy';
import { cancellationReason, validateCancellationEvent } from './emissor/validation/CancellationEvent';
import { validateNfseDocument } from './emissor/validation/AuthorizedNfseValidator';
import { verifiedFiscalReference } from './emissor/validation/FiscalSignature';
import { fiscalXml, FISCAL_NS } from './emissor/validation/FiscalXml';
import { canOperateFiscalNote, fiscalError, fiscalXmlHash, requestFiscalDocument } from './fiscalNoteService';

export type LeasedNoteOperation = FiscalNoteOperation & { leaseToken: string };
export class LostNoteLease extends Error { constructor() { super('Posse da operação fiscal expirada.'); } }

export async function claimFiscalNoteOperation(allowProduction = false, noteIds?: string[], consultationsOnly = false): Promise<LeasedNoteOperation | null> {
  const token = randomUUID();
  const [operation] = await prisma.$queryRaw<LeasedNoteOperation[]>`
    WITH candidate AS (
      SELECT "id" FROM "FiscalNoteOperation" WHERE "status" IN ('PENDENTE','ERRO_TEMPORARIO','PROCESSANDO')
        AND (${!consultationsOnly} OR "tipo" = 'CONSULTAR')
        AND ("leaseUntil" IS NULL OR "leaseUntil" <= clock_timestamp())
        AND ("nextAttemptAt" IS NULL OR "nextAttemptAt" <= clock_timestamp())
        AND (${allowProduction} OR "ambiente" = 'HOMOLOGACAO' OR "tipo" = 'CONSULTAR' OR "transmissionStartedAt" IS NOT NULL)
        AND (${noteIds === undefined} OR "notaId" = ANY(${noteIds || []}::text[]))
      ORDER BY "createdAt", "id" FOR UPDATE SKIP LOCKED LIMIT 1
    ) UPDATE "FiscalNoteOperation" o SET "status" = 'PROCESSANDO', "leaseToken" = ${token},
      "leaseUntil" = clock_timestamp() + interval '120 seconds', "attempts" = "attempts" + 1,
      "nextAttemptAt" = NULL, "updatedAt" = clock_timestamp()
      FROM candidate WHERE o."id" = candidate."id" RETURNING o.*
  `;
  return operation || null;
}

export async function withNoteLease<T>(operation: Pick<LeasedNoteOperation, 'id' | 'leaseToken'>, action: (tx: Prisma.TransactionClient, current: FiscalNoteOperation) => Promise<T>) {
  return prisma.$transaction(async (tx) => {
    const [current] = await tx.$queryRaw<FiscalNoteOperation[]>`SELECT * FROM "FiscalNoteOperation" WHERE "id" = ${operation.id}
      AND "leaseToken" = ${operation.leaseToken} AND "status" = 'PROCESSANDO' AND "leaseUntil" > clock_timestamp() FOR UPDATE`;
    if (!current) throw new LostNoteLease();
    return action(tx, current);
  });
}

async function currentNote(tx: Prisma.TransactionClient, operation: FiscalNoteOperation) {
  await tx.$queryRaw`SELECT "id" FROM "NotaFiscal" WHERE "id" = ${operation.notaId} FOR UPDATE`;
  const note = await tx.notaFiscal.findUniqueOrThrow({ where: { id: operation.notaId } });
  if (note.empresaId !== operation.empresaId || note.chaveAcesso !== operation.chaveAcesso || normalizeCnpj(note.prestadorCnpj) !== operation.issuerDocument) fiscalError('Vínculo fiscal da nota alterado.');
  const original = note.xmlAutorizadoBase64 || note.xmlBase64;
  if (operation.originalXmlHash && (!original || fiscalXmlHash(original) !== operation.originalXmlHash)) fiscalError('XML original alterado após a solicitação.');
  return note;
}

async function authorizeBeforeRequest(tx: Prisma.TransactionClient, operation: FiscalNoteOperation) {
  await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${operation.actorUserId} FOR UPDATE`;
  await tx.$queryRaw`SELECT "id" FROM "Empresa" WHERE "id" = ${operation.empresaId} FOR UPDATE`;
  const actor = await tx.user.findUnique({ where: { id: operation.actorUserId } });
  const company = await tx.empresa.findUnique({ where: { id: operation.empresaId } });
  const note = await currentNote(tx, operation);
  if (!actor || !company || company.arquivadoEm || note.arquivadoEm || !await canOperateFiscalNote(actor, company.id, operation.tipo, tx)) fiscalError('Permissão revogada antes da operação fiscal.', 403);
  if (normalizeCnpj(company.documento) !== operation.issuerDocument) fiscalError('Identidade da empresa diverge da nota.');
  if (operation.tipo === 'CANCELAR' && note.status !== 'AUTORIZADA') fiscalError('A situação da nota mudou antes do envio.');
  return { ...company, documento: operation.issuerDocument, ambiente: operation.ambiente };
}

export async function failFiscalNoteOperation(operation: LeasedNoteOperation, definitive: boolean) {
  return withNoteLease(operation, async (tx, current) => {
    const status = definitive ? 'ERRO_FINAL' : current.attempts >= current.maxAttempts ? 'RECONCILIACAO_MANUAL' : 'ERRO_TEMPORARIO';
    const statusMessage = definitive ? 'Operação não concluída. Nota e documentos preservados; revise a solicitação.'
      : status === 'RECONCILIACAO_MANUAL' ? 'Resultado não confirmado. É necessária conciliação; não reenviar o cancelamento.'
        : current.transmissionStartedAt ? 'Consultando o evento original. Nenhum novo pedido será enviado.' : 'Operação pendente; nova verificação agendada.';
    await tx.fiscalNoteOperation.update({ where: { id: current.id }, data: { status, statusMessage,
      leaseToken: null, leaseUntil: null, nextAttemptAt: status === 'ERRO_TEMPORARIO' ? new Date(Date.now() + retryDelayMs(current.attempts)) : null,
      finishedAt: definitive ? new Date() : null } });
    await tx.systemLog.create({ data: { level: 'ALERTA', action: 'FISCAL_NOTE_' + status, message: statusMessage,
      userId: current.actorUserId, empresaId: current.empresaId, details: JSON.stringify({ operationId: current.id, notaId: current.notaId, transmitted: !!current.transmissionStartedAt }) } });
    // No credit reservation/usage is changed by cancelling or consulting a note.
    return status;
  });
}

export async function finishFiscalNoteOperation(operation: LeasedNoteOperation, result: IResultadoConsulta | IResultadoCancelamento) {
  return withNoteLease(operation, async (tx, current) => {
    const note = await currentNote(tx, current);
    const consultation = 'situacao' in result ? result : null;
    const cancelResult = !consultation ? result as IResultadoCancelamento : null;
    if (!result.sucesso) throw new Error('Resultado não confirmado.');
    const xml = consultation?.xmlDistribuicao || note.xmlAutorizadoBase64 || note.xmlBase64;
    const authorized = await validateNfseDocument(xml, current.ambiente, current.chaveAcesso, current.issuerDocument);
    const original = note.xmlAutorizadoBase64 || note.xmlBase64;
    if (original) {
      const canonical = (value: string) => new C14nCanonicalization().process(verifiedFiscalReference(fiscalXml(value), 'NFSe'), { ancestorNamespaces: [{ prefix: '', namespaceURI: FISCAL_NS }] });
      if (canonical(original) !== canonical(authorized.xml)) throw new Error('Documento consultado diverge do XML autorizado preservado.');
    }
    const wantsCancellation = current.tipo === 'CANCELAR' || consultation?.situacao === 'CANCELADA';
    let eventXml = wantsCancellation ? result.xmlEvento : note.xmlCancelamentoEventoBase64;
    let cancellation: Awaited<ReturnType<typeof validateCancellationEvent>> | null = null;
    if (wantsCancellation || note.status === 'CANCELADA' || eventXml) {
      cancellation = await validateCancellationEvent(eventXml, { key: current.chaveAcesso, ambiente: current.ambiente,
        preparedRequest: cancelResult?.requestMatched ? current.signedRequestXml || undefined : undefined });
      eventXml = cancellation.xmlEvento;
    }
    const status = cancellation ? 'CANCELADA' : 'AUTORIZADA';
    const changedStatus = note.status !== status;
    await tx.notaFiscal.update({ where: { id: note.id }, data: {
      status, ambiente: current.ambiente, numeroOficial: authorized.numero, numero: Number(authorized.numero) <= 2_147_483_647 ? Number(authorized.numero) : null,
      protocolo: authorized.protocolo, dataEmissao: authorized.dataEmissao,
      codigoServico: authorized.codigoServico, descricao: authorized.descricao, valor: authorized.valor,
      tomadorNome: authorized.tomadorNome, tomadorCnpj: authorized.tomadorDocumento, metadadosVerificadosEm: new Date(),
      xmlAutorizadoBase64: note.xmlAutorizadoBase64 || original || authorized.xml, xmlBase64: note.xmlBase64 || authorized.xml,
      xmlCancelamentoEventoBase64: cancellation ? eventXml : note.xmlCancelamentoEventoBase64,
      dataCancelamento: cancellation?.dataCancelamento || note.dataCancelamento,
      ...(changedStatus ? { pdfBase64: null } : {}),
    } });
    if (note.vendaId) {
      const sale = await tx.venda.findUniqueOrThrow({ where: { id: note.vendaId } });
      if (sale.empresaId !== current.empresaId) throw new Error('Venda fora da empresa da nota.');
      await tx.venda.update({ where: { id: sale.id }, data: { status: status === 'CANCELADA' ? 'CANCELADA' : current.ambiente === 'HOMOLOGACAO' ? 'HOMOLOGACAO_VALIDADA' : 'CONCLUIDA' } });
    }
    if (changedStatus || !note.pdfBase64) await requestFiscalDocument(tx, note.id);
    const statusMessage = status === 'CANCELADA' ? 'Cancelamento confirmado por evento fiscal. XML original preservado.' : 'Consulta concluída. XML autorizado preservado.';
    await tx.fiscalNoteOperation.update({ where: { id: current.id }, data: { status: 'CONCLUIDA', statusMessage, resultStatus: status,
      leaseToken: null, leaseUntil: null, nextAttemptAt: null, finishedAt: new Date() } });
    await tx.systemLog.create({ data: { level: 'INFO', action: 'FISCAL_NOTE_CONFIRMED', message: statusMessage, userId: current.actorUserId,
      empresaId: current.empresaId, vendaId: note.vendaId, details: JSON.stringify({ operationId: current.id, notaId: note.id, eventId: cancellation?.eventId, requestMatched: cancelResult?.requestMatched, status }) } });
    if (changedStatus) {
      const recipients = await tx.user.findMany({ where: { OR: [
        { empresaId: note.empresaId }, { empresasProprietarias: { some: { id: note.empresaId, arquivadoEm: null } } },
        { clientes: { some: { empresaId: note.empresaId, revokedAt: null } } }, { empresasContabeis: { some: { empresaId: note.empresaId, status: 'APROVADO', arquivadoEm: null } } },
      ], AND: [{ OR: [{ role: { in: ['COMUM','CONTADOR'] } }, { id: current.actorUserId }] }] }, select: { id: true } });
      await tx.appNotification.createMany({ skipDuplicates: true, data: recipients.map(({ id }) => ({ recipientId: id, empresaId: note.empresaId, vendaId: note.vendaId, notaId: note.id,
        type: status === 'CANCELADA' ? 'NOTA_CANCELADA' : 'NOTA_AUTORIZADA', title: status === 'CANCELADA' ? 'Cancelamento confirmado' : 'Situação fiscal confirmada', message: statusMessage,
        eventKey: `fiscal-note:${current.id}:${status}`, priority: 'NORMAL', payloadJson: JSON.stringify({ notaId: note.id, operationId: current.id }) })) });
    }
    return status;
  });
}

/** The only fiscal POST for a note operation occurs after a persisted marker.
 * All recoveries after that boundary are GET-only, including after a crash. */
export async function processFiscalNoteOperation(claimed: LeasedNoteOperation, suppliedStrategy?: IEmissorStrategy) {
  let operation = claimed;
  const heartbeat = setInterval(() => { void prisma.$executeRaw`UPDATE "FiscalNoteOperation" SET "leaseUntil" = clock_timestamp() + interval '120 seconds'
    WHERE "id" = ${operation.id} AND "leaseToken" = ${operation.leaseToken} AND "status" = 'PROCESSANDO' AND "leaseUntil" > clock_timestamp()`.catch(() => {}); }, 20_000);
  heartbeat.unref();
  try {
    let company;
    if (operation.transmissionStartedAt) {
      const storedCompany = await prisma.empresa.findUniqueOrThrow({ where: { id: operation.empresaId } });
      company = { ...storedCompany, ambiente: operation.ambiente, documento: operation.issuerDocument };
    } else company = await withNoteLease(operation, (tx, current) => authorizeBeforeRequest(tx, current));
    const strategy = suppliedStrategy || EmissorFactory.getStrategy(company);
    let result: IResultadoConsulta | IResultadoCancelamento;
    if (operation.tipo === 'CONSULTAR') result = await strategy.consultar(operation.chaveAcesso, company);
    else if (operation.transmissionStartedAt) {
      if (!operation.signedRequestXml) throw new Error('Pedido transmitido sem XML preparado.');
      result = await strategy.conciliarCancelamento(operation.signedRequestXml, operation.chaveAcesso, company);
    } else {
      if (!operation.signedRequestXml) {
        const xml = await strategy.prepararCancelamento(operation.chaveAcesso, cancellationReason(operation.reasonCode, operation.justification), new Date(), company);
        operation = await withNoteLease(operation, async (tx, current) => tx.fiscalNoteOperation.update({ where: { id: current.id }, data: { signedRequestXml: xml } })) as LeasedNoteOperation;
      }
      company = await withNoteLease(operation, async (tx, current) => {
        const fresh = await authorizeBeforeRequest(tx, current);
        await tx.fiscalNoteOperation.update({ where: { id: current.id }, data: { transmissionStartedAt: new Date(), statusMessage: 'Pedido registrado para envio. Aguardando confirmação fiscal.' } });
        return fresh;
      });
      result = await strategy.transmitirCancelamento(operation.signedRequestXml!, operation.chaveAcesso, company);
    }
    if (result.sucesso) await finishFiscalNoteOperation(operation, result);
    else await failFiscalNoteOperation(operation, 'failureKind' in result && ['LOCAL_REJECTION','PORTAL_REJECTION'].includes(result.failureKind || ''));
  } catch (error) {
    if (error instanceof LostNoteLease) return;
    const fresh = await prisma.fiscalNoteOperation.findUnique({ where: { id: operation.id }, select: { transmissionStartedAt: true } });
    const definitive = !fresh?.transmissionStartedAt && [400,403].includes(Number((error as { status?: number })?.status));
    try { await failFiscalNoteOperation(operation, definitive); } catch (failure) { if (!(failure instanceof LostNoteLease)) throw failure; }
  } finally { clearInterval(heartbeat); }
}
