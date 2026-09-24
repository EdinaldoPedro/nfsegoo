import { prisma } from '@/app/utils/prisma';
import { privateHash } from '@/app/utils/private-hash';

function hashKey(key: string) {
    return privateHash('rate-limit', key);
}

export async function checkRateLimit(key: string, limit: number, windowMs: number): Promise<boolean> {
    const keyHash = hashKey(key);
    if (!Number.isInteger(limit) || limit < 1 || !Number.isFinite(windowMs) || windowMs < 1000) return false;
    const expiresAt = new Date(Date.now() + windowMs);
    const rows = await prisma.$queryRaw<Array<{ hits: number }>>`
      INSERT INTO "RateLimitBucket" ("keyHash", "hits", "expiresAt")
      VALUES (${keyHash}, 1, ${expiresAt})
      ON CONFLICT ("keyHash") DO UPDATE SET
        "hits" = CASE WHEN "RateLimitBucket"."expiresAt" <= NOW() THEN 1 ELSE LEAST("RateLimitBucket"."hits" + 1, ${limit + 1}) END,
        "expiresAt" = CASE WHEN "RateLimitBucket"."expiresAt" <= NOW() THEN EXCLUDED."expiresAt" ELSE "RateLimitBucket"."expiresAt" END
      RETURNING "hits"
    `;
    return Boolean(rows[0] && rows[0].hits <= limit);
}

/** Clears an identity-specific counter after the corresponding proof succeeds. */
export async function clearRateLimit(key: string): Promise<void> {
    await prisma.rateLimitBucket.deleteMany({ where: { keyHash: hashKey(key) } });
}

/**
 * Removes only the successful request from a shared counter, preserving failed
 * attempts made by the same IP during the window.
 */
export async function refundRateLimit(key: string): Promise<void> {
    const keyHash = hashKey(key);
    await prisma.$executeRaw`
      WITH decremented AS (
        UPDATE "RateLimitBucket"
        SET "hits" = "hits" - 1
        WHERE "keyHash" = ${keyHash} AND "hits" > 1
        RETURNING "keyHash"
      )
      DELETE FROM "RateLimitBucket"
      WHERE "keyHash" = ${keyHash}
        AND "hits" <= 1
        AND NOT EXISTS (SELECT 1 FROM decremented)
    `;
}
