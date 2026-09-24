import { Prisma } from '@prisma/client';
import JSZip from 'jszip';
import { gunzipSync } from 'node:zlib';
import { prisma } from '@/app/utils/prisma';
import { fiscalXml } from './emissor/validation/FiscalXml';
import { noteEnvironmentWhere, resolveReportCompany } from './fiscalReportService';
import { fiscalReportError, FISCAL_REPORT_ENVIRONMENTS, MAX_FISCAL_EXPORT_NOTES, reportEnvironment, type FiscalReportEnvironment } from '@/app/utils/fiscal-report';

export const MAX_FISCAL_EXPORT_BYTES = 20 * 1024 * 1024;
const MAX_STORED_EXPORT_BYTES = 32 * 1024 * 1024;
type ExportFormat = 'XML' | 'PDF' | 'AMBOS';
type ExportNote = { id: string; empresaId: string; numeroOficial: string | null; numero: number | null; status: string;
  xmlBase64: string | null; xmlAutorizadoBase64: string | null; xmlCancelamentoEventoBase64: string | null; pdfBase64: string | null;
  documentTask: { status: string } | null };

export function parseFiscalExport(body: unknown) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return fiscalReportError('Exportação inválida.');
  const { ids, formato, ambiente } = body as Record<string, unknown>;
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > MAX_FISCAL_EXPORT_NOTES ||
      ids.some((id) => typeof id !== 'string' || !/^[a-z0-9_-]{1,100}$/i.test(id)) || new Set(ids).size !== ids.length) {
    return fiscalReportError(`Selecione entre 1 e ${MAX_FISCAL_EXPORT_NOTES} notas distintas.`);
  }
  if (typeof formato !== 'string' || !['XML', 'PDF', 'AMBOS'].includes(formato)) return fiscalReportError('Escolha XML, PDF ou ambos.');
  return { ids: ids as string[], formato: formato as ExportFormat, ambiente: reportEnvironment(ambiente) };
}

/** Call only with an authorized, consistent snapshot. Any missing/corrupt file
 * fails the whole request; never deliver a partial ZIP as a successful export. */
export async function buildFiscalExportArchive(notes: ExportNote[], formato: ExportFormat, ambiente: FiscalReportEnvironment) {
  if (!notes.length || notes.length > MAX_FISCAL_EXPORT_NOTES) return fiscalReportError('Quantidade inválida para exportação.');
  const zip = new JSZip();
  let bytes = 0;
  const add = (name: string, content: string | Buffer) => {
    bytes += typeof content === 'string' ? Buffer.byteLength(content, 'utf8') : content.length;
    if (bytes > MAX_FISCAL_EXPORT_BYTES) return fiscalReportError('Os documentos excedem 20 MB. Exporte menos notas por vez.', 413);
    zip.file(name, content);
  };
  const paths = new Set<string>();
  for (const note of notes) {
    const safe = (value: string) => value.replace(/[^a-z0-9_-]/gi, '');
    const path = `${ambiente}/${safe(note.empresaId)}/NFSe-${safe(note.numeroOficial || String(note.numero || 'sem-numero'))}-${safe(note.id)}`;
    if (paths.has(path)) return fiscalReportError('Documentos repetidos na exportação.');
    paths.add(path);
    if (formato !== 'PDF') {
      const source = note.xmlAutorizadoBase64 || note.xmlBase64;
      if (!source || (note.status === 'CANCELADA' && !note.xmlCancelamentoEventoBase64)) return fiscalReportError('Há nota sem XML original ou evento de cancelamento disponível. Solicite verificação ao suporte.', 409);
      try {
        add(path + '.xml', fiscalXml(source));
        if (note.xmlCancelamentoEventoBase64) add(path + '-evento-cancelamento.xml', fiscalXml(note.xmlCancelamentoEventoBase64));
      } catch (error) {
        if ((error as { status?: number }).status) throw error;
        return fiscalReportError('Há XML armazenado inválido ou excessivo. Nenhum arquivo parcial foi exportado.', 422);
      }
    }
    if (formato !== 'XML') {
      if (!note.pdfBase64 || note.documentTask?.status !== 'CONCLUIDA') return fiscalReportError('Há PDF ainda não verificado/disponível. Abra a nota para solicitar a preparação e tente novamente após a conclusão.', 409);
      try {
        const input = Buffer.from(note.pdfBase64, 'base64');
        const pdf = input[0] === 0x1f && input[1] === 0x8b ? gunzipSync(input, { maxOutputLength: MAX_FISCAL_EXPORT_BYTES }) : input;
        if (pdf.subarray(0, 5).toString('ascii') !== '%PDF-') return fiscalReportError('Há PDF armazenado inválido. Solicite regeneração ao suporte.', 422);
        add(path + '.pdf', pdf);
      } catch (error) {
        if ((error as { status?: number }).status) throw error;
        return fiscalReportError('Há PDF corrompido ou excessivo. Nenhum arquivo parcial foi exportado.', 422);
      }
    }
  }
  add('LEIA-ME.txt', `NFSe Goo - Exportação de ${notes.length} nota(s).\nAmbiente: ${FISCAL_REPORT_ENVIRONMENTS[ambiente].label}.\n${FISCAL_REPORT_ENVIRONMENTS[ambiente].notice}\nXML autorizado e evento são arquivos separados. O número da nota pode se repetir entre emitentes.\n`);
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 3 } });
}

