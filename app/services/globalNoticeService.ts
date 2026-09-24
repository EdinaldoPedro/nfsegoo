import type { Prisma } from '@prisma/client';
import { prisma } from '@/app/utils/prisma';
import { CommercialError } from '@/app/utils/commercial-pricing';
import { normalizeBase64Attachment } from '@/app/utils/request-guards';

const TYPES = ['INFO', 'SUCCESS', 'WARNING', 'CRITICAL'] as const;
const AUDIENCES = ['TODOS', 'CLIENTES', 'CONTADORES'] as const;
const MUTABLE_STATUSES = ['RASCUNHO', 'AGENDADO', 'ATIVO', 'PAUSADO'] as const;
export const noticeMetadataSelect = { id: true, titulo: true, mensagem: true, tipo: true, status: true, publico: true,
  iniciaEm: true, terminaEm: true, linkLabel: true, linkHref: true, anexoNome: true, notificarApp: true,
  criadoPorId: true, publicadoEm: true, arquivadoEm: true, createdAt: true, updatedAt: true, version: true } satisfies Prisma.GlobalNoticeSelect;

export function noticeAudiences(role: string, hybridCustomer = false) {
  if (role === 'CONTADOR') return ['TODOS', 'CONTADORES'];
  if (role === 'COMUM' || hybridCustomer) return ['TODOS', 'CLIENTES'];
  return ['TODOS'];
}

function record(input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new CommercialError('Envie um aviso válido.');
  return input as Record<string, unknown>;
}
function boundedText(value: unknown, label: string, max: number, required = false) {
  if (value === null || value === undefined || value === '') {
    if (required) throw new CommercialError(`${label} é obrigatório.`);
    return null;
  }
  if (typeof value !== 'string') throw new CommercialError(`${label} inválido.`);
  const result = value.trim();
  if ((required && !result) || result.length > max || Array.from(result).some(character => character.charCodeAt(0) < 32 && !['\n', '\r', '\t'].includes(character))) {
    throw new CommercialError(`${label} inválido ou acima do limite.`);
  }
  return result || null;
}
function date(value: unknown, label: string) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?$/.test(value)) {
    throw new CommercialError(`${label} inválida.`);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new CommercialError(`${label} inválida.`);
  return parsed;
}
function safeLink(value: unknown) {
  const result = boundedText(value, 'Link', 2048);
  if (!result) return null;
  if (result.startsWith('/') && !result.startsWith('//') && !result.includes('\\')) return result;
  try {
    const parsed = new URL(result);
    if (parsed.protocol === 'https:' && !parsed.username && !parsed.password) return parsed.toString();
  } catch { /* mensagem única abaixo */ }
  throw new CommercialError('Use caminho interno ou link HTTPS sem credenciais.');
}
function noticeId(value: unknown) {
  if (typeof value !== 'string' || !/^[a-z0-9-]{1,100}$/i.test(value)) throw new CommercialError('Aviso inválido.');
  return value;
}

export function parseNoticeMutation(input: unknown, mode: 'create' | 'update') {
  const body = record(input);
  const allowed = new Set(['id', 'expectedVersion', 'titulo', 'mensagem', 'tipo', 'status', 'publico', 'iniciaEm', 'terminaEm',
    'linkLabel', 'linkHref', 'anexoNome', 'anexoBase64', 'notificarApp', 'removerAnexo', 'adminPassword', 'justification']);
  if (Object.keys(body).some(key => !allowed.has(key))) throw new CommercialError('Campos não permitidos no aviso.');
  if (mode === 'create' ? body.expectedVersion !== null || body.id !== undefined
    : (!Number.isSafeInteger(body.expectedVersion) || Number(body.expectedVersion) < 0)) throw new CommercialError('Versão do aviso inválida. Recarregue a tela.', 409);
  if (!TYPES.includes(body.tipo as typeof TYPES[number]) || !AUDIENCES.includes(body.publico as typeof AUDIENCES[number])
    || !MUTABLE_STATUSES.includes(body.status as typeof MUTABLE_STATUSES[number])) throw new CommercialError('Tipo, público ou situação inválidos.');
  if (typeof body.notificarApp !== 'boolean' || (body.removerAnexo !== undefined && typeof body.removerAnexo !== 'boolean')) {
    throw new CommercialError('Opções do aviso inválidas.');
  }
  const startsAt = date(body.iniciaEm, 'Data inicial'), endsAt = date(body.terminaEm, 'Data final');
  if (startsAt && endsAt && endsAt <= startsAt) throw new CommercialError('A data final precisa ser posterior à inicial.');
  if (body.status === 'AGENDADO' && (!startsAt || startsAt <= new Date())) throw new CommercialError('Aviso agendado exige início futuro.');
  const href = safeLink(body.linkHref), linkLabel = boundedText(body.linkLabel, 'Rótulo do link', 80);
  if (href && !linkLabel) throw new CommercialError('Informe o texto do link.');
  if (linkLabel && !href) throw new CommercialError('Informe o destino do link.');
  let attachment: { base64: string; fileName: string } | null = null;
  if (body.anexoBase64) {
    const normalized = normalizeBase64Attachment(body.anexoBase64, body.anexoNome, 2 * 1024 * 1024);
    if (normalized.errorResponse || !normalized.value || !normalized.fileName) throw new CommercialError('Anexo inválido. Use PDF, PNG, JPG ou WEBP de até 2 MB.');
    const match = String(body.anexoBase64).match(/^data:([^;,]+);base64,/i);
    if (!match) throw new CommercialError('O anexo deve informar seu tipo de conteúdo.');
    attachment = { base64: `data:${match[1].toLowerCase()};base64,${normalized.value}`, fileName: normalized.fileName };
  }
  return { id: mode === 'update' ? noticeId(body.id) : null, expectedVersion: body.expectedVersion as number | null,
    adminPassword: body.adminPassword, justification: body.justification,
    data: { titulo: boundedText(body.titulo, 'Título', 120, true)!, mensagem: boundedText(body.mensagem, 'Mensagem', 4000, true)!,
      tipo: body.tipo as string, publico: body.publico as string, status: body.status === 'AGENDADO' ? 'ATIVO' : body.status as string,
      iniciaEm: startsAt, terminaEm: endsAt, linkLabel, linkHref: href, notificarApp: body.notificarApp,
      removeAttachment: body.removerAnexo === true, attachment } };
}

