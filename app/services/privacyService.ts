import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '@/app/utils/prisma';
import { privacyContactEmail, privacyVersion, termsVersion } from '@/app/legal-content';

export const PRIVACY_REQUEST_TYPES = [
  'ACESSO', 'CORRECAO', 'ELIMINACAO', 'PORTABILIDADE', 'REVOGACAO_CONSENTIMENTO',
  'OPOSICAO', 'REVISAO_AUTOMATIZADA', 'INFORMACAO_COMPARTILHAMENTO',
] as const;
export type PrivacyRequestType = typeof PRIVACY_REQUEST_TYPES[number];
const OPEN_STATUSES = ['PENDENTE', 'EM_ANALISE', 'AGUARDANDO_TITULAR'];

export class PrivacyError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new PrivacyError('Solicitação inválida.');
  return value as Record<string, unknown>;
}

function strict(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new PrivacyError('Há campos não permitidos nesta solicitação.');
}

function limitedText(value: unknown, label: string, max: number, min = 0) {
  // eslint-disable-next-line no-control-regex -- campos regulatórios devem rejeitar bytes de controle.
  if (typeof value !== 'string' || value.length > max || value.trim().length < min || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new PrivacyError(`${label} inválida.`);
  }
  return value.trim();
}

export function parsePrivacyRequestInput(input: unknown) {
  const body = object(input);
  strict(body, ['type', 'description', 'password']);
  const type = String(body.type || '').toUpperCase() as PrivacyRequestType;
  if (!PRIVACY_REQUEST_TYPES.includes(type)) throw new PrivacyError('Selecione um direito válido.');
  const description = body.description == null || body.description === '' ? null : limitedText(body.description, 'Descrição', 2000, 10);
  const password = limitedText(body.password, 'Senha', 72, 1);
  return { type, description, password };
}

export function parsePrivacyResolutionInput(input: unknown) {
  const body = object(input);
  strict(body, ['id', 'action', 'version', 'resolutionSummary', 'legalBasis', 'password', 'justification']);
  const id = limitedText(body.id, 'Protocolo', 100, 1);
  if (!/^[a-z0-9-]+$/i.test(id)) throw new PrivacyError('Protocolo inválido.');
  const action = String(body.action || '').toUpperCase();
  if (!['INICIAR', 'SOLICITAR_INFO', 'CONCLUIR', 'RECUSAR', 'ANONIMIZAR'].includes(action)) throw new PrivacyError('Ação inválida.');
  if (!Number.isInteger(body.version) || Number(body.version) < 1) throw new PrivacyError('Versão ausente. Atualize a tela.');
  const resolutionSummary = ['CONCLUIR', 'RECUSAR', 'SOLICITAR_INFO', 'ANONIMIZAR'].includes(action)
    ? limitedText(body.resolutionSummary, 'Resposta ao titular', 4000, 15) : null;
  const legalBasis = action === 'RECUSAR' ? limitedText(body.legalBasis, 'Fundamentação legal', 3000, 15)
    : body.legalBasis == null || body.legalBasis === '' ? null : limitedText(body.legalBasis, 'Fundamentação legal', 3000, 10);
  return { id, action, version: Number(body.version), resolutionSummary, legalBasis };
}

async function accountWithPassword(userId: string, password: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, senha: true, privacyErasedAt: true } });
  if (!user || user.privacyErasedAt || !await bcrypt.compare(password, user.senha)) throw new PrivacyError('Senha atual incorreta.', 403);
  return user;
}

