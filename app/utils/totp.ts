import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';

// RFC 4226 / RFC 6238. HMAC is provided by Node's crypto implementation.
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const TOTP_PERIOD_SECONDS = 30;

export function encodeBase32(bytes: Buffer) {
  let value = 0;
  let bits = 0;
  let result = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      result += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) result += BASE32[(value << (5 - bits)) & 31];
  return result;
}

export function decodeBase32(secret: string) {
  const normalized = secret.toUpperCase().replace(/=+$/, '');
  if (!normalized || !/^[A-Z2-7]+$/.test(normalized)) throw new Error('Segredo TOTP invalido.');
  let value = 0;
  let bits = 0;
  const bytes: number[] = [];
  for (const char of normalized) {
    value = (value << 5) | BASE32.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function totpAtStep(secret: string, step: number, digits = 6) {
  if (!Number.isSafeInteger(step) || step < 0 || ![6, 8].includes(digits)) throw new Error('Parametros TOTP invalidos.');
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac('sha1', decodeBase32(secret)).update(counter).digest();
  const offset = digest[digest.length - 1] & 15;
  const binary = digest.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % (10 ** digits)).padStart(digits, '0');
}

export function matchingTotpStep(secret: string, code: string, nowMs = Date.now(), lastUsedStep = -1) {
  if (!/^\d{6}$/.test(code)) return null;
  const currentStep = Math.floor(nowMs / 1000 / TOTP_PERIOD_SECONDS);
  for (const delta of [0, -1, 1]) {
    const step = currentStep + delta;
    if (step <= lastUsedStep || step < 0) continue;
    if (timingSafeEqual(Buffer.from(totpAtStep(secret, step)), Buffer.from(code))) return step;
  }
  return null;
}

export function createTotpSecret() {
  return encodeBase32(randomBytes(20));
}

export function totpProvisioningUri(secret: string, email: string) {
  const issuer = 'NFSe Goo';
  return `otpauth://totp/${encodeURIComponent(`${issuer}:${email}`)}?${new URLSearchParams({ secret, issuer, algorithm: 'SHA1', digits: '6', period: '30' })}`;
}

export function recoveryCodeHash(code: string) {
  return createHash('sha256').update(code.replace(/[-\s]/g, '').toUpperCase()).digest('hex');
}

export function createRecoveryCodes() {
  const codes = Array.from({ length: 10 }, () => randomBytes(16).toString('hex').toUpperCase().match(/.{1,8}/g)!.join('-'));
  return { codes, hashes: codes.map(recoveryCodeHash) };
}
