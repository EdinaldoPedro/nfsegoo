import { prisma } from '@/app/utils/prisma';

const DAY = 24 * 60 * 60 * 1000;

/** Removes only short-lived operational material. Fiscal, commercial, legal,
 * incident and audit records are deliberately outside this cleanup. */
export async function cleanupOperationalData(now = new Date()) {
  if (!Number.isFinite(now.getTime())) throw new Error('Data de retenção inválida.');
  return prisma.$transaction(async tx => {
    const [lock] = await tx.$queryRaw<Array<{ locked: boolean }>>`SELECT pg_try_advisory_xact_lock(741019) AS locked`;
    if (!lock?.locked) return { skipped: true, rateLimits: 0, pendingRegistrations: 0, passwordResets: 0, sessions: 0, mfaChallenges: 0, trustedDevices: 0 };
    const thirtyDaysAgo = new Date(now.getTime() - 30 * DAY);
    const [rateLimits, pendingRegistrations, passwordResets, sessions, mfaChallenges, trustedDevices] = await Promise.all([
      tx.rateLimitBucket.deleteMany({ where: { expiresAt: { lt: now } } }),
      tx.pendingRegistration.deleteMany({ where: { verificationExpires: { lt: now } } }),
      tx.passwordResetRequest.deleteMany({ where: { expiresAt: { lt: thirtyDaysAgo } } }),
      tx.authSession.deleteMany({ where: { expiresAt: { lt: thirtyDaysAgo } } }),
      tx.mfaLoginChallenge.deleteMany({ where: { expiresAt: { lt: thirtyDaysAgo } } }),
      tx.mfaTrustedDevice.deleteMany({ where: { expiresAt: { lt: thirtyDaysAgo } } }),
    ]);
    const counts = { skipped: false, rateLimits: rateLimits.count, pendingRegistrations: pendingRegistrations.count,
      passwordResets: passwordResets.count, sessions: sessions.count, mfaChallenges: mfaChallenges.count,
      trustedDevices: trustedDevices.count };
    if (Object.values(counts).some(value => typeof value === 'number' && value > 0)) await tx.systemLog.create({ data: {
      level: 'INFO', action: 'OPERATIONAL_RETENTION_CLEANUP', module: 'OPERACAO', message: 'Dados operacionais expirados removidos conforme política.',
      details: JSON.stringify(counts),
    } });
    return counts;
  });
}