export async function exportFiscalReport(userId: string, contextId: string | null, body: unknown) {
  const options = parseFiscalExport(body);
  const notes = await prisma.$transaction(async (tx) => {
    const empresaId = await resolveReportCompany(tx, userId, contextId);
    const where: Prisma.NotaFiscalWhereInput = { id: { in: options.ids }, empresaId, arquivadoEm: null,
      status: { in: ['AUTORIZADA', 'CANCELADA'] }, AND: [noteEnvironmentWhere(options.ambiente)] };
    const permitted = await tx.notaFiscal.count({ where });
    if (permitted !== options.ids.length) return fiscalReportError('Uma ou mais notas não estão disponíveis neste contexto e ambiente.', 403);
    // Bound stored input before fetching any blob. Auth is checked first.
    const [size] = await tx.$queryRaw<Array<{ bytes: bigint }>>`
      SELECT COALESCE(SUM(
        CASE WHEN ${options.formato !== 'PDF'} THEN octet_length(COALESCE("xmlAutorizadoBase64", '')) + octet_length(COALESCE("xmlBase64", '')) + octet_length(COALESCE("xmlCancelamentoEventoBase64", '')) ELSE 0 END +
        CASE WHEN ${options.formato !== 'XML'} THEN octet_length(COALESCE("pdfBase64", '')) ELSE 0 END
      ), 0)::bigint AS bytes FROM "NotaFiscal" WHERE "empresaId" = ${empresaId} AND "id" IN (${Prisma.join(options.ids)})
    `;
    if (size.bytes > BigInt(MAX_STORED_EXPORT_BYTES)) return fiscalReportError('O lote é muito grande. Exporte menos notas por vez.', 413);
    return tx.notaFiscal.findMany({ where, select: { id: true, empresaId: true, numeroOficial: true, numero: true, status: true,
      xmlBase64: options.formato !== 'PDF', xmlAutorizadoBase64: options.formato !== 'PDF', xmlCancelamentoEventoBase64: options.formato !== 'PDF',
      pdfBase64: options.formato !== 'XML', documentTask: { select: { status: true } } }, orderBy: { id: 'asc' } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 15000 });
  const bytes = await buildFiscalExportArchive(notes.map((note) => ({ ...note, xmlBase64: note.xmlBase64 ?? null,
    xmlAutorizadoBase64: note.xmlAutorizadoBase64 ?? null, xmlCancelamentoEventoBase64: note.xmlCancelamentoEventoBase64 ?? null,
    pdfBase64: note.pdfBase64 ?? null })), options.formato, options.ambiente);
  return { bytes, filename: `NFSe-${options.ambiente}-documentos.zip` };
}
