import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { getAuthenticatedUser, forbidden, unauthorized } from '@/app/utils/api-middleware';
import { validateJsonContentLength } from '@/app/utils/request-guards';

const prisma = new PrismaClient();

const ADMIN_ROLES = ['MASTER', 'ADMIN'];
const VALID_STATUS = ['RASCUNHO', 'AGENDADO', 'ATIVO', 'PAUSADO', 'ARQUIVADO'];
const VALID_TYPES = ['INFO', 'SUCCESS', 'WARNING', 'CRITICAL'];
const VALID_AUDIENCES = ['TODOS', 'CLIENTES', 'CONTADORES'];
const MAX_ATTACHMENT_BASE64_LENGTH = 3_000_000;
const ALLOWED_ATTACHMENT_MIME_TYPES = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/webp']);
const ALLOWED_ATTACHMENT_EXTENSIONS = new Set(['.pdf', '.png', '.jpg', '.jpeg', '.webp']);

function parseDate(value: unknown) {
  if (!value || typeof value !== 'string') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function resolveStatus(status: string, iniciaEm: Date | null) {
  if (status === 'ATIVO' && iniciaEm && iniciaEm.getTime() > Date.now()) return 'AGENDADO';
  return status;
}

function serializeNotice(notice: any) {
  const now = Date.now();
  const startsAt = notice.iniciaEm ? new Date(notice.iniciaEm).getTime() : null;
  const endsAt = notice.terminaEm ? new Date(notice.terminaEm).getTime() : null;
  const runtimeStatus =
    notice.status === 'ATIVO' && startsAt && startsAt > now
      ? 'AGENDADO'
      : notice.status === 'ATIVO' && endsAt && endsAt < now
        ? 'EXPIRADO'
        : notice.status;

  return {
    ...notice,
    runtimeStatus,
    anexoBase64: notice.anexoBase64 || null,
  };
}

function fileExtension(fileName: string) {
  const dotIndex = fileName.lastIndexOf('.');
  return dotIndex >= 0 ? fileName.slice(dotIndex).toLowerCase() : '';
}

function validateSafeLink(value: unknown) {
  const link = typeof value === 'string' ? value.trim() : '';
  if (!link) return { value: null, error: null };

  if (link.startsWith('/') && !link.startsWith('//') && !link.includes('\\')) {
    return { value: link, error: null };
  }

  try {
    const url = new URL(link);
    if (url.protocol === 'https:' || url.protocol === 'http:') {
      return { value: url.toString(), error: null };
    }
  } catch {
    return { value: null, error: 'Link do aviso invalido.' };
  }

  return { value: null, error: 'Use apenas links http, https ou caminhos internos.' };
}

function validateAttachment(body: any) {
  if (!body.anexoBase64) return { error: null, base64: null, fileName: null };

  const rawBase64 = String(body.anexoBase64);
  if (rawBase64.length > MAX_ATTACHMENT_BASE64_LENGTH) {
    return { error: 'Use anexos de ate 2 MB para manter o carregamento leve.', base64: null, fileName: null };
  }

  const fileName = String(body.anexoNome || 'anexo').replace(/[^\w.\- ]+/g, '_').slice(0, 140);
  const extensionAllowed = ALLOWED_ATTACHMENT_EXTENSIONS.has(fileExtension(fileName));
  const dataUrlMatch = rawBase64.match(/^data:([^;,]+);base64,/i);
  const mimeType = dataUrlMatch?.[1]?.toLowerCase() || '';

  if (!dataUrlMatch || !ALLOWED_ATTACHMENT_MIME_TYPES.has(mimeType) || !extensionAllowed) {
    return { error: 'Anexo deve ser PDF, PNG, JPG ou WEBP.', base64: null, fileName: null };
  }

  const compactBase64 = rawBase64.slice(dataUrlMatch[0].length).replace(/\s/g, '');
  if (!compactBase64 || compactBase64.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(compactBase64)) {
    return { error: 'Anexo em formato invalido.', base64: null, fileName: null };
  }

  const bytes = Buffer.from(compactBase64, 'base64').length;
  if (bytes > 2 * 1024 * 1024) {
    return { error: 'Use anexos de ate 2 MB para manter o carregamento leve.', base64: null, fileName: null };
  }

  return { error: null, base64: `data:${mimeType};base64,${compactBase64}`, fileName };
}

export async function GET(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return unauthorized();
  if (!ADMIN_ROLES.includes(user.role)) return forbidden();

  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status');

  const notices = await prisma.globalNotice.findMany({
    where: status && status !== 'TODOS' ? { status } : undefined,
    orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
  });

  return NextResponse.json(notices.map(serializeNotice));
}

export async function POST(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return unauthorized();
  if (!ADMIN_ROLES.includes(user.role)) return forbidden();

  const sizeError = validateJsonContentLength(request, 4 * 1024 * 1024);
  if (sizeError) return sizeError;

  const body = await request.json();
  const titulo = String(body.titulo || '').trim();
  const mensagem = String(body.mensagem || '').trim();

  if (!titulo || !mensagem) {
    return NextResponse.json({ error: 'Informe titulo e mensagem do aviso.' }, { status: 400 });
  }

  const tipo = VALID_TYPES.includes(body.tipo) ? body.tipo : 'INFO';
  const publico = VALID_AUDIENCES.includes(body.publico) ? body.publico : 'TODOS';
  const iniciaEm = parseDate(body.iniciaEm);
  const terminaEm = parseDate(body.terminaEm);
  const statusBase = VALID_STATUS.includes(body.status) ? body.status : 'RASCUNHO';
  const status = resolveStatus(statusBase, iniciaEm);

  if (iniciaEm && terminaEm && terminaEm.getTime() <= iniciaEm.getTime()) {
    return NextResponse.json({ error: 'A data final precisa ser maior que a data inicial.' }, { status: 400 });
  }

  const link = validateSafeLink(body.linkHref);
  if (link.error) return NextResponse.json({ error: link.error }, { status: 400 });

  const attachment = validateAttachment(body);
  if (attachment.error) return NextResponse.json({ error: attachment.error }, { status: 400 });

  const notice = await prisma.globalNotice.create({
    data: {
      titulo,
      mensagem,
      tipo,
      publico,
      status,
      iniciaEm,
      terminaEm,
      linkLabel: body.linkLabel ? String(body.linkLabel).trim() : null,
      linkHref: link.value,
      anexoNome: attachment.fileName,
      anexoBase64: attachment.base64,
      criadoPorId: user.id,
      publicadoEm: status === 'ATIVO' ? new Date() : null,
    },
  });

  return NextResponse.json(serializeNotice(notice), { status: 201 });
}

export async function PUT(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return unauthorized();
  if (!ADMIN_ROLES.includes(user.role)) return forbidden();

  const sizeError = validateJsonContentLength(request, 4 * 1024 * 1024);
  if (sizeError) return sizeError;

  const body = await request.json();
  const id = String(body.id || '').trim();
  if (!id) return NextResponse.json({ error: 'Aviso nao informado.' }, { status: 400 });

  const titulo = String(body.titulo || '').trim();
  const mensagem = String(body.mensagem || '').trim();
  if (!titulo || !mensagem) {
    return NextResponse.json({ error: 'Informe titulo e mensagem do aviso.' }, { status: 400 });
  }

  const atual = await prisma.globalNotice.findUnique({ where: { id } });
  if (!atual) return NextResponse.json({ error: 'Aviso nao encontrado.' }, { status: 404 });

  const tipo = VALID_TYPES.includes(body.tipo) ? body.tipo : 'INFO';
  const publico = VALID_AUDIENCES.includes(body.publico) ? body.publico : 'TODOS';
  const iniciaEm = parseDate(body.iniciaEm);
  const terminaEm = parseDate(body.terminaEm);
  const statusBase = VALID_STATUS.includes(body.status) ? body.status : atual.status;
  const status = resolveStatus(statusBase, iniciaEm);

  if (iniciaEm && terminaEm && terminaEm.getTime() <= iniciaEm.getTime()) {
    return NextResponse.json({ error: 'A data final precisa ser maior que a data inicial.' }, { status: 400 });
  }

  const link = validateSafeLink(body.linkHref);
  if (link.error) return NextResponse.json({ error: link.error }, { status: 400 });

  const attachment = validateAttachment(body);
  if (attachment.error) return NextResponse.json({ error: attachment.error }, { status: 400 });

  const notice = await prisma.globalNotice.update({
    where: { id },
    data: {
      titulo,
      mensagem,
      tipo,
      publico,
      status,
      iniciaEm,
      terminaEm,
      linkLabel: body.linkLabel ? String(body.linkLabel).trim() : null,
      linkHref: link.value,
      anexoNome: body.removerAnexo ? null : attachment.fileName || atual.anexoNome,
      anexoBase64: body.removerAnexo ? null : attachment.base64 || atual.anexoBase64,
      publicadoEm: status === 'ATIVO' && atual.status !== 'ATIVO' ? new Date() : atual.publicadoEm,
      arquivadoEm: status === 'ARQUIVADO' && atual.status !== 'ARQUIVADO' ? new Date() : status !== 'ARQUIVADO' ? null : atual.arquivadoEm,
    },
  });

  return NextResponse.json(serializeNotice(notice));
}

export async function DELETE(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return unauthorized();
  if (!ADMIN_ROLES.includes(user.role)) return forbidden();

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Aviso nao informado.' }, { status: 400 });

  const notice = await prisma.globalNotice.update({
    where: { id },
    data: {
      status: 'ARQUIVADO',
      arquivadoEm: new Date(),
    },
  });

  return NextResponse.json(serializeNotice(notice));
}
