function firstHeaderValue(value: string | null) {
  return value?.split(',')[0]?.trim() || null;
}

function toOrigin(value: string | undefined | null) {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function isLocalOrigin(origin: string | null) {
  if (!origin) return false;
  try {
    const { hostname } = new URL(origin);
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  } catch {
    return false;
  }
}

export function getRequestOrigin(request: Request) {
  const host = firstHeaderValue(request.headers.get('x-forwarded-host')) || firstHeaderValue(request.headers.get('host'));
  if (!host) return null;

  const proto = firstHeaderValue(request.headers.get('x-forwarded-proto')) || (host.startsWith('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https');
  return toOrigin(`${proto}://${host}`);
}

export function normalizeOrigin(value: string | undefined | null) {
  return toOrigin(value);
}

function configuredOrRequestOrigin(envValue: string | undefined, request: Request) {
  const configured = toOrigin(envValue);
  const requestOrigin = getRequestOrigin(request);

  if (process.env.NODE_ENV === 'production' && isLocalOrigin(configured) && requestOrigin) {
    return requestOrigin;
  }

  return configured || requestOrigin || 'http://localhost:3000';
}

export function getPublicBaseUrl(request: Request) {
  return configuredOrRequestOrigin(process.env.NEXT_PUBLIC_APP_URL, request);
}

export function getInternalBaseUrl(request: Request) {
  return configuredOrRequestOrigin(process.env.URL_API_LOCAL || process.env.NEXT_PUBLIC_APP_URL, request);
}
