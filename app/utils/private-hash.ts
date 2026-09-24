import { createHmac } from 'node:crypto';

/** Stable keyed fingerprint for low-entropy personal/operational identifiers.
 * Unlike a plain digest, it cannot be checked offline without an application secret. */
export function privateHash(scope: string, value: string) {
  const key = process.env.ENCRYPTION_KEY || process.env.JWT_SECRET;
  if (!key) throw new Error('PRIVATE_HASH_KEY_UNAVAILABLE');
  return createHmac('sha256', key).update(scope).update('\0').update(value).digest('hex');
}
