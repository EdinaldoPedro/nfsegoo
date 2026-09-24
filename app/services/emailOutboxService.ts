import { randomUUID } from 'node:crypto';
import { prisma } from '@/app/utils/prisma';
import { decrypt, encrypt } from '@/app/utils/crypto';
import { privateHash } from '@/app/utils/private-hash';

type EmailPayload = {
  to: string;
  subject: string;
  html: string;
  context: { traceId?: string; userId?: string; empresaId?: string; vendaId?: string; requestPath?: string; module?: string };
};

type Send = (payload: EmailPayload) => Promise<{ success: boolean; messageId?: string; error?: string }>;

function hash(value: string) { return privateHash('email-outbox', value); }
function safeExpiry(value: Date | undefined) {
  const fallback = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  if (!value || !Number.isFinite(value.getTime())) return fallback;
  return new Date(Math.min(value.getTime(), Date.now() + 30 * 24 * 60 * 60 * 1000));
}

export async function enqueueEmailDelivery(payload: EmailPayload, options: { dedupKey?: string; expiresAt?: Date } = {}) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.to) || payload.to.length > 254 || !payload.subject || payload.subject.length > 200
    || /[\r\n]/.test(payload.subject) || !payload.html || Buffer.byteLength(payload.html, 'utf8') > 2_000_000) return null;
  const expiresAt = safeExpiry(options.expiresAt);
  if (expiresAt <= new Date()) return null;
  const encrypted = encrypt(JSON.stringify(payload));
  if (!encrypted) return null;
  const dedupKey = options.dedupKey ? hash(`email:${options.dedupKey}`) : hash(`${payload.to.toLowerCase()}\0${payload.subject}\0${payload.html}`);
  const queued = await prisma.emailOutbox.upsert({ where: { dedupKey }, update: {}, create: { dedupKey, recipientHash: hash(payload.to.toLowerCase()),
    payloadEncrypted: encrypted, expiresAt }, select: { id: true, status: true } });
  return ['ERRO_FINAL', 'EXPIRADO'].includes(queued.status) ? null : queued;
}

function parsePayload(value: string | null): EmailPayload | null {
  if (!value) return null;
  try {
    const payload = JSON.parse(value);
    if (!payload || typeof payload !== 'object' || typeof payload.to !== 'string' || typeof payload.subject !== 'string' || typeof payload.html !== 'string'
      || payload.to.length > 254 || payload.subject.length > 200 || payload.html.length > 2_000_000 || !payload.context || typeof payload.context !== 'object') return null;
    return payload;
  } catch { return null; }
}

function retryDelay(attempts: number) { return Math.min(60 * 60 * 1000, 15_000 * (2 ** Math.min(8, Math.max(0, attempts - 1)))); }

export async function claimEmailDelivery() {
  const token = randomUUID();
  const [row] = await prisma.$queryRaw<Array<{ id: string; leaseToken: string; payloadEncrypted: string; attempts: number; maxAttempts: number; expiresAt: Date }>>`
    WITH candidate AS (
      SELECT "id" FROM "EmailOutbox" WHERE "status" IN ('PENDENTE','ERRO_TEMPORARIO','PROCESSANDO')
        AND "expiresAt" > clock_timestamp() AND "nextAttemptAt" <= clock_timestamp()
        AND ("leaseUntil" IS NULL OR "leaseUntil" <= clock_timestamp())
      ORDER BY "nextAttemptAt", "createdAt" FOR UPDATE SKIP LOCKED LIMIT 1
    ) UPDATE "EmailOutbox" o SET "status" = 'PROCESSANDO', "leaseToken" = ${token},
      "leaseUntil" = clock_timestamp() + interval '60 seconds', "attempts" = "attempts" + 1, "updatedAt" = clock_timestamp()
      FROM candidate WHERE o."id" = candidate."id" RETURNING o."id", o."leaseToken", o."payloadEncrypted", o."attempts", o."maxAttempts", o."expiresAt"
  `;
  return row || null;
}

export async function processNextEmailDelivery(send: Send) {
  const row = await claimEmailDelivery();
  if (!row) {
    await prisma.emailOutbox.updateMany({ where: { status: { in: ['PENDENTE', 'ERRO_TEMPORARIO'] }, expiresAt: { lte: new Date() } },
      data: { status: 'EXPIRADO', lastErrorCode: 'MESSAGE_EXPIRED', leaseToken: null, leaseUntil: null } });
    return false;
  }
  const payload = parsePayload(decrypt(row.payloadEncrypted));
  if (!payload) {
    await prisma.emailOutbox.updateMany({ where: { id: row.id, leaseToken: row.leaseToken, status: 'PROCESSANDO' },
      data: { status: 'ERRO_FINAL', lastErrorCode: 'INVALID_ENCRYPTED_PAYLOAD', leaseToken: null, leaseUntil: null } });
    return true;
  }
  const result: { success: boolean; messageId?: string; error?: string } = await send(payload)
    .catch(() => ({ success: false, error: 'DELIVERY_FAILED' }));
  if (result.success) {
    await prisma.emailOutbox.updateMany({ where: { id: row.id, leaseToken: row.leaseToken, status: 'PROCESSANDO' },
      data: { status: 'ENVIADO', providerMessageId: (result.messageId || '').slice(0, 500) || null, sentAt: new Date(),
        lastErrorCode: null, leaseToken: null, leaseUntil: null } });
  } else {
    const terminal = row.attempts >= row.maxAttempts || row.expiresAt <= new Date();
    await prisma.emailOutbox.updateMany({ where: { id: row.id, leaseToken: row.leaseToken, status: 'PROCESSANDO' },
      data: { status: terminal ? 'ERRO_FINAL' : 'ERRO_TEMPORARIO', lastErrorCode: String(result.error || 'DELIVERY_FAILED').slice(0, 100),
        nextAttemptAt: new Date(Date.now() + retryDelay(row.attempts)), leaseToken: null, leaseUntil: null } });
  }
  return true;
}

export async function cleanupEmailOutbox() {
  return prisma.emailOutbox.deleteMany({ where: { status: { in: ['ENVIADO', 'ERRO_FINAL', 'EXPIRADO'] }, expiresAt: { lt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } } });
}
