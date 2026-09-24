import { normalizeCnpj, validarCNPJ } from './cnpj.ts';

const NFSE_ACCESS_KEY = /^[0-9]{6}[0-9A-Z]{14}[0-9]{30}$/;
const DPS_ID = /^DPS[0-9]{7}(?:1[0-9]{14}|2[0-9A-Z]{14})[0-9]{20}$/;

export function normalizeNfseAccessKey(value: unknown): string {
  if (typeof value !== 'string') return '';
  const key = value.trim().toUpperCase();
  return NFSE_ACCESS_KEY.test(key) ? key : '';
}

export function isNfseAccessKey(value: unknown): value is string {
  return Boolean(normalizeNfseAccessKey(value));
}

export function isNfseId(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('NFS') && isNfseAccessKey(value.slice(3));
}

export function isDpsId(value: unknown): value is string {
  return typeof value === 'string' && DPS_ID.test(value);
}

export function fiscalCnpj(value: unknown): string {
  const result = normalizeCnpj(value);
  return validarCNPJ(result) ? result : '';
}