export function parseNoticeArchive(input: unknown) {
  const body = record(input);
  if (Object.keys(body).some(key => !['id', 'expectedVersion', 'adminPassword', 'justification'].includes(key))
    || !Number.isSafeInteger(body.expectedVersion) || Number(body.expectedVersion) < 0) throw new CommercialError('Solicitação de arquivamento inválida.');
  return { id: noticeId(body.id), expectedVersion: Number(body.expectedVersion), adminPassword: body.adminPassword, justification: body.justification };
}

export function serializeNotice<T extends Record<string, unknown>>(notice: T) {
  const starts = notice.iniciaEm instanceof Date ? notice.iniciaEm.getTime() : null;
  const ends = notice.terminaEm instanceof Date ? notice.terminaEm.getTime() : null;
  const now = Date.now(), status = String(notice.status);
  const runtimeStatus = status === 'ATIVO' && starts && starts > now ? 'AGENDADO'
    : status === 'ATIVO' && ends && ends < now ? 'EXPIRADO' : status;
  return { ...notice, runtimeStatus, hasAttachment: Boolean(notice.anexoNome), attachmentHref: notice.anexoNome ? `/api/avisos/${notice.id}/anexo` : null };
}

export async function saveNotice(actorId: string, mutation: ReturnType<typeof parseNoticeMutation>) {
  return prisma.$transaction(async tx => {
    const now = new Date();
    const { removeAttachment, attachment, ...data } = mutation.data;
    if (!mutation.id) {
      const notice = await tx.globalNotice.create({ data: { ...data, anexoNome: attachment?.fileName,
        anexoBase64: attachment?.base64, criadoPorId: actorId, publicadoEm: data.status === 'ATIVO' ? now : null,
        arquivadoEm: data.status === 'ARQUIVADO' ? now : null }, select: noticeMetadataSelect });
      await tx.systemLog.create({ data: { level: 'INFO', action: 'GLOBAL_NOTICE_CREATED', module: 'COMUNICACAO', userId: actorId,
        message: 'Aviso global criado após reautenticação.', details: JSON.stringify({ noticeId: notice.id, status: notice.status,
          audience: notice.publico, hasAttachment: Boolean(notice.anexoNome), justification: String(mutation.justification || '').trim() }) } });
      return serializeNotice(notice);
    }
    await tx.$queryRaw`SELECT "id" FROM "GlobalNotice" WHERE "id" = ${mutation.id} FOR UPDATE`;
    const current = await tx.globalNotice.findUnique({ where: { id: mutation.id } });
    if (!current) throw new CommercialError('Aviso não encontrado.', 404);
    if (current.version !== mutation.expectedVersion) throw new CommercialError('O aviso mudou em outra tela. Recarregue antes de salvar.', 409);
    const notice = await tx.globalNotice.update({ where: { id: current.id }, data: { ...data, version: { increment: 1 },
      anexoNome: removeAttachment ? null : attachment?.fileName ?? current.anexoNome,
      anexoBase64: removeAttachment ? null : attachment?.base64 ?? current.anexoBase64,
      publicadoEm: data.status === 'ATIVO' && current.status !== 'ATIVO' ? now : current.publicadoEm,
      arquivadoEm: data.status === 'ARQUIVADO' ? current.arquivadoEm || now : null }, select: noticeMetadataSelect });
    await tx.systemLog.create({ data: { level: 'INFO', action: 'GLOBAL_NOTICE_UPDATED', module: 'COMUNICACAO', userId: actorId,
      message: 'Aviso global atualizado após reautenticação.', details: JSON.stringify({ noticeId: notice.id, from: current.status,
        to: notice.status, audience: notice.publico, hasAttachment: Boolean(notice.anexoNome), justification: String(mutation.justification || '').trim() }) } });
    return serializeNotice(notice);
  });
}

export async function archiveNotice(actorId: string, mutation: ReturnType<typeof parseNoticeArchive>) {
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "GlobalNotice" WHERE "id" = ${mutation.id} FOR UPDATE`;
    const current = await tx.globalNotice.findUnique({ where: { id: mutation.id } });
    if (!current) throw new CommercialError('Aviso não encontrado.', 404);
    if (current.version !== mutation.expectedVersion) throw new CommercialError('O aviso mudou em outra tela. Recarregue antes de arquivar.', 409);
    if (current.status === 'ARQUIVADO') return serializeNotice(await tx.globalNotice.findUniqueOrThrow({ where: { id: current.id }, select: noticeMetadataSelect }));
    const notice = await tx.globalNotice.update({ where: { id: current.id }, data: { status: 'ARQUIVADO', arquivadoEm: new Date(), version: { increment: 1 } }, select: noticeMetadataSelect });
    await tx.systemLog.create({ data: { level: 'INFO', action: 'GLOBAL_NOTICE_ARCHIVED', module: 'COMUNICACAO', userId: actorId,
      message: 'Aviso global arquivado após reautenticação.', details: JSON.stringify({ noticeId: notice.id,
        justification: String(mutation.justification || '').trim() }) } });
    return serializeNotice(notice);
  });
}