export async function createPrivacyRequest(userId: string, input: unknown) {
  const parsed = parsePrivacyRequestInput(input);
  await accountWithPassword(userId, parsed.password);
  const now = new Date();
  const dueAt = new Date(now.getTime() + 15 * 24 * 60 * 60 * 1000);
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
    const existing = await tx.privacyRequest.findFirst({ where: { userId, type: parsed.type, status: { in: OPEN_STATUSES } }, orderBy: { createdAt: 'desc' } });
    if (existing) return { request: existing, created: false };
    const request = await tx.privacyRequest.create({ data: { userId, type: parsed.type, description: parsed.description,
      identityVerifiedAt: now, dueAt } });
    await tx.systemLog.create({ data: { level: 'INFO', action: 'PRIVACY_REQUEST_CREATED', module: 'PRIVACIDADE', userId,
      message: 'Solicitação de direito do titular registrada.', details: JSON.stringify({ requestId: request.id, type: request.type, dueAt }) } });
    return { request, created: true };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function privacyOverview(userId: string) {
  const [user, requests, activeSessions, companies, plans, orders, invoices, tickets] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { nome: true, email: true, cpf: true, telefone: true, createdAt: true,
      updatedAt: true, lastLoginAt: true, mfaEnabledAt: true, notificacoesEmail: true, privacyErasedAt: true } }),
    prisma.privacyRequest.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 50,
      select: { id: true, type: true, status: true, description: true, dueAt: true, resolutionSummary: true, legalBasis: true, resolvedAt: true, version: true, createdAt: true, updatedAt: true } }),
    prisma.authSession.count({ where: { userId, revokedAt: null, expiresAt: { gt: new Date() } } }),
    prisma.empresa.count({ where: { arquivadoEm: null, OR: [{ proprietarioUserId: userId }, { donoFaturamentoId: userId }, { contadorCustodianteId: userId }] } }),
    prisma.planHistory.count({ where: { userId } }), prisma.pedido.count({ where: { userId } }),
    prisma.fatura.count({ where: { userId } }), prisma.ticket.count({ where: { solicitanteId: userId } }),
  ]);
  if (!user || user.privacyErasedAt) throw new PrivacyError('Conta indisponível.', 404);
  return { controllerContact: privacyContactEmail, treatmentExists: true, currentPolicyVersion: privacyVersion,
    account: user, counts: { activeSessions, companies, plans, orders, invoices, tickets }, requests };
}

export async function privacyAccountExport(userId: string, password: string) {
  if (typeof password !== 'string' || !password || Buffer.byteLength(password, 'utf8') > 72) throw new PrivacyError('Senha atual obrigatória.');
  await accountWithPassword(userId, password);
  const [account, acceptances, sessions, planHistory, orders, invoices, crmEvents, tickets, messages, requests, accessLinks] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, nome: true, cpf: true, telefone: true, role: true,
      plano: true, planoCiclo: true, planoStatus: true, planoExpiresAt: true, cargo: true, darkMode: true, idioma: true,
      notificacoesEmail: true, lastLoginAt: true, createdAt: true, updatedAt: true, mfaEnabledAt: true } }),
    prisma.legalAcceptance.findMany({ where: { userId }, orderBy: { acceptedAt: 'asc' }, select: { termsVersion: true, privacyVersion: true, acceptedAt: true, source: true } }),
    prisma.authSession.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 500,
      select: { id: true, ipAddress: true, userAgent: true, createdAt: true, expiresAt: true, revokedAt: true, mfaVerifiedAt: true } }),
    prisma.planHistory.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 1000,
      select: { id: true, planId: true, dataInicio: true, dataFim: true, status: true, notasEmitidas: true, limiteNotasContratado: true,
        limiteClientesContratado: true, tipoContratado: true, nomeContratado: true, cicloInicio: true, pedidoId: true, createdAt: true } }),
    prisma.pedido.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 1000,
      select: { id: true, planoSlug: true, ciclo: true, notasAdicionais: true, valorPlano: true, valorAdicionais: true, valorTotal: true,
        status: true, formaPagamento: true, referenciaPagamento: true, createdAt: true, updatedAt: true } }),
    prisma.fatura.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 1000,
      select: { id: true, planoId: true, descricao: true, valorTotal: true, status: true, metodo: true, txid: true, pagoEm: true, createdAt: true, updatedAt: true } }),
    prisma.userEvent.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 5000 }),
    prisma.ticket.findMany({ where: { solicitanteId: userId }, orderBy: { createdAt: 'desc' }, take: 1000,
      select: { id: true, protocolo: true, assunto: true, categoria: true, prioridade: true, descricao: true, status: true,
        anexoNome: true, createdAt: true, updatedAt: true, arquivadoEm: true } }),
    prisma.ticketMensagem.findMany({ where: { usuarioId: userId, interno: false }, orderBy: { createdAt: 'desc' }, take: 5000,
      select: { id: true, ticketId: true, mensagem: true, anexoNome: true, createdAt: true } }),
    prisma.privacyRequest.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 1000,
      select: { id: true, type: true, status: true, description: true, identityVerifiedAt: true, dueAt: true,
        resolutionSummary: true, legalBasis: true, resolvedAt: true, createdAt: true, updatedAt: true } }),
    prisma.userCliente.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 1000,
      select: { empresaId: true, apelido: true, createdAt: true, revokedAt: true, revocationReason: true } }),
  ]);
  if (!account) throw new PrivacyError('Conta indisponível.', 404);
  await prisma.systemLog.create({ data: { level: 'INFO', action: 'PRIVACY_EXPORT_DOWNLOADED', module: 'PRIVACIDADE', userId,
    message: 'Titular baixou cópia simplificada dos próprios dados.', details: JSON.stringify({ format: 'JSON', generatedAt: new Date() }) } });
  return { exportVersion: '1.0', generatedAt: new Date().toISOString(), controllerContact: privacyContactEmail,
    legalVersions: { termsVersion, privacyVersion }, scope: 'Dados pessoais da conta e histórico diretamente associado; segredos, anexos binários e notas internas de suporte foram excluídos.',
    data: { account, acceptances, sessions, planHistory, orders, invoices, crmEvents, tickets, messages, requests, accessLinks },
    limits: 'Coleções são limitadas a 5.000 registros por categoria nesta cópia imediata. Solicite ACESSO ou PORTABILIDADE para uma resposta completa quando necessário.' };
}

