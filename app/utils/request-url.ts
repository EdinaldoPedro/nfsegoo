function toOrigin(value: string | undefined | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.origin : null;
  } catch {
    return null;
  }
}

export function getRequestOrigin(request: Request) {
  // Forwarded headers are not a trust anchor for CSRF or password-reset links.
  return toOrigin(request.url);
}

export function normalizeOrigin(value: string | undefined | null) {
  return toOrigin(value);
}

function configuredOrRequestOrigin(envValue: string | undefined, request: Request) {
  const configured = toOrigin(envValue);
  const requestOrigin = getRequestOrigin(request);

  if (configured) return configured;
  if (process.env.NODE_ENV === 'production') throw new Error('Configure uma URL publica/interna valida para a aplicacao.');
  return requestOrigin || 'http://localhost:3000';
}

export function getPublicBaseUrl(request: Request) {
  return configuredOrRequestOrigin(process.env.NEXT_PUBLIC_APP_URL, request);
}

export function getInternalBaseUrl(request: Request) {
  return configuredOrRequestOrigin(process.env.URL_API_LOCAL || process.env.NEXT_PUBLIC_APP_URL, request);
}
