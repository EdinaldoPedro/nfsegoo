import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import type { Role } from '@prisma/client';
import { prisma } from '@/app/utils/prisma';
import { validarCPF } from '@/app/utils/cpf';
import { CommercialError } from '@/app/utils/commercial-pricing';
import { passwordPolicyError } from '@/app/utils/password-policy';
import { privacyVersion, termsVersion } from '@/app/legal-content';
import { privateHash } from '@/app/utils/private-hash';

export class RegistrationConflictError extends CommercialError {
  constructor(public readonly fields: Array<'email' | 'cpf'>, public readonly pending = false) {
    super(fields.length > 1 ? 'E-mail e CPF já estão associados a outro cadastro.'
      : fields[0] === 'email' ? 'Este e-mail já está associado a outro cadastro.' : 'Este CPF já está associado a outro cadastro.', 409);
  }
}

function record(input: unknown, message = 'Envie dados válidos.') {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new CommercialError(message);
  return input as Record<string, unknown>;
}
function strict(body: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(body).some(key => !allowed.includes(key))) throw new CommercialError('Campos não permitidos.');
}
function registrationCodeHash(email: string, code: string) {
  return privateHash('registration-code', email + ':' + code);
}
function sameHash(left: string, right: string) {
  return /^[a-f0-9]{64}$/.test(left) && crypto.timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}

export function parseRegistrationInput(input: unknown) {
  const body = record(input);
  strict(body, ['nome', 'email', 'documento', 'cpf', 'telefone', 'senha', 'legalAcceptance']);
  const nome = typeof body.nome === 'string' ? body.nome.trim().replace(/\s+/g, ' ') : '';
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const fromDocument = typeof body.documento === 'string' ? body.documento.replace(/\D/g, '') : '';
  const fromCpf = typeof body.cpf === 'string' ? body.cpf.replace(/\D/g, '') : '';
  const cpf = fromDocument || fromCpf;
  const telefone = typeof body.telefone === 'string' ? body.telefone.trim() : '';
  const acceptance = record(body.legalAcceptance, 'Confirme os documentos legais vigentes.');
  strict(acceptance, ['accepted', 'termsVersion', 'privacyVersion']);
  if (acceptance.accepted !== true || acceptance.termsVersion !== termsVersion || acceptance.privacyVersion !== privacyVersion) {
    throw new CommercialError('Os Termos e a Política mudaram. Recarregue, leia e confirme as versões vigentes.', 409);
  }
  if (nome.length < 2 || nome.length > 160 || !/^[\p{L}\p{M}][\p{L}\p{M} .'-]*[\p{L}\p{M}]$/u.test(nome)) {
    throw new CommercialError('Informe seu nome completo usando letras, espaços, apóstrofo ou hífen.');
  }
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new CommercialError('Informe um e-mail válido.');
  if ((fromDocument && fromCpf && fromDocument !== fromCpf) || !validarCPF(cpf)) throw new CommercialError('CPF inválido.');
  if (telefone && (telefone.length > 32 || !/^[0-9+().\s-]+$/.test(telefone))) throw new CommercialError('Telefone inválido.');
  const passwordError = passwordPolicyError(body.senha);
  if (passwordError) throw new CommercialError(passwordError);
  return { nome, email, cpf, telefone: telefone || null, password: body.senha as string,
    termsVersion, privacyVersion, acceptedAt: new Date() };
}

async function conflicts(email: string, cpf: string) {
  const rows = await prisma.user.findMany({ where: { OR: [{ email }, { cpf }] }, select: { email: true, cpf: true }, take: 2 });
  const fields = new Set<'email' | 'cpf'>();
  rows.forEach(row => { if (row.email === email) fields.add('email'); if (row.cpf === cpf) fields.add('cpf'); });
  return [...fields];
}

export async function stageRegistration(input: ReturnType<typeof parseRegistrationInput>) {
  await prisma.pendingRegistration.deleteMany({ where: { verificationExpires: { lte: new Date() } } });
  const existing = await conflicts(input.email, input.cpf);
  if (existing.length) throw new RegistrationConflictError(existing);
  const pendingConflicts = await prisma.pendingRegistration.findMany({ where: { OR: [{ email: input.email }, { cpf: input.cpf }] },
    select: { email: true, cpf: true }, take: 2 });
  const divergent = pendingConflicts.filter(row => row.email !== input.email || row.cpf !== input.cpf);
  if (divergent.length) {
    const fields = new Set<'email' | 'cpf'>();
    divergent.forEach(row => { if (row.email === input.email) fields.add('email'); if (row.cpf === input.cpf) fields.add('cpf'); });
    throw new RegistrationConflictError([...fields], true);
  }

  const [passwordHash, totalUsers] = await Promise.all([bcrypt.hash(input.password, 10), prisma.user.count()]);
  const bootstrapEmail = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
  const role: Role = totalUsers === 0 && bootstrapEmail === input.email ? 'MASTER' : 'COMUM';
  const code = crypto.randomInt(100000, 1000000).toString();
  const codeHash = registrationCodeHash(input.email, code);
  try {
    const pending = await prisma.pendingRegistration.upsert({ where: { email: input.email },
      create: { nome: input.nome, email: input.email, senhaHash: passwordHash, cpf: input.cpf, telefone: input.telefone,
        role, verificationCodeHash: codeHash, verificationExpires: new Date(Date.now() + 15 * 60 * 1000),
        termsVersion: input.termsVersion, privacyVersion: input.privacyVersion, acceptedAt: input.acceptedAt },
      update: { nome: input.nome, senhaHash: passwordHash, cpf: input.cpf, telefone: input.telefone,
        role, verificationCodeHash: codeHash, verificationExpires: new Date(Date.now() + 15 * 60 * 1000),
        termsVersion: input.termsVersion, privacyVersion: input.privacyVersion, acceptedAt: input.acceptedAt },
      select: { id: true } });
    return { pendingId: pending.id, code, codeHash, email: input.email, nome: input.nome };
  } catch (error) {
    if ((error as { code?: string }).code === 'P2002') throw new RegistrationConflictError(['email', 'cpf'], true);
    throw error;
  }
}

export async function discardStagedRegistration(pendingId: string, codeHash: string) {
  const result = await prisma.pendingRegistration.deleteMany({ where: { id: pendingId, verificationCodeHash: codeHash } });
  return result.count === 1;
}

export function parseRegistrationConfirmation(input: unknown) {
  const body = record(input);
  strict(body, ['email', 'code']);
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    || typeof body.code !== 'string' || !/^\d{6}$/.test(body.code)) throw new CommercialError('Código inválido ou expirado.');
  return { email, code: body.code };
}

