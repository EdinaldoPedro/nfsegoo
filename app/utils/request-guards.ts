import { NextResponse } from 'next/server';
import { getRequestOrigin, normalizeOrigin } from '@/app/utils/request-url';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const DEFAULT_MAX_JSON_BODY_BYTES = 1_000_000;
export const MAX_SUPPORT_ATTACHMENT_BYTES = 5 * 1024 * 1024;

const ALLOWED_ATTACHMENT_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.pdf', '.xml']);
const EXTENSION_MIMES: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.pdf': 'application/pdf', '.xml': 'application/xml',
};

export function validateSameOrigin(request: Request) {
  if (!MUTATING_METHODS.has(request.method.toUpperCase())) return null;

  const secFetchSite = request.headers.get('sec-fetch-site')?.toLowerCase();
  if (secFetchSite === 'cross-site') {
    return NextResponse.json({ error: 'Origem da requisicao nao autorizada.' }, { status: 403 });
  }

  const origin = normalizeOrigin(request.headers.get('origin'));
  if (!origin && secFetchSite !== 'same-origin') {
    return NextResponse.json({ error: 'Origem da requisicao obrigatoria.' }, { status: 403 });
  }
  if (!origin && secFetchSite === 'same-origin') return null;

  const allowedOrigins = new Set(
    [
      process.env.NODE_ENV !== 'production' ? getRequestOrigin(request) : null,
      normalizeOrigin(process.env.NEXT_PUBLIC_APP_URL),
      ...(process.env.CSRF_ALLOWED_ORIGINS || '').split(',').map((value) => normalizeOrigin(value.trim())),
    ].filter(Boolean) as string[],
  );

  // Next normalizes its development request URL to localhost even when opened
  // through 127.0.0.1. Accept only loopback aliases on the SAME port in development.
  if (process.env.NODE_ENV !== 'production') {
    const serverOrigin = getRequestOrigin(request);
    if (serverOrigin) {
      const localUrl = new URL(serverOrigin);
      if (['localhost', '127.0.0.1', '[::1]'].includes(localUrl.hostname)) {
        for (const host of ['localhost', '127.0.0.1', '[::1]']) {
          allowedOrigins.add(`${localUrl.protocol}//${host}${localUrl.port ? `:${localUrl.port}` : ''}`);
        }
      }
    }
  }

  if (!origin || !allowedOrigins.has(origin)) {
    return NextResponse.json({ error: 'Origem da requisicao nao autorizada.' }, { status: 403 });
  }

  return null;
}

export function validateJsonContentLength(request: Request, maxBytes = DEFAULT_MAX_JSON_BODY_BYTES) {
  const rawLength = request.headers.get('content-length');
  if (!rawLength) return null;

  const contentLength = Number(rawLength);
  if (!Number.isSafeInteger(contentLength) || contentLength < 0) {
    return NextResponse.json({ error: 'Tamanho da requisicao invalido.' }, { status: 400 });
  }

  if (contentLength > maxBytes) {
    return NextResponse.json({ error: 'Payload muito grande.' }, { status: 413 });
  }

  return null;
}

function sanitizeAttachmentName(fileName: unknown) {
  const rawName = typeof fileName === 'string' && fileName.trim() ? fileName.trim() : 'anexo';
  return rawName.replace(/[^\w.\- ]+/g, '_').slice(0, 120);
}

function fileExtension(fileName: string) {
  const dotIndex = fileName.lastIndexOf('.');
  return dotIndex >= 0 ? fileName.slice(dotIndex).toLowerCase() : '';
}

export function detectAttachmentMime(buffer: Buffer) {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (buffer.length >= 3 && buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) return 'image/jpeg';
  if (buffer.length >= 6 && ['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString('ascii'))) return 'image/gif';
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  if (buffer.length >= 5 && buffer.subarray(0, 5).toString('ascii') === '%PDF-') return 'application/pdf';
  const text = buffer.toString('utf8').replace(/^\uFEFF/, '').trim();
  // eslint-disable-next-line no-control-regex -- XML rejects these control bytes; this is an intentional security check.
  if (text.startsWith('<') && text.endsWith('>') && !/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(text)
    && !/<!DOCTYPE|<!ENTITY|<script\b|<html\b|<svg\b|<\?xml-stylesheet/i.test(text)) return 'application/xml';
  return null;
}

export function normalizeBase64Attachment(
  anexoBase64: unknown,
  anexoNome: unknown,
  maxBytes = MAX_SUPPORT_ATTACHMENT_BYTES,
) {
  if (!anexoBase64) {
    return { value: null as string | null, fileName: null as string | null, errorResponse: null as NextResponse | null };
  }

  if (typeof anexoBase64 !== 'string') {
    return {
      value: null,
      fileName: null,
      errorResponse: NextResponse.json({ error: 'Anexo invalido.' }, { status: 400 }),
    };
  }

  let mimeType: string | null = null;
  let base64 = anexoBase64.trim();
  const dataUrlMatch = base64.match(/^data:([^;,]+);base64,/i);
  if (dataUrlMatch) {
    mimeType = dataUrlMatch[1].toLowerCase();
    base64 = base64.slice(dataUrlMatch[0].length);
  }

  const compactBase64 = base64.replace(/\s/g, '');
  if (!compactBase64 || compactBase64.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(compactBase64)) {
    return {
      value: null,
      fileName: null,
      errorResponse: NextResponse.json({ error: 'Anexo em formato invalido.' }, { status: 400 }),
    };
  }

  const buffer = Buffer.from(compactBase64, 'base64');
  if (!buffer.length || buffer.toString('base64').replace(/=+$/, '') !== compactBase64.replace(/=+$/, '')) {
    return { value: null, fileName: null, errorResponse: NextResponse.json({ error: 'Anexo em formato invalido.' }, { status: 400 }) };
  }
  if (buffer.length > maxBytes) {
    return {
      value: null,
      fileName: null,
      errorResponse: NextResponse.json({ error: 'Anexo excede o limite de 5 MB.' }, { status: 413 }),
    };
  }

  const fileName = sanitizeAttachmentName(anexoNome);
  const extension = fileExtension(fileName);
  const extensionAllowed = ALLOWED_ATTACHMENT_EXTENSIONS.has(extension);
  const detectedMime = detectAttachmentMime(buffer);
  const declaredMime = mimeType === 'text/xml' ? 'application/xml' : mimeType;

  if (!extensionAllowed || !detectedMime || EXTENSION_MIMES[extension] !== detectedMime || (declaredMime && declaredMime !== detectedMime)) {
    return {
      value: null,
      fileName: null,
      errorResponse: NextResponse.json({ error: 'Tipo de anexo nao permitido.' }, { status: 400 }),
    };
  }

  return { value: buffer.toString('base64'), fileName, errorResponse: null };
}
