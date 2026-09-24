import { isIP } from 'net';

/** Only enable behind a reverse proxy that overwrites the selected header. */
export function getRequestIp(request: Request) {
  if (process.env.TRUST_PROXY_HEADERS !== 'true') {
    return process.env.NODE_ENV === 'production' ? 'untrusted-proxy' : '127.0.0.1';
  }
  const header = process.env.TRUSTED_CLIENT_IP_HEADER || 'x-real-ip';
  if (!['x-real-ip', 'cf-connecting-ip', 'x-forwarded-for'].includes(header)) return 'invalid-proxy-config';
  const raw = request.headers.get(header) || '';
  const values = raw.split(',').map((value) => value.trim());
  const hops = Math.max(1, Math.min(10, Number(process.env.TRUST_PROXY_HOPS || 1) || 1));
  const candidate = header === 'x-forwarded-for' ? values[values.length - hops] : values.length === 1 ? values[0] : '';
  return candidate && isIP(candidate) ? candidate : 'unknown-client';
}