export async function confirmRegistration(email: string, code: string) {
  const expectedHash = registrationCodeHash(email, code);
  try {
    return await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT "id" FROM "PendingRegistration" WHERE "email" = ${email} FOR UPDATE`;
      const pending = await tx.pendingRegistration.findUnique({ where: { email } });
      if (!pending || !sameHash(pending.verificationCodeHash, expectedHash) || pending.verificationExpires <= new Date()) {
        throw new CommercialError('Código inválido ou expirado.');
      }
      if (pending.termsVersion !== termsVersion || pending.privacyVersion !== privacyVersion) {
        throw new CommercialError('Os documentos legais mudaram. Refaça o cadastro após ler as versões atuais.', 409);
      }
      if (await tx.user.findFirst({ where: { OR: [{ email: pending.email }, { cpf: pending.cpf }] }, select: { id: true } })) {
        throw new RegistrationConflictError(['email', 'cpf']);
      }
      const trial = await tx.plan.findUnique({ where: { slug: 'TRIAL' },
        select: { id: true, slug: true, name: true, tipo: true, active: true, diasTeste: true, maxNotasMensal: true, maxClientes: true } });
      if (!trial?.active || trial.diasTeste < 1 || trial.diasTeste > 90 || trial.tipo !== 'PLANO') {
        throw new Error('TRIAL_PLAN_CONFIGURATION_INVALID');
      }
      const now = new Date(), expiresAt = new Date(now.getTime() + trial.diasTeste * 24 * 60 * 60 * 1000);
      const bootstrapEmail = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
      const role: Role = await tx.user.count() === 0 && bootstrapEmail === pending.email ? 'MASTER' : 'COMUM';
      const user = await tx.user.create({ data: { nome: pending.nome, email: pending.email, senha: pending.senhaHash,
        cpf: pending.cpf, telefone: pending.telefone, role, tutorialStep: 0, plano: trial.slug,
        planoStatus: 'trialing', planoCiclo: 'MENSAL', planoExpiresAt: expiresAt },
        select: { id: true, nome: true, email: true, role: true, sessionVersion: true } });
      await tx.planHistory.create({ data: { userId: user.id, planId: trial.id, status: 'ATIVO', dataInicio: now,
        dataFim: expiresAt, cicloInicio: now, notasEmitidas: 0, limiteNotasContratado: trial.maxNotasMensal,
        limiteClientesContratado: trial.maxClientes, tipoContratado: trial.tipo, nomeContratado: trial.name } });
      await tx.legalAcceptance.create({ data: { userId: user.id, termsVersion: pending.termsVersion,
        privacyVersion: pending.privacyVersion, acceptedAt: pending.acceptedAt, source: 'SIGNUP_EMAIL_CONFIRMED' } });
      await tx.userEvent.create({ data: { userId: user.id, tipo: 'SISTEMA', titulo: 'Conta criada',
        descricao: `E-mail confirmado; período de teste de ${trial.diasTeste} dias iniciado.` } });
      await tx.systemLog.create({ data: { level: 'INFO', action: 'ACCOUNT_CREATED', module: 'AUTH', userId: user.id,
        message: 'Conta criada após confirmação de e-mail e aceite legal versionado.',
        details: JSON.stringify({ termsVersion: pending.termsVersion, privacyVersion: pending.privacyVersion, trialDays: trial.diasTeste }) } });
      await tx.pendingRegistration.delete({ where: { id: pending.id } });
      return user;
    });
  } catch (error) {
    if ((error as { code?: string }).code === 'P2002') throw new RegistrationConflictError(['email', 'cpf']);
    throw error;
  }
}
