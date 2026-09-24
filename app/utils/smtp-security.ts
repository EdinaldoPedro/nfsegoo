import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { domainToASCII } from 'node:url';
import { CommercialError } from '@/app/utils/commercial-pricing';

export function normalizeSmtpHost(value: unknown) {
  if (typeof value !== 'string') throw new CommercialError('Host SMTP inválido.');
  const host = domainToASCII(value.trim().replace(/\.$/, '').toLowerCase());
  if (!host || host.length > 253 || (!isIP(host) && (!/^[a-z0-9.-]+$/.test(host)
    || host.split('.').some(label => !label || label.length > 63 || label.startsWith('-') || label.endsWith('-'))))) {
    throw new CommercialError('Host SMTP inválido.');
  }
  return host;
}

export function isPrivateOrReservedIp(address: string) {
  const normalized = address.toLowerCase().replace(/^::ffff:/, '');
  if (isIP(normalized) === 4) {
    const [a, b] = normalized.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  if (isIP(normalized) === 6) {
    return normalized === '::' || normalized === '::1' || /^f[cd]/.test(normalized)
      || /^fe[89ab]/.test(normalized) || normalized.startsWith('ff') || normalized.startsWith('2001:db8:');
  }
  return true;
}

export async function assertSmtpHostAllowed(host: string) {
  if (process.env.ALLOW_PRIVATE_SMTP_HOST === 'true') return;
  if (host === 'localhost' || /\.(?:localhost|local|internal|home|arpa)$/.test(host)) {
    throw new CommercialError('O host SMTP aponta para rede local. Use um provedor público ou habilitação operacional explícita.', 409);
  }
  if (isIP(host)) {
    if (isPrivateOrReservedIp(host)) throw new CommercialError('O host SMTP não pode usar endereço privado ou reservado.', 409);
    return;
  }
  let addresses;
  try {
    addresses = await lookup(host, { all: true, verbatim: true });
  } catch {
    throw new CommercialError('Não foi possível resolver o host SMTP informado.', 409);
  }
  if (!addresses.length || addresses.some(result => isPrivateOrReservedIp(result.address))) {
    throw new CommercialError('O host SMTP resolveu para endereço privado ou reservado.', 409);
  }
}
