import bcrypt from 'bcryptjs';
import { createHmac } from 'node:crypto';
import { prisma } from '@/app/utils/prisma';
import { getRequestIp } from '@/app/utils/request-ip';
import { privacyVersion, termsVersion } from '@/app/legal-content';

export class LegalAcceptanceError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export function parseLegalAcceptanceInput(input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new LegalAcceptanceError('Aceite inválido.');
  const body = input as Record<string, unknown>;
  if (Object.keys(body).some(key => !['accepted', 'termsVersion', 'privacyVersion', 'password'].includes(key))) throw new LegalAcceptanceError('Há campos não permitidos no aceite.');
  if (body.accepted !== true || body.termsVersion !== termsVersion || body.privacyVersion !== privacyVersion) {
    throw new LegalAcceptanceError('Os documentos foram atualizados. Recarregue a página, leia e confirme as versões vigentes.', 409);
  }
  if (typeof body.password !== 'string' || !body.password || Buffer.byteLength(body.password, 'utf8') > 72) throw new LegalAcceptanceError('Confirme sua senha atual.');
  return { password: body.password, termsVersion, privacyVersion };
}

export async function currentLegalAcceptance(userId: string) {
  const acceptance = await prisma.legalAcceptance.findUnique({ where: { userId_termsVersion_privacyVersion: { userId, termsVersion, privacyVersion } },
    select: { id: true, acceptedAt: true, source: true } });
  return { required: !acceptance, acceptedAt: acceptance?.acceptedAt || null, termsVersion, privacyVersion };
}

function evidenceHash(value: string) {
  const key = process.env.JWT_SECRET || process.env.ENCRYPTION_KEY;
  if (!key) throw new Error('EVIDENCE_HASH_KEY_UNAVAILABLE');
  return createHmac('sha256', key).update(value || 'unknown').digest('hex');
}

export async function acceptCurrentLegalDocuments(userId: string, request: Request, input: unknown) {
  const parsed = parseLegalAcceptanceInput(input);
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, senha: true, privacyErasedAt: true } });
  if (!user || user.privacyErasedAt || !await bcrypt.compare(parsed.password, user.senha)) throw new LegalAcceptanceError('Senha atual incorreta.', 403);
  const acceptedAt = new Date();
  const ipAddressHash = evidenceHash(getRequestIp(request));
  const userAgentHash = evidenceHash((request.headers.get('user-agent') || '').slice(0, 500));
  return prisma.$transaction(async tx => {
    const inserted = await tx.legalAcceptance.createMany({ data: [{ userId, termsVersion, privacyVersion, acceptedAt,
      source: 'AUTHENTICATED_REACCEPTANCE', ipAddressHash, userAgentHash }], skipDuplicates: true });
    const acceptance = await tx.legalAcceptance.findUniqueOrThrow({
      where: { userId_termsVersion_privacyVersion: { userId, termsVersion, privacyVersion } },
      select: { id: true, acceptedAt: true, source: true },
    });
    if (inserted.count === 1) {
      await tx.systemLog.create({ data: { level: 'INFO', action: 'LEGAL_DOCUMENTS_ACCEPTED', module: 'LEGAL', userId,
        message: 'Documentos legais vigentes aceitos por usuário autenticado.',
        details: JSON.stringify({ termsVersion, privacyVersion, acceptanceId: acceptance.id }) } });
    }
    return { required: false, termsVersion, privacyVersion, acceptedAt: acceptance.acceptedAt };
  });
}
