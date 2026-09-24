import { prisma } from '@/app/utils/prisma';
import { decrypt } from '@/app/utils/crypto';
import { matchingTotpStep, recoveryCodeHash } from '@/app/utils/totp';

/** Compare-and-swap makes both TOTP steps and recovery codes single-use. */
export type MfaProofMethod = 'TOTP' | 'RECOVERY';

export async function consumeMfaProof(userId: string, code: string): Promise<MfaProofMethod | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { mfaSecret: true, mfaEnabledAt: true, mfaLastUsedStep: true, mfaRecoveryCodes: true },
  });
  if (!user?.mfaEnabledAt || !user.mfaSecret) return null;
  const normalized = code.trim();
  if (/^\d{6}$/.test(normalized)) {
    const secret = decrypt(user.mfaSecret);
    if (!secret) return null;
    const step = matchingTotpStep(secret, normalized, Date.now(), user.mfaLastUsedStep);
    if (step === null) return null;
    const result = await prisma.user.updateMany({
      where: { id: userId, mfaSecret: user.mfaSecret, mfaLastUsedStep: { lt: step } },
      data: { mfaLastUsedStep: step },
    });
    return result.count === 1 ? 'TOTP' : null;
  }

  if (!/^[a-fA-F0-9\s-]{32,48}$/.test(normalized) || !user.mfaRecoveryCodes) return null;
  let hashes: string[];
  try { hashes = JSON.parse(user.mfaRecoveryCodes); } catch { return null; }
  if (!Array.isArray(hashes)) return null;
  const hash = recoveryCodeHash(normalized);
  if (!hashes.includes(hash)) return null;
  const result = await prisma.user.updateMany({
    where: { id: userId, mfaRecoveryCodes: user.mfaRecoveryCodes },
    data: { mfaRecoveryCodes: JSON.stringify(hashes.filter((value) => value !== hash)) },
  });
  return result.count === 1 ? 'RECOVERY' : null;
}

export async function consumeMfaCode(userId: string, code: string) {
  return Boolean(await consumeMfaProof(userId, code));
}