async function erasureBlockers(tx: Prisma.TransactionClient, userId: string) {
  const [companies, activePlans, pendingOrders, custody, fiscalJobs, ownership, tickets] = await Promise.all([
    tx.empresa.count({ where: { arquivadoEm: null, OR: [{ proprietarioUserId: userId }, { donoFaturamentoId: userId }] } }),
    tx.planHistory.count({ where: { userId, status: { in: ['ATIVO', 'AGENDADO', 'SUSPENSO'] }, arquivadoEm: null } }),
    tx.pedido.count({ where: { userId, status: { in: ['PENDENTE', 'EM_ANALISE'] }, arquivadoEm: null } }),
    tx.empresa.count({ where: { contadorCustodianteId: userId, arquivadoEm: null } }),
    tx.emissaoJob.count({ where: { actorUserId: userId, status: { in: ['PENDENTE', 'PROCESSANDO', 'ENVIANDO', 'CONCILIANDO', 'RECONCILIACAO_MANUAL'] } } }),
    tx.companyOwnershipRequest.count({ where: { status: { in: ['PENDING', 'REVIEWED', 'CONSENTING'] }, OR: [
      { initiatorId: userId }, { proposedOwnerId: userId }, { previousOwnerId: userId }, { previousPrimaryUserId: userId },
    ] } }),
    tx.ticket.count({ where: { OR: [{ solicitanteId: userId }, { atendenteId: userId }] } }),
  ]);
  return { companies, activePlans, pendingOrders, custody, fiscalJobs, ownership, tickets };
}

