import type { EmissaoJob, Prisma } from '@prisma/client';
import { prisma } from '@/app/utils/prisma';
import { hasCustomerCompanyAccess, isAdminRole } from '@/app/utils/access-control';
import { emissionFailureState, retryDelayMs } from '@/app/utils/emission-outcome';
import { consumeEmissionCredit, releaseEmissionCredit, resolveBillingUserId } from './planService';
import { prepararEmissaoJob } from './emissaoJobService';
import { EmissorFactory } from './emissor/factories/EmissorFactory';
import type { IEmissorStrategy, IResultadoEmissao } from './emissor/interfaces/IEmissorStrategy';
import { preparedDpsId, validateAuthorizedNfse } from './emissor/validation/AuthorizedNfseValidator';
import { LeasedEmission, LostEmissionLease, renewEmissionLease, reserveJobDps, withEmissionLease } from './emissionLeaseService';
import { requestFiscalDocument } from './fiscalNoteService';
import { lockCanonicalDpsSequence } from './dpsSequenceStore';
import { normalizeDpsNumber } from '@/app/utils/dps-identity';

async function validateBeforeTransmission(tx: Prisma.TransactionClient, job: EmissaoJob) {
  await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${job.actorUserId} FOR UPDATE`;
  await tx.$queryRaw`SELECT "id" FROM "Empresa" WHERE "id" = ${job.empresaId} FOR UPDATE`;
  const actor = await tx.user.findUnique({ where: { id: job.actorUserId } });
  const company = await tx.empresa.findUnique({ where: { id: job.empresaId } });
  if (!actor || !company || company.arquivadoEm ||
      !await hasCustomerCompanyAccess(actor, job.empresaId, tx) || company.ambiente !== job.ambiente) {
    throw Object.assign(new Error('Permissão, empresa ou ambiente alterado antes da transmissão. Revise a solicitação.'), { status: 403 });
  }
  const billing = await resolveBillingUserId({ empresaId: job.empresaId, actorUserId: actor.id, acao: 'EMITIR' }, tx);
  const payer = await tx.user.findUnique({ where: { id: billing }, select: { planoStatus: true, role: true } });
  if (billing !== job.billingUserId || !payer || payer.planoStatus === 'suspended') {
    throw Object.assign(new Error('Responsável financeiro alterado ou suspenso. Revise a emissão.'), { status: 403 });
  }
  if (job.ambiente === 'PRODUCAO') {
    const credit = job.creditReservationId ? await tx.emissionCreditReservation.findUnique({ where: { id: job.creditReservationId } }) : null;
    if (job.billingUnlimited) {
      if (credit || !isAdminRole(payer.role)) throw Object.assign(new Error('Benefício administrativo alterado. Revise a emissão.'), { status: 403 });
    } else if (!credit || credit.status !== 'RESERVED' || credit.userId !== billing) {
      throw Object.assign(new Error('Reserva de crédito indisponível.'), { status: 400 });
    }
  }
  if (job.preparedMetadataJson && JSON.parse(job.preparedMetadataJson).prestadorDocumento !== company.documento) {
    throw Object.assign(new Error('Identidade fiscal alterada após a preparação. Revise o cadastro.'), { status: 400 });
  }
  return company;
}

async function notifyInTransaction(tx: Prisma.TransactionClient, job: EmissaoJob, status: string, message: string, notaId?: string) {
  const recipients = await tx.user.findMany({ where: { OR: [
    { empresaId: job.empresaId }, { empresasProprietarias: { some: { id: job.empresaId, arquivadoEm: null } } },
    { clientes: { some: { empresaId: job.empresaId, revokedAt: null } } },
    { empresasContabeis: { some: { empresaId: job.empresaId, status: 'APROVADO', arquivadoEm: null } } },
  ], AND: [{ OR: [
    { role: { in: ['COMUM', 'CONTADOR'] } }, { id: job.actorUserId }, ...(job.billingUserId ? [{ id: job.billingUserId }] : []),
  ] }] }, select: { id: true } });
  await tx.appNotification.createMany({ skipDuplicates: true, data: recipients.map(({ id }) => ({
    recipientId: id, empresaId: job.empresaId, vendaId: job.vendaId, notaId: notaId || null,
    type: status === 'AUTORIZADA' ? 'NOTA_AUTORIZADA' : 'NOTA_FALHA', title: status === 'AUTORIZADA' ? 'Emissão concluída' : 'Acompanhe sua emissão',
    message, eventKey: `emission:${job.id}:${status}`, priority: status === 'RECONCILIACAO_MANUAL' ? 'HIGH' : 'NORMAL',
    payloadJson: JSON.stringify({ jobId: job.id }),
  })) });
}

export async function finishEmissionFailure(job: LeasedEmission, definitive: boolean, message: string, errors?: unknown) {
  return withEmissionLease(job, async (tx, current) => {
    const next = emissionFailureState({ transmitted: !!current.transmissionStartedAt, definitive, attempts: current.attempts, maxAttempts: current.maxAttempts });
    const statusMessage = next.status === 'ERRO_FINAL' ? message : current.transmissionStartedAt
      ? (next.retry ? 'Consultando a DPS original para confirmar o resultado. Não reenvie.' : 'Resultado fiscal não confirmado. A empresa aguarda conciliação; não crie outra nota para esta venda.')
      : (next.retry ? 'Preparação temporariamente indisponível. A tarefa permanece na fila.' : 'Preparação interrompida. Solicite análise ao suporte.');
    await tx.emissaoJob.update({ where: { id: job.id }, data: {
      status: next.status, statusMessage, nextAttemptAt: next.retry ? new Date(Date.now() + retryDelayMs(current.attempts)) : null,
      finishedAt: next.status === 'ERRO_FINAL' ? new Date() : null, leaseToken: null, leaseUntil: null,
      lastError: JSON.stringify({ userAction: statusMessage, motivo: message, details: errors, temporario: next.retry,
        draftEligible: next.status === 'ERRO_FINAL', requiresReconciliation: next.status === 'RECONCILIACAO_MANUAL' }),
    } });
    if (next.releaseCredit) await releaseEmissionCredit(current.creditReservationId, tx);
    if (current.vendaId && next.status === 'ERRO_FINAL') await tx.venda.update({ where: { id: current.vendaId }, data: { status: 'ERRO_EMISSAO' } });
    await tx.systemLog.create({ data: { level: next.status === 'ERRO_FINAL' ? 'ERRO' : 'ALERTA', action: 'EMISSION_' + next.status,
      message: statusMessage, empresaId: current.empresaId, vendaId: current.vendaId, userId: current.actorUserId,
      details: JSON.stringify({ jobId: job.id, attempts: current.attempts, transmitted: !!current.transmissionStartedAt }) } });
    await notifyInTransaction(tx, current, next.status, statusMessage);
    return next;
  });
}

export async function finishEmissionSuccess(job: LeasedEmission, result: IResultadoEmissao) {
  return withEmissionLease(job, async (tx, current) => {
    if (!current.signedXml || !current.preparedMetadataJson || !result.notaGov) throw new Error('Autorização sem preparação persistida.');
    const authorized = await validateAuthorizedNfse(result.notaGov.xml, current.signedXml, current.ambiente, result.notaGov.chave);
    const metadata = JSON.parse(current.preparedMetadataJson);
    const production = current.ambiente === 'PRODUCAO';
    // Same company -> sequence order as settings writes; avoids a lock-order
    // cycle while a user changes numbering during an authorization commit.
    await tx.$queryRaw`SELECT "id" FROM "Empresa" WHERE "id" = ${current.empresaId} FOR UPDATE`;
    if (production && !current.creditReservationId && !current.billingUnlimited) throw new Error('Autorização sem reserva de crédito.');
    if (current.billingUnlimited && current.creditReservationId) throw new Error('Benefício administrativo não pode consumir reserva de crédito.');
    if (!production && current.creditReservationId) throw new Error('Homologação não pode liquidar reserva de produção.');
      const nota = await tx.notaFiscal.create({ data: {
        vendaId: current.vendaId, empresaId: current.empresaId, clienteId: current.clienteId,
        numero: Number(authorized.numero) <= 2_147_483_647 ? Number(authorized.numero) : null,
        numeroOficial: authorized.numero, ambiente: current.ambiente,
        valor: authorized.valor, descricao: authorized.descricao, prestadorCnpj: authorized.issuerDocument,
        tomadorCnpj: authorized.tomadorDocumento, tomadorNome: authorized.tomadorNome,
        codigoServico: authorized.codigoServico, metadadosVerificadosEm: new Date(),
        status: 'AUTORIZADA', chaveAcesso: authorized.chave, protocolo: authorized.protocolo,
        xmlBase64: authorized.xml, xmlAutorizadoBase64: authorized.xml, fiscalSnapshotJson: current.fiscalSnapshotJson,
        cnae: metadata.cnae, dataEmissao: authorized.dataEmissao,
      } });
      const notaId = nota.id;
      if (production && current.creditReservationId) await consumeEmissionCredit(current.creditReservationId, tx);
      await requestFiscalDocument(tx, nota.id, current.id);
    // Both environments have a document lifecycle. Every financial/reporting
    // consumer must filter the note's frozen environment, not company settings.
    await tx.emissaoJob.update({ where: { id: current.id }, data: { status: 'AUTORIZADA',
      statusMessage: production ? 'NFS-e autorizada. DANFSe em preparação.' : 'Validada em homologação, sem valor fiscal de produção.',
      resultNotaId: notaId, authorizedXmlBase64: null, lastError: null,
      finishedAt: new Date(), leaseToken: null, leaseUntil: null, nextAttemptAt: null,
    } });
    if (current.vendaId) await tx.venda.update({ where: { id: current.vendaId }, data: { status: production ? 'CONCLUIDA' : 'HOMOLOGACAO_VALIDADA' } });
    const sequence = await lockCanonicalDpsSequence(tx, { empresaId: current.empresaId, ambiente: current.ambiente, serie: current.serieDPS || '' });
    await tx.dpsSequencia.update({ where: { id: sequence.id }, data: {
      ultimoConfirmado: Math.max(sequence.ultimoConfirmado, normalizeDpsNumber(current.reservedDpsNumero)),
      origem: 'WORKER_AUTORIZACAO', statusSincronizacao: 'CONFIRMADO', sincronizadoEm: new Date(),
    } });
    if (production) await tx.$executeRaw`UPDATE "Empresa" SET "ultimoDPS" = GREATEST(COALESCE("ultimoDPS", 0), ${current.reservedDpsNumero || 0}) WHERE "id" = ${current.empresaId}`;
    const message = production ? 'NFS-e autorizada. XML disponível; DANFSe em preparação.' : 'Homologação concluída, sem valor fiscal de produção.';
    await notifyInTransaction(tx, current, 'AUTORIZADA', message, notaId);
    await tx.systemLog.create({ data: { level: 'INFO', action: 'EMISSION_AUTHORIZED', message, empresaId: current.empresaId,
      vendaId: current.vendaId, userId: current.actorUserId, details: JSON.stringify({ jobId: current.id, notaId, ambiente: current.ambiente }) } });
    return notaId;
  });
}

/** Invoked only by the standalone worker. No retries/timers tied to HTTP.
 * Once a POST boundary is durably recorded, EVERY recovery is GET-only.
 * A crash just before POST may need manual reconciliation; this is intentional. */
export async function processClaimedEmission(initial: LeasedEmission, strategyOverride?: IEmissorStrategy) {
  let job = initial;
  let leaseAlive = true;
  const heartbeat = setInterval(() => { void renewEmissionLease(job).then((ok) => { leaseAlive = ok; }).catch(() => { leaseAlive = false; }); }, 20_000);
  heartbeat.unref();
  try {
    if (!job.transmissionStartedAt) {
      await withEmissionLease(job, (tx, current) => validateBeforeTransmission(tx, current));
      job = { ...await reserveJobDps(job), leaseToken: job.leaseToken };
      if (!job.signedXml) {
        const prepared = await prepararEmissaoJob(job);
        const dpsId = preparedDpsId(prepared.signedXml);
        job = { ...await withEmissionLease(job, async (tx, current) => {
          if (current.signedXml) return current;
          return tx.emissaoJob.update({ where: { id: job.id }, data: {
            signedXml: prepared.signedXml, dpsId, preparedMetadataJson: JSON.stringify(prepared.metadata), fiscalSnapshotJson: prepared.fiscalSnapshotJson,
          } });
        }), leaseToken: job.leaseToken };
      }
    }
    if (!leaseAlive) throw new LostEmissionLease();
    if (!job.signedXml) throw new Error('DPS original ausente; conciliação manual necessária.');
    const company = await prisma.empresa.findUniqueOrThrow({ where: { id: job.empresaId } });
    const empresa = { ...company, ambiente: job.ambiente }; // Never query another environment after settings change.
    const strategy = strategyOverride || EmissorFactory.getStrategy(empresa);
    let result: IResultadoEmissao;
    if (job.transmissionStartedAt) {
      result = await strategy.conciliarDps(job.signedXml, empresa);
    } else {
      await withEmissionLease(job, async (tx, current) => {
        await validateBeforeTransmission(tx, current);
        if (current.transmissionStartedAt) throw new LostEmissionLease();
        await tx.emissaoJob.update({ where: { id: job.id }, data: { transmissionStartedAt: new Date(), statusMessage: 'Enviando a DPS preparada.' } });
      });
      // Even when the database response to the marker write is lost, the catch
      // path rereads it. It must never release credit based on this local variable.
      result = await strategy.transmitirPreparado(job.signedXml, empresa);
    }
    if (result.sucesso) await finishEmissionSuccess(job, result);
    else await finishEmissionFailure(job, !job.transmissionStartedAt && result.failureKind === 'PORTAL_REJECTION', result.motivo || 'Resultado desconhecido.', result.erros);
  } catch (error: any) {
    if (error instanceof LostEmissionLease) return;
    // A completed transaction followed by a lost response is also harmless:
    // the lease predicate below can no longer mutate an authorized job.
    const current = await prisma.emissaoJob.findUnique({ where: { id: job.id } });
    if (!current || current.status !== 'PROCESSANDO' || current.leaseToken !== job.leaseToken) return;
    const localRejection = !current.transmissionStartedAt && [400, 403].includes(error?.status);
    try { await finishEmissionFailure(job, localRejection, localRejection ? error.message : 'Falha operacional. Resultado preservado para verificação.'); }
    catch (failure) { if (!(failure instanceof LostEmissionLease)) throw failure; }
  } finally { clearInterval(heartbeat); }
}
