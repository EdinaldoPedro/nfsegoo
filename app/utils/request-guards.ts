import { NextResponse } from 'next/server';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const DEFAULT_MAX_JSON_BODY_BYTES = 1_000_000;
export const MAX_SUPPORT_ATTACHMENT_BYTES = 5 * 1024 * 1024;

const ALLOWED_ATTACHMENT_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.pdf', '.xml']);
const ALLOWED_ATTACHMENT_MIME_TYPES = new Set(['application/pdf', 'application/xml', 'text/xml']);

function firstHeaderValue(value: string | null) {
  return value?.split(',')[0]?.trim() || null;
}

function toOrigin(value: string | undefined | null) {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function expectedRequestOrigin(request: Request) {
  const configuredOrigin = toOrigin(process.env.NEXT_PUBLIC_APP_URL);
  if (configuredOrigin) return configuredOrigin;

  const host = firstHeaderValue(request.headers.get('x-forwarded-host')) || firstHeaderValue(request.headers.get('host'));
  if (!host) return null;

  const proto = firstHeaderValue(request.headers.get('x-forwarded-proto')) || (host.startsWith('localhost') ? 'http' : 'https');
  return toOrigin(`${proto}://${host}`);
}

export function validateSameOrigin(request: Request) {
  if (!MUTATING_METHODS.has(request.method.toUpperCase())) return null;

  const secFetchSite = request.headers.get('sec-fetch-site')?.toLowerCase();
  if (secFetchSite === 'cross-site') {
    return NextResponse.json({ error: 'Origem da requisicao nao autorizada.' }, { status: 403 });
  }

  const origin = toOrigin(request.headers.get('origin'));
  if (!origin) return null;

  const allowedOrigins = new Set(
    [expectedRequestOrigin(request), toOrigin(process.env.NEXT_PUBLIC_APP_URL), toOrigin(process.env.URL_API_LOCAL)].filter(Boolean) as string[],
  );

  if (!allowedOrigins.has(origin)) {
    return NextResponse.json({ error: 'Origem da requisicao nao autorizada.' }, { status: 403 });
  }

  return null;
}

export function validateJsonContentLength(request: Request, maxBytes = DEFAULT_MAX_JSON_BODY_BYTES) {
  const rawLength = request.headers.get('content-length');
  if (!rawLength) return null;

  const contentLength = Number(rawLength);
  if (!Number.isFinite(contentLength)) {
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
  if (buffer.length > maxBytes) {
    return {
      value: null,
      fileName: null,
      errorResponse: NextResponse.json({ error: 'Anexo excede o limite de 5 MB.' }, { status: 413 }),
    };
  }

  const fileName = sanitizeAttachmentName(anexoNome);
  const extensionAllowed = ALLOWED_ATTACHMENT_EXTENSIONS.has(fileExtension(fileName));
  const mimeAllowed = !!mimeType && (ALLOWED_ATTACHMENT_MIME_TYPES.has(mimeType) || mimeType.startsWith('image/'));

  if (!extensionAllowed && !mimeAllowed) {
    return {
      value: null,
      fileName: null,
      errorResponse: NextResponse.json({ error: 'Tipo de anexo nao permitido.' }, { status: 400 }),
    };
  }

  return { value: buffer.toString('base64'), fileName, errorResponse: null };
}
