import bcrypt from 'bcryptjs';
import { createHash } from 'crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/app/utils/prisma';
import { CommercialError } from '@/app/utils/commercial-pricing';
import { getEffectivePlanLimits } from './planService';
import { OWNERSHIP_TERMS, OWNERSHIP_TERMS_VERSION, type OwnershipView } from '@/app/utils/company-ownership';
import { parseOwnershipCreation, parseOwnershipDecision, parseOwnershipQuery, ownershipId } from './companyOwnershipInput';

type Tx = Prisma.TransactionClient;
type Actor = { id: string; sessionVersion: number; sessionId: string };
const STAFF = ['ADMIN', 'MASTER'];
const CUSTOMER = ['COMUM', 'CONTADOR'];
const TTL = 7 * 24 * 60 * 60 * 1000;
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const json = (value: unknown) => JSON.stringify(value);

const companySelect = {
  id: true, documento: true, razaoSocial: true, ambiente: true, arquivadoEm: true,
  proprietarioUserId: true, donoFaturamentoId: true, contadorCustodianteId: true,
  modoCobranca: true, statusPropriedade: true, certificadoVencimento: true,
  donoUser: { select: { id: true } },
  vinculadoA: { where: { revokedAt: null }, select: { id: true, userId: true }, orderBy: { id: 'asc' as const }, take: 201 },
  contadoresLink: { where: { arquivadoEm: null }, select: { id: true, contadorId: true, status: true }, orderBy: { id: 'asc' as const }, take: 201 },
} satisfies Prisma.EmpresaSelect;
const requestInclude = {
  empresa: { select: { documento: true, razaoSocial: true } },
  proposedOwner: { select: { id: true, nome: true, email: true } },
  consents: { select: { userId: true, sessionVersion: true, termsHash: true } },
} satisfies Prisma.CompanyOwnershipRequestInclude;