export async function resolvePrivacyRequest(actorId: string, input: unknown) {
  const parsed = parsePrivacyResolutionInput(input);
  const replacementPassword = parsed.action === 'ANONIMIZAR' ? await bcrypt.hash(randomBytes(48).toString('base64url'), 12) : null;
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "PrivacyRequest" WHERE "id" = ${parsed.id} FOR UPDATE`;
    const request = await tx.privacyRequest.findUnique({ where: { id: parsed.id }, include: { subject: { select: { id: true, role: true, privacyErasedAt: true } } } });
    if (!request) throw new PrivacyError('Solicitação não encontrada.', 404);
    if (request.version !== parsed.version) throw new PrivacyError('Solicitação alterada por outra pessoa. Atualize a tela.', 409);
    if (['CONCLUIDA', 'RECUSADA'].includes(request.status)) throw new PrivacyError('Solicitação já encerrada.', 409);

    if (parsed.action === 'ANONIMIZAR') {
      if (request.type !== 'ELIMINACAO') throw new PrivacyError('Anonimização exige solicitação de eliminação.', 409);
      if (!['COMUM', 'CONTADOR'].includes(request.subject.role) || request.subject.privacyErasedAt) throw new PrivacyError('Esta conta exige tratamento manual.', 409);
      const blockers = await erasureBlockers(tx, request.userId);
      const pending = Object.entries(blockers).filter(([, count]) => count > 0).map(([name]) => name);
      if (pending.length) throw new PrivacyError(`Anonimização bloqueada até concluir: ${pending.join(', ')}.`, 409);
      const now = new Date();
      await tx.authSession.deleteMany({ where: { userId: request.userId } });
      await tx.passwordResetRequest.deleteMany({ where: { userId: request.userId } });
      await tx.impersonationSession.updateMany({ where: { OR: [{ actorUserId: request.userId }, { targetUserId: request.userId }], revokedAt: null }, data: { revokedAt: now } });
      await tx.userCliente.updateMany({ where: { userId: request.userId, revokedAt: null }, data: { revokedAt: now, revokedBy: actorId, revocationReason: 'PRIVACY_ERASURE' } });
      await tx.contadorVinculo.updateMany({ where: { contadorId: request.userId, arquivadoEm: null }, data: { arquivadoEm: now, arquivadoPor: actorId, motivoArquivamento: 'PRIVACY_ERASURE' } });
      await tx.user.update({ where: { id: request.userId }, data: {
        email: `erased-${randomBytes(16).toString('hex')}@anon.invalid`, senha: replacementPassword!, sessionVersion: { increment: 1 },
        nome: 'Titular anonimizado', cpf: null, telefone: null, cargo: null, avatarUrl: null, ipOrigem: null, lastLoginAt: null,
        resetToken: null, resetExpires: null, tempEmail: null, verificationCode: null, verificationExpires: null,
        mfaSecret: null, mfaPendingSecret: null, mfaPendingExpires: null, mfaEnabledAt: null, mfaRecoveryCodes: null, mfaLastUsedStep: -1,
        notificacoesEmail: false, empresaId: null, planoStatus: 'privacy_erased', planoExpiresAt: now, privacyErasedAt: now,
      } });
    }

    const status = parsed.action === 'INICIAR' ? 'EM_ANALISE' : parsed.action === 'SOLICITAR_INFO' ? 'AGUARDANDO_TITULAR'
      : parsed.action === 'RECUSAR' ? 'RECUSADA' : 'CONCLUIDA';
    const terminal = ['CONCLUIDA', 'RECUSADA'].includes(status);
    const updated = await tx.privacyRequest.update({ where: { id: request.id }, data: { status,
      resolutionSummary: parsed.resolutionSummary ?? request.resolutionSummary, legalBasis: parsed.legalBasis ?? request.legalBasis,
      resolvedById: actorId, resolvedAt: terminal ? new Date() : null, version: { increment: 1 } } });
    await tx.systemLog.create({ data: { level: 'INFO', action: `PRIVACY_REQUEST_${parsed.action}`, module: 'PRIVACIDADE', userId: actorId,
      message: 'Solicitação de titular atualizada.', details: JSON.stringify({ requestId: request.id, subjectId: request.userId, status }) } });
    if (parsed.action !== 'ANONIMIZAR') await tx.appNotification.upsert({ where: { recipientId_eventKey: {
      recipientId: request.userId, eventKey: `PRIVACY_REQUEST:${request.id}:${updated.version}` } }, update: {}, create: {
      recipientId: request.userId, type: 'PRIVACY_REQUEST_UPDATED', title: 'Solicitação de privacidade atualizada',
      message: `O protocolo ${request.id} está com o estado ${status}. Consulte a Central de Privacidade para ler a resposta.`,
      eventKey: `PRIVACY_REQUEST:${request.id}:${updated.version}`, priority: 'NORMAL', payloadJson: JSON.stringify({ requestId: request.id, status }),
    } });
    return updated;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
