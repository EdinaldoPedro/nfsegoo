import { NextResponse } from 'next/server';
import { getAuthenticatedUser, forbidden, unauthorized } from './api-middleware';
import { requireAdminReauthentication } from './admin-security';
import { validateJsonContentLength } from './request-guards';
import { isAdminRole } from './access-control';

export function canAuthorizeMaintenance(role: string | null | undefined) {
  return isAdminRole(role);
}

/** One-off maintenance routes are disabled unless explicitly enabled by operations. */
export async function authorizeMaintenance(request: Request, action: string, confirmation: string) {
  if (process.env.ENABLE_MAINTENANCE_ROUTES !== 'true') {
    return { actor: null, body: null, error: NextResponse.json({ error: 'Recurso indisponivel.' }, { status: 404 }) };
  }
  const actor = await getAuthenticatedUser(request);
  if (!actor) return { actor: null, body: null, error: unauthorized() };
  if (!canAuthorizeMaintenance(actor.role)) return { actor: null, body: null, error: forbidden() };
  const sizeError = validateJsonContentLength(request, 16 * 1024);
  if (sizeError) return { actor: null, body: null, error: sizeError };
  const body = await request.json().catch(() => null);
  if (!body || body.confirmation !== confirmation) {
    return { actor: null, body: null, error: NextResponse.json({ error: 'Confirmacao textual invalida.' }, { status: 400 }) };
  }
  const error = await requireAdminReauthentication({
    actorId: actor.id,
    password: body.adminPassword,
    justification: body.justification,
    action,
  });
  return { actor, body, error };
}
