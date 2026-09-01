import { NextResponse } from 'next/server';
import zlib from 'node:zlib';
import JSZip from 'jszip';
import { getAuthenticatedUser, forbidden, unauthorized } from '@/app/utils/api-middleware';
import { isSupportRole } from '@/app/utils/access-control';
import { prisma } from '@/app/utils/prisma';

async function ensureSupport(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return unauthorized();
  if (!isSupportRole(user.role)) return forbidden();
  return null;
}

function decodeStoredXml(value?: string | null) {
  if (!value) return null;
  if (value.trimStart().startsWith('<')) return Buffer.from(value, 'utf8');

  try {
    let buffer = Buffer.from(value, 'base64');
    if (buffer[0] === 0x1f && buffer[1] === 0x8b) {
      buffer = zlib.gunzipSync(buffer);
    }
    return buffer;
  } catch {
    return null;
  }
}

function escolherNotaFiscal(notas: any[]) {
  return (
    notas.find((nota) => ['AUTORIZADA', 'CANCELADA'].includes(nota.status) && nota.chaveAcesso) ||
    notas.find((nota) => nota.chaveAcesso) ||
    notas[0]
  );
}

function nomeSeguro(numero: number | null | undefined, vendaId: string) {
  return numero && numero > 0 ? String(numero) : vendaId.slice(0, 8);
}

export async function GET(request: Request, { params }: { params: { id: string } }) {
  const authError = await ensureSupport(request);
  if (authError) return authError;

  const venda = await prisma.venda.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      status: true,
      notas: {
        orderBy: { createdAt: 'desc' },
        select: {
          numero: true,
          status: true,
          chaveAcesso: true,
          xmlBase64: true,
          xmlAutorizadoBase64: true,
          xmlCancelamentoEventoBase64: true,
        },
      },
    },
  });

  if (!venda) return NextResponse.json({ error: 'Venda não encontrada.' }, { status: 404 });

  const nota = escolherNotaFiscal(venda.notas);
  if (!nota) return NextResponse.json({ error: 'Esta venda ainda não possui nota fiscal.' }, { status: 404 });

  const xmlNota = decodeStoredXml(nota.xmlAutorizadoBase64 || nota.xmlBase64);
  if (!xmlNota) return NextResponse.json({ error: 'XML oficial ainda não está disponível.' }, { status: 404 });

  const identificador = nomeSeguro(nota.numero, venda.id);
  const cancelada = venda.status === 'CANCELADA' || nota.status === 'CANCELADA';
  const xmlEvento = cancelada ? decodeStoredXml(nota.xmlCancelamentoEventoBase64) : null;
  const commonHeaders = {
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  };

  if (xmlEvento) {
    const zip = new JSZip();
    zip.file(`NFSe-${identificador}.xml`, xmlNota);
    zip.file(`NFSe-${identificador}-evento-cancelamento.xml`, xmlEvento);
    const arquivo = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });

    return new NextResponse(arquivo as any, {
      headers: {
        ...commonHeaders,
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="NFSe-${identificador}-XMLs-cancelamento.zip"`,
        'Content-Length': String(arquivo.length),
      },
    });
  }

  return new NextResponse(xmlNota as any, {
    headers: {
      ...commonHeaders,
      'Content-Type': 'application/xml; charset=utf-8',
      'Content-Disposition': `attachment; filename="NFSe-${identificador}.xml"`,
      'Content-Length': String(xmlNota.length),
    },
  });
}
