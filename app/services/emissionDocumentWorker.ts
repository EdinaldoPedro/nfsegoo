import { randomUUID } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import type { EmissionDocumentTask } from '@prisma/client';
import { prisma } from '@/app/utils/prisma';
import { retryDelayMs } from '@/app/utils/emission-outcome';
import { generateDanfsePdf } from './pdf/DanfseGenerator';
import { originalNfseEnvironment, validateAuthorizedNfse, validateNfseDocument } from './emissor/validation/AuthorizedNfseValidator';
import { validateCancellationEvent } from './emissor/validation/CancellationEvent';

/** PDF rendering is independently retryable. It cannot submit a DPS, consume a
 * second credit, or change authorization/cancellation status. */
export async function processNextEmissionDocument(noteIds?: string[], render: typeof generateDanfsePdf = generateDanfsePdf) {
  const token = randomUUID();
  const [task] = await prisma.$queryRaw<EmissionDocumentTask[]>`
    WITH candidate AS (
      SELECT "id" FROM "EmissionDocumentTask"
      WHERE "status" IN ('PENDENTE', 'PROCESSANDO')
        AND (${noteIds === undefined} OR "notaId" = ANY(${noteIds || []}::text[]))
        AND ("nextAttemptAt" IS NULL OR "nextAttemptAt" <= clock_timestamp())
        AND ("leaseUntil" IS NULL OR "leaseUntil" <= clock_timestamp())
      ORDER BY "createdAt" FOR UPDATE SKIP LOCKED LIMIT 1
    ) UPDATE "EmissionDocumentTask" t SET "status" = 'PROCESSANDO', "leaseToken" = ${token},
      "leaseUntil" = clock_timestamp() + interval '120 seconds', "attempts" = "attempts" + 1, "updatedAt" = clock_timestamp()
      FROM candidate WHERE t."id" = candidate."id" RETURNING t.*
  `;
  if (!task) return false;
  const heartbeat = setInterval(() => {
    void prisma.$executeRaw`
      UPDATE "EmissionDocumentTask" SET "leaseUntil" = clock_timestamp() + interval '120 seconds'
      WHERE "id" = ${task.id} AND "leaseToken" = ${token} AND "status" = 'PROCESSANDO' AND "leaseUntil" > clock_timestamp()
    `.catch(() => {});
  }, 20_000);
  heartbeat.unref();
  try {
    const job = task.jobId ? await prisma.emissaoJob.findUniqueOrThrow({ where: { id: task.jobId } }) : null;
    const nota = await prisma.notaFiscal.findUniqueOrThrow({ where: { id: task.notaId } });
    if (job && (!job.signedXml || job.status !== 'AUTORIZADA' || job.resultNotaId !== nota.id || nota.empresaId !== job.empresaId || nota.vendaId !== job.vendaId)) throw new Error('Vínculo do documento inconsistente.');
    const xml = nota.xmlAutorizadoBase64 || nota.xmlBase64;
    if (!xml || !nota.chaveAcesso || !['AUTORIZADA','CANCELADA'].includes(nota.status)) throw new Error('Documento fiscal ainda não confirmado.');
    const ambiente = nota.ambiente || job?.ambiente || originalNfseEnvironment(xml);
    await validateNfseDocument(xml, ambiente, nota.chaveAcesso, nota.prestadorCnpj);
    if (job) await validateAuthorizedNfse(xml, job.signedXml!, job.ambiente, nota.chaveAcesso);
    const originalStatus = nota.status;
    const originalEvent = nota.xmlCancelamentoEventoBase64;
    if (originalStatus === 'CANCELADA') await validateCancellationEvent(originalEvent, { key: nota.chaveAcesso, ambiente });
    else if (originalEvent) throw new Error('Evento de cancelamento exige conciliação da situação da nota.');
    const pdf = await render(xml!, { cancelada: originalStatus === 'CANCELADA', eventoCancelamentoXml: originalEvent });
    await prisma.$transaction(async (tx) => {
      // Same order as cancellation/document requests: note, then document task.
      // Avoid a task->note / note->task deadlock during concurrent cancellation.
      await tx.$queryRaw`SELECT "id" FROM "NotaFiscal" WHERE "id" = ${nota.id} FOR UPDATE`;
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "EmissionDocumentTask" WHERE "id" = ${task.id} AND "leaseToken" = ${token}
          AND "status" = 'PROCESSANDO' AND "leaseUntil" > clock_timestamp() FOR UPDATE
      `;
      if (!locked.length) return;
      // Cancellation during rendering must not be overwritten by an authorized PDF.
      const changed = await tx.notaFiscal.updateMany({ where: { id: nota.id, status: originalStatus, xmlCancelamentoEventoBase64: originalEvent,
        xmlAutorizadoBase64: nota.xmlAutorizadoBase64, xmlBase64: nota.xmlBase64 },
        data: { pdfBase64: gzipSync(pdf).toString('base64') } });
      if (!changed.count) throw new Error('Situação fiscal alterada durante a geração.');
      await tx.emissionDocumentTask.update({ where: { id: task.id }, data: { status: 'CONCLUIDA', completedAt: new Date(), leaseToken: null, leaseUntil: null, lastError: null } });
    });
  } catch {
    await prisma.emissionDocumentTask.updateMany({ where: { id: task.id, leaseToken: token, status: 'PROCESSANDO', leaseUntil: { gt: new Date() } }, data: {
      status: task.attempts >= 8 ? 'REVISAO_MANUAL' : 'PENDENTE', leaseToken: null, leaseUntil: null,
      nextAttemptAt: new Date(Date.now() + retryDelayMs(task.attempts)), lastError: 'Não foi possível gerar o DANFSe. XML e autorização fiscal preservados.',
    } });
  } finally { clearInterval(heartbeat); }
  return true;
}