async function actorAccount(tx: Tx, actor: Actor, passwordRequired = false) {
  const [user, session] = await Promise.all([
    tx.user.findUnique({ where: { id: actor.id }, select: { id: true, role: true, senha: passwordRequired, sessionVersion: true, mfaEnabledAt: true } }),
    tx.authSession.findFirst({ where: { id: actor.sessionId, userId: actor.id, sessionVersion: actor.sessionVersion, revokedAt: null, expiresAt: { gt: new Date() } },
      select: { mfaVerifiedAt: true } }),
  ]);
  if (!user || !session || user.sessionVersion !== actor.sessionVersion) throw new CommercialError('Sessão alterada ou encerrada. Entre novamente.', 401);
  if (STAFF.includes(user.role) && (!user.mfaEnabledAt || !session.mfaVerifiedAt)) throw new CommercialError('MFA administrativo obrigatório.', 428);
  return user;
}
async function verifyPassword(user: { senha?: string }, password: string) {
  if (!user.senha || !await bcrypt.compare(password, user.senha)) throw new CommercialError('Senha atual incorreta.', 403);
}
function snapshot(company: Prisma.EmpresaGetPayload<{ select: typeof companySelect }>, recipient: { id: string; nome: string; email: string; role: string }) {
  if (company.vinculadoA.length > 200 || company.contadoresLink.length > 200) throw new CommercialError('Há mais de 200 vínculos. A transferência exige revisão assistida.', 409);
  return {
    company: { id: company.id, documento: company.documento, razaoSocial: company.razaoSocial, ambiente: company.ambiente,
      arquivadoEm: company.arquivadoEm, proprietarioUserId: company.proprietarioUserId, primaryUserId: company.donoUser?.id ?? null,
      donoFaturamentoId: company.donoFaturamentoId, contadorCustodianteId: company.contadorCustodianteId,
      modoCobranca: company.modoCobranca, statusPropriedade: company.statusPropriedade,
      certificadoVencimento: company.certificadoVencimento,
      operatorLinks: company.vinculadoA, accountantLinks: company.contadoresLink },
    recipient,
  };
}
function requiredIds(request: { proposedOwnerId: string; previousOwnerId: string | null; previousPrimaryUserId: string | null }) {
  return [...new Set([request.proposedOwnerId, request.previousOwnerId, request.previousPrimaryUserId].filter((id): id is string => !!id))];
}
function evidencePayload(row: { id: string; ticketId: string; usuarioId: string; interno: boolean; mensagem: string; createdAt: Date }) {
  return sha(json({ id: row.id, ticketId: row.ticketId, usuarioId: row.usuarioId, interno: row.interno, mensagem: row.mensagem, createdAt: row.createdAt }));
}
async function lockUsers(tx: Tx, ids: Array<string | null | undefined>) {
  for (const id of [...new Set(ids.filter((value): value is string => !!value))].sort()) await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${id} FOR UPDATE`;
}
function view(row: Prisma.CompanyOwnershipRequestGetPayload<{ include: typeof requestInclude }>, actor: { id: string; role: string }): OwnershipView {
  const required = requiredIds(row);
  const accepted = new Set(row.consents.filter(c => c.termsHash === row.snapshotHash).map(c => c.userId));
  const participant = required.includes(actor.id);
  return {
    id: row.id, empresaId: row.empresaId, documento: row.empresa.documento, razaoSocial: row.empresa.razaoSocial,
    recipient: row.proposedOwner, mode: row.mode, status: row.status === 'PENDING' && row.expiresAt <= new Date() ? 'EXPIRED' : row.status,
    termsVersion: row.termsVersion, termsHash: row.snapshotHash, createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(), finishedAt: row.finishedAt?.toISOString() ?? null,
    requiredConsents: required.map((userId, index) => ({ key: `party-${index + 1}`,
      label: userId === actor.id ? 'Você' : userId === row.proposedOwnerId ? 'Conta destinatária' : 'Responsável anterior',
      accepted: accepted.has(userId) })),
    canConsent: row.status === 'PENDING' && row.expiresAt > new Date() && participant && !accepted.has(actor.id),
    canReject: row.status === 'PENDING' && row.expiresAt > new Date() && participant,
    canCancel: row.status === 'PENDING' && row.expiresAt > new Date() && (row.initiatorId === actor.id || STAFF.includes(actor.role)),
    canFinalize: row.status === 'PENDING' && row.expiresAt > new Date() && STAFF.includes(actor.role),
    ...(STAFF.includes(actor.role) ? { initiatorId: row.initiatorId, caseTicketId: row.caseTicketId,
      evidenceMessageId: row.evidenceMessageId, justification: row.justification } : {}),
  };
}

export async function listOwnershipRequests(actor: Actor, input: URLSearchParams) {
  const query = parseOwnershipQuery(input);
  return prisma.$transaction(async tx => {
    const account = await actorAccount(tx, actor);
    const participant = STAFF.includes(account.role) ? {} : { OR: [{ proposedOwnerId: actor.id }, { previousOwnerId: actor.id }, { previousPrimaryUserId: actor.id }] };
    const status = query.status === 'ALL' ? {} : query.status === 'EXPIRED'
      ? { OR: [{ status: 'EXPIRED' }, { status: 'PENDING', expiresAt: { lte: new Date() } }] }
      : query.status === 'PENDING' ? { status: 'PENDING', expiresAt: { gt: new Date() } } : { status: query.status };
    const where: Prisma.CompanyOwnershipRequestWhereInput = { ...participant, ...status, ...(query.empresaId ? { empresaId: query.empresaId } : {}) };
    const [rows, total] = await Promise.all([
      tx.companyOwnershipRequest.findMany({ where, include: requestInclude, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], take: 10, skip: (query.page - 1) * 10 }),
      tx.companyOwnershipRequest.count({ where }),
    ]);
    return { data: rows.map(row => view(row, account)), terms: OWNERSHIP_TERMS,
      meta: { page: query.page, limit: 10, total, totalPages: Math.max(1, Math.ceil(total / 10)) } };
  }, { isolationLevel: 'RepeatableRead' });
}

export async function createOwnershipRequest(actor: Actor, input: unknown) {
  const mutation = parseOwnershipCreation(input);
  for (let attempt = 0; attempt < 3; attempt++) try {
    return await prisma.$transaction(async tx => {
      const reference = await tx.empresa.findUnique({ where: { id: mutation.empresaId }, select: companySelect });
      if (!reference) throw new CommercialError('Empresa não encontrada.', 404);
      const graph = snapshot(reference, { id: '', nome: '', email: '', role: '' });
      const graphUsers = [...graph.company.operatorLinks.map(v => v.userId), ...graph.company.accountantLinks.map(v => v.contadorId),
        graph.company.proprietarioUserId, graph.company.primaryUserId, graph.company.donoFaturamentoId, graph.company.contadorCustodianteId];
      await lockUsers(tx, [actor.id, mutation.proposedOwnerId, ...graphUsers]);
      const admin = await actorAccount(tx, actor, true); await verifyPassword(admin, mutation.password);
      if (!STAFF.includes(admin.role)) throw new CommercialError('Somente administração pode iniciar a verificação.', 403);
      await tx.$queryRaw`SELECT "id" FROM "Empresa" WHERE "id" = ${mutation.empresaId} FOR UPDATE`;
      const [company, recipient, ticket, evidence, prior] = await Promise.all([
        tx.empresa.findUniqueOrThrow({ where: { id: mutation.empresaId }, select: companySelect }),
        tx.user.findUnique({ where: { id: mutation.proposedOwnerId }, select: { id: true, nome: true, email: true, role: true } }),
        tx.ticket.findUnique({ where: { id: mutation.caseTicketId }, select: { id: true, solicitanteId: true, arquivadoEm: true } }),
        tx.ticketMensagem.findUnique({ where: { id: mutation.evidenceMessageId }, select: { id: true, ticketId: true, usuarioId: true, interno: true, mensagem: true, createdAt: true } }),
        tx.companyOwnershipRequest.findUnique({ where: { id: mutation.requestId }, include: requestInclude }),
      ]);
      if (prior) {
        if (prior.empresaId !== mutation.empresaId || prior.proposedOwnerId !== mutation.proposedOwnerId || prior.caseTicketId !== mutation.caseTicketId || prior.evidenceMessageId !== mutation.evidenceMessageId) throw new CommercialError('Este identificador já pertence a outra solicitação.', 409);
        return { success: true, created: false, request: view(prior, admin) };
      }
      if (company.arquivadoEm) throw new CommercialError('Restaure a empresa antes de solicitar a transferência.', 409);
      if (company.documento !== mutation.confirmedCnpj) throw new CommercialError('O CNPJ confirmado não corresponde à empresa.', 409);
      if (!recipient || !CUSTOMER.includes(recipient.role) || /@(reset\.invalid|example\.invalid)$/i.test(recipient.email)) throw new CommercialError('A conta destinatária deve ser cliente ou contador ativo, com e-mail real.', 409);
      if (!ticket || ticket.arquivadoEm || ticket.solicitanteId !== recipient.id) throw new CommercialError('Use um chamado ativo aberto pela conta destinatária.', 409);
      if (!evidence || evidence.ticketId !== ticket.id || evidence.usuarioId !== actor.id || !evidence.interno || evidence.mensagem.trim().length < 10) throw new CommercialError('A evidência deve ser uma nota interna deste chamado, registrada pelo administrador atual.', 409);
      const previousOwnerId = company.proprietarioUserId || company.donoUser?.id || null;
      const previousPrimaryUserId = company.donoUser?.id ?? null;
      const mode = previousOwnerId || previousPrimaryUserId ? 'TRANSFER' : 'RECOVERY';
      if (mode === 'TRANSFER' && previousOwnerId === recipient.id && (!previousPrimaryUserId || previousPrimaryUserId === recipient.id)) throw new CommercialError('A conta já é a responsável registrada.', 409);
      if (mode === 'TRANSFER') {
        const former = await tx.user.findMany({ where: { id: { in: [...new Set([previousOwnerId, previousPrimaryUserId].filter((id): id is string => !!id))] } },
          select: { id: true, role: true } });
        if (former.some(user => !CUSTOMER.includes(user.role))) throw new CommercialError('O responsável anterior é uma conta interna ou inelegível. Corrija esse dado legado antes da transferência.', 409);
      }
      if (mode === 'RECOVERY' && (company.donoFaturamentoId || company.contadorCustodianteId || company.vinculadoA.length || company.contadoresLink.length)) throw new CommercialError('Empresa sem titular, mas com responsáveis ou vínculos ativos. Regularize esses vínculos antes da recuperação.', 409);
      const currentSnapshot = snapshot(company, recipient);
      const createdAt = new Date(), expiresAt = new Date(createdAt.getTime() + TTL);
      const immutable = { requestId: mutation.requestId, termsVersion: OWNERSHIP_TERMS_VERSION, terms: OWNERSHIP_TERMS,
        mode, company: currentSnapshot.company, recipient: currentSnapshot.recipient, previousOwnerId, previousPrimaryUserId,
        initiatorId: actor.id, caseTicketId: ticket.id, evidenceHash: evidencePayload(evidence), createdAt, expiresAt };
      const snapshotHash = sha(json(immutable));
      const pending = await tx.companyOwnershipRequest.findFirst({ where: { empresaId: company.id, status: 'PENDING' }, select: { id: true, expiresAt: true } });
      if (pending?.expiresAt && pending.expiresAt > createdAt) throw new CommercialError('Já existe uma solicitação pendente para esta empresa.', 409);
      if (pending) await tx.companyOwnershipRequest.update({ where: { id: pending.id }, data: { status: 'EXPIRED', finishedAt: createdAt, resolvedById: actor.id } });
      const saved = await tx.companyOwnershipRequest.create({ data: { id: mutation.requestId, empresaId: company.id, initiatorId: actor.id,
        proposedOwnerId: recipient.id, previousOwnerId, previousPrimaryUserId, mode, termsVersion: OWNERSHIP_TERMS_VERSION,
        ownershipSnapshotJson: json(immutable), snapshotHash, caseTicketId: ticket.id, evidenceMessageId: evidence.id,
        evidenceHash: evidencePayload(evidence), justification: mutation.justification, createdAt, expiresAt }, include: requestInclude });
      await tx.systemLog.create({ data: { level: 'ALERTA', module: 'TITULARIDADE', action: 'OWNERSHIP_REQUEST_CREATED',
        userId: actor.id, empresaId: company.id, message: 'Verificação de responsável criada; nenhum acesso foi concedido.',
        details: json({ requestId: saved.id, mode, recipientId: recipient.id, previousOwnerId, previousPrimaryUserId,
          caseTicketId: ticket.id, evidenceMessageId: evidence.id, evidenceHash: saved.evidenceHash, justification: mutation.justification }) } });
      for (const userId of requiredIds(saved)) await tx.appNotification.upsert({ where: { recipientId_eventKey: { recipientId: userId, eventKey: `ownership:pending:${saved.id}` } },
        create: { recipientId: userId, empresaId: company.id, type: 'TITULARIDADE', title: 'Consentimento de transferência pendente',
          message: 'Revise a solicitação em Configurações. Nenhum acesso foi alterado.', eventKey: `ownership:pending:${saved.id}`, priority: 'HIGH',
          payloadJson: json({ href: '/configuracoes/titularidade', requestId: saved.id }) },
        update: { status: 'UNREAD', readAt: null, deliveredAt: null } });
      return { success: true, created: true, request: view(saved, admin) };
    }, { isolationLevel: 'ReadCommitted', timeout: 25000, maxWait: 5000 });
  } catch (error) {
    const code = (error as { code?: string })?.code;
    if (code === 'P2034' && attempt < 2) continue;
    if (['P2034', 'P2002'].includes(code || '')) throw new CommercialError('A titularidade mudou em outra operação. Recarregue e confira.', 409);
    throw error;
  }
  throw new CommercialError('Operação não concluída.', 409);
}

async function unresolvedFiscal(tx: Tx, companyId: string) {
  const [jobs, operations, leases] = await Promise.all([
    tx.emissaoJob.count({ where: { empresaId: companyId, OR: [
      { status: { notIn: ['AUTORIZADA', 'ERRO_FINAL'] } }, { creditReservation: { is: { status: 'RESERVED' } } },
      { status: 'ERRO_FINAL', transmissionStartedAt: { not: null }, OR: [{ creditReservation: { is: null } }, { creditReservation: { is: { status: { not: 'RELEASED' } } } }] },
    ] } }),
    tx.fiscalNoteOperation.count({ where: { empresaId: companyId, status: { in: ['PENDENTE', 'PROCESSANDO', 'ERRO_TEMPORARIO', 'RECONCILIACAO_MANUAL'] } } }),
    tx.dpsSequencia.count({ where: { empresaId: companyId, syncLockedUntil: { gt: new Date() } } }),
  ]);
  return jobs + operations + leases;
}

export async function decideOwnershipRequest(actor: Actor, input: unknown) {
  const mutation = parseOwnershipDecision(input);
  const reference = await prisma.companyOwnershipRequest.findUnique({ where: { id: mutation.requestId },
    select: { empresaId: true, proposedOwnerId: true, previousOwnerId: true, previousPrimaryUserId: true, initiatorId: true } });
  if (!reference) throw new CommercialError('Solicitação não encontrada.', 404);
  for (let attempt = 0; attempt < 3; attempt++) try {
    return await prisma.$transaction(async tx => {
      await lockUsers(tx, [actor.id, reference.proposedOwnerId, reference.previousOwnerId, reference.previousPrimaryUserId]);
      const account = await actorAccount(tx, actor, true); await verifyPassword(account, mutation.password);
      await tx.$queryRaw`SELECT "id" FROM "Empresa" WHERE "id" = ${reference.empresaId} FOR UPDATE`;
      await tx.$queryRaw`SELECT "id" FROM "CompanyOwnershipRequest" WHERE "id" = ${mutation.requestId} FOR UPDATE`;
      let request = await tx.companyOwnershipRequest.findUnique({ where: { id: mutation.requestId }, include: requestInclude });
      if (!request) throw new CommercialError('Solicitação não encontrada.', 404);
      if (request.status !== 'PENDING') return { success: true, changed: false, request: view(request, account) };
      const now = new Date();
      if (request.expiresAt <= now) {
        request = await tx.companyOwnershipRequest.update({ where: { id: request.id }, data: { status: 'EXPIRED', finishedAt: now, resolvedById: actor.id }, include: requestInclude });
        return { success: true, changed: true, request: view(request, account) };
      }
      if (request.snapshotHash !== mutation.termsHash || request.empresa.documento !== mutation.confirmedCnpj) throw new CommercialError('Solicitação ou CNPJ divergente. Recarregue antes de confirmar.', 409);
      const needed = requiredIds(request), participant = needed.includes(actor.id), staff = STAFF.includes(account.role);
      if (mutation.action === 'ACCEPT') {
        if (!participant || !CUSTOMER.includes(account.role)) throw new CommercialError('Somente um participante pode aceitar com sua própria conta.', 403);
        await tx.companyOwnershipConsent.upsert({ where: { requestId_userId: { requestId: request.id, userId: actor.id } },
          create: { requestId: request.id, userId: actor.id, sessionVersion: account.sessionVersion, termsHash: request.snapshotHash },
          update: { sessionVersion: account.sessionVersion, termsHash: request.snapshotHash, acceptedAt: now } });
        await tx.systemLog.create({ data: { level: 'ALERTA', module: 'TITULARIDADE', action: 'OWNERSHIP_CONSENT_RECORDED',
          userId: actor.id, empresaId: request.empresaId, message: 'Consentimento individual registrado com reautenticação.',
          details: json({ requestId: request.id, termsHash: request.snapshotHash }) } });
        request = await tx.companyOwnershipRequest.findUniqueOrThrow({ where: { id: request.id }, include: requestInclude });
        return { success: true, changed: true, request: view(request, account) };
      }
      if (mutation.action === 'REJECT') {
        if (!participant) throw new CommercialError('Somente um participante pode rejeitar esta solicitação.', 403);
        request = await tx.companyOwnershipRequest.update({ where: { id: request.id }, data: { status: 'REJECTED', finishedAt: now,
          resolvedById: actor.id, resolutionJustification: mutation.justification }, include: requestInclude });
      } else if (mutation.action === 'CANCEL') {
        if (!staff && request.initiatorId !== actor.id) throw new CommercialError('Somente a administração pode cancelar.', 403);
        request = await tx.companyOwnershipRequest.update({ where: { id: request.id }, data: { status: 'CANCELLED', finishedAt: now,
          resolvedById: actor.id, resolutionJustification: mutation.justification }, include: requestInclude });
      } else {
        if (!staff) throw new CommercialError('Somente a administração pode concluir.', 403);
        if (request.mode === 'RECOVERY' && (account.role !== 'MASTER' || request.initiatorId === actor.id)) throw new CommercialError('Recuperação exige outro usuário MASTER como revisor independente.', 403);
        if (!mutation.reviewEvidenceMessageId) throw new CommercialError('Informe a nota interna da revisão final.', 400);
        const review = await tx.ticketMensagem.findUnique({ where: { id: mutation.reviewEvidenceMessageId }, select: { id: true, ticketId: true, usuarioId: true, interno: true, mensagem: true, createdAt: true } });
        if (!review || review.ticketId !== request.caseTicketId || review.usuarioId !== actor.id || !review.interno || review.mensagem.trim().length < 10) throw new CommercialError('A revisão final deve ser uma nota interna deste chamado, escrita pelo revisor atual.', 409);
        const company = await tx.empresa.findUniqueOrThrow({ where: { id: request.empresaId }, select: companySelect });
        const recipient = await tx.user.findUniqueOrThrow({ where: { id: request.proposedOwnerId }, select: { id: true, nome: true, email: true, role: true } });
        const original = JSON.parse(request.ownershipSnapshotJson) as { company: unknown; recipient: unknown };
        if (json(snapshot(company, recipient)) !== json({ company: original.company, recipient: original.recipient })) throw new CommercialError('Cadastro ou vínculos mudaram desde o consentimento. Cancele e abra nova verificação.', 409);
        const validConsents = await tx.companyOwnershipConsent.findMany({ where: { requestId: request.id, termsHash: request.snapshotHash },
          select: { userId: true, sessionVersion: true } });
        const versions = await tx.user.findMany({ where: { id: { in: needed } }, select: { id: true, role: true, sessionVersion: true } });
        if (needed.some(id => !validConsents.some(c => c.userId === id && versions.some(u => u.id === id && CUSTOMER.includes(u.role) && u.sessionVersion === c.sessionVersion)))) throw new CommercialError('Falta consentimento válido ou uma senha/sessão de participante mudou. Cada participante deve aceitar novamente.', 409);
        const limits = await getEffectivePlanLimits(recipient.id, tx);
        const alreadyCounted = company.proprietarioUserId === recipient.id || company.donoFaturamentoId === recipient.id || company.donoUser?.id === recipient.id ||
          company.contadoresLink.some(link => link.contadorId === recipient.id && link.status === 'APROVADO');
        if (!limits.allowedBase || (!alreadyCounted && limits.empresasUsadas >= limits.limiteEmpresas)) throw new CommercialError('A conta destinatária precisa de assinatura vigente e cota para esta empresa.', 409);
        const portfolioSize = await tx.vinculoCarteira.count({ where: { empresaId: company.id, arquivadoEm: null } });
        if (!alreadyCounted && limits.clientesUsados + portfolioSize > limits.limiteClientes) throw new CommercialError('A carteira transferida excederia a cota de tomadores da conta destinatária.', 409);
        if (await unresolvedFiscal(tx, company.id)) throw new CommercialError('Há emissão, reserva de crédito, operação fiscal ou sincronização ainda pendente. Concilie antes de transferir.', 409);
        await tx.userCliente.updateMany({ where: { empresaId: company.id, revokedAt: null }, data: { revokedAt: now, revokedBy: actor.id, revocationReason: 'Titularidade transferida após consentimentos verificados.' } });
        await tx.contadorVinculo.updateMany({ where: { empresaId: company.id, arquivadoEm: null }, data: { status: 'DESVINCULADO', arquivadoEm: now,
          arquivadoPor: actor.id, motivoArquivamento: 'Titularidade transferida após consentimentos verificados.' } });
        await tx.user.updateMany({ where: { empresaId: company.id, id: { not: recipient.id } }, data: { empresaId: null } });
        if (!recipient.role || !CUSTOMER.includes(recipient.role)) throw new CommercialError('Conta destinatária deixou de ser elegível.', 409);
        const targetFresh = await tx.user.findUniqueOrThrow({ where: { id: recipient.id }, select: { empresaId: true } });
        if (!targetFresh.empresaId) await tx.user.update({ where: { id: recipient.id }, data: { empresaId: company.id } });
        await tx.empresa.update({ where: { id: company.id }, data: { proprietarioUserId: recipient.id, donoFaturamentoId: recipient.id,
          contadorCustodianteId: null, modoCobranca: 'RESPONSAVEL_UNICO', statusPropriedade: 'PROPRIETARIA',
          certificadoA1: null, senhaCertificado: null, certificadoVencimento: null,
          certificadoCnpj: null, certificadoFingerprintSha256: null, certificadoValidadoEm: null,
          certificadoChainStatus: null, certificadoCnpjSource: null,
          ambiente: 'HOMOLOGACAO', cadastroCompleto: false } });
        request = await tx.companyOwnershipRequest.update({ where: { id: request.id }, data: { status: 'COMPLETED', finishedAt: now,
          reviewerId: actor.id, resolvedById: actor.id, reviewEvidenceMessageId: review.id, reviewEvidenceHash: evidencePayload(review),
          resolutionJustification: mutation.justification }, include: requestInclude });
      }
      await tx.systemLog.create({ data: { level: 'ALERTA', module: 'TITULARIDADE', action: `OWNERSHIP_REQUEST_${request.status}`,
        userId: actor.id, empresaId: request.empresaId, message: request.status === 'COMPLETED'
          ? 'Responsável do cadastro transferido; histórico preservado, acessos anteriores revogados e certificado removido.'
          : 'Solicitação encerrada sem alterar acesso ou titularidade.',
        details: json({ requestId: request.id, status: request.status, termsHash: request.snapshotHash,
          justification: mutation.justification, reviewEvidenceMessageId: mutation.reviewEvidenceMessageId }) } });
      for (const userId of needed) await tx.appNotification.upsert({ where: { recipientId_eventKey: { recipientId: userId, eventKey: `ownership:finished:${request.id}` } },
        create: { recipientId: userId, empresaId: request.empresaId, type: 'TITULARIDADE', title: 'Verificação de titularidade encerrada',
          message: request.status === 'COMPLETED' ? 'A transferência foi concluída. Consulte o protocolo de atendimento.' : 'A solicitação foi encerrada sem transferência.',
          eventKey: `ownership:finished:${request.id}`, priority: 'HIGH', payloadJson: json({ href: '/configuracoes/titularidade', requestId: request.id }) },
        update: { status: 'UNREAD', readAt: null, deliveredAt: null } });
      return { success: true, changed: true, request: view(request, account) };
    }, { isolationLevel: 'ReadCommitted', timeout: 25000, maxWait: 5000 });
  } catch (error) {
    const code = (error as { code?: string })?.code;
    if (code === 'P2034' && attempt < 2) continue;
    if (code === 'P2034') throw new CommercialError('Operação concorrente. Recarregue a solicitação.', 409);
    throw error;
  }
  throw new CommercialError('Operação não concluída.', 409);
}
