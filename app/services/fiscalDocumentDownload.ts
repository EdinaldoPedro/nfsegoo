import { NextResponse } from 'next/server';
import JSZip from 'jszip';
import { fiscalXml } from './emissor/validation/FiscalXml';

/** A download preserves stored evidence. It does not authorize a note or accept
 * uploaded XML, and decompression is bounded by fiscalXml's strict limit. */
export async function fiscalDocumentDownload(note: { numeroOficial: string | null; numero: number | null; xmlBase64: string | null; xmlAutorizadoBase64: string | null; xmlCancelamentoEventoBase64: string | null }) {
  const source = note.xmlAutorizadoBase64 || note.xmlBase64;
  if (!source) return NextResponse.json({ error: 'XML autorizado ainda não disponível.' }, { status: 404 });
  let xml: string; let event: string | null;
  try {
    xml = fiscalXml(source);
    event = note.xmlCancelamentoEventoBase64 ? fiscalXml(note.xmlCancelamentoEventoBase64) : null;
  } catch { return NextResponse.json({ error: 'Arquivo armazenado inválido ou acima do limite. Solicite verificação ao suporte.' }, { status: 422 }); }
  const number = String(note.numeroOficial || note.numero || 'sem-numero').replace(/[^a-z0-9-]/gi, '');
  const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
  if (event) {
    const zip = new JSZip();
    zip.file(`NFSe-${number}.xml`, xml);
    zip.file(`NFSe-${number}-evento-cancelamento.xml`, event);
    const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
    return new NextResponse(new Uint8Array(bytes), { headers: { ...headers, 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="NFSe-${number}-XMLs-cancelamento.zip"` } });
  }
  return new NextResponse(xml, { headers: { ...headers, 'Content-Type': 'application/xml; charset=utf-8', 'Content-Disposition': `attachment; filename="NFSe-${number}.xml"` } });
}
