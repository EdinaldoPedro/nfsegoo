import { NextResponse } from 'next/server';
import { withApiGuard } from '@/app/utils/api-route';
import { getAuthenticatedUser, forbidden, unauthorized } from '@/app/utils/api-middleware';
import { requireAdminReauthentication } from '@/app/utils/admin-security';
import { confirmLegacyFiscalEnvironments, listLegacyFiscalEnvironments } from '@/app/services/legacyFiscalEnvironmentService';

export const GET = withApiGuard(async function GET(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return unauthorized();
  if (!['ADMIN', 'MASTER'].includes(user.role)) return forbidden();
  const rawPage = new URL(request.url).searchParams.get('page') || '1';
  if (!/^[1-9][0-9]{0,5}$/.test(rawPage)) return NextResponse.json({ error: 'Página inválida.' }, { status: 400 });
  return NextResponse.json(await listLegacyFiscalEnvironments(Number(rawPage)));
});

export const POST = withApiGuard(async function POST(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return unauthorized();
  if (!['ADMIN', 'MASTER'].includes(user.role)) return forbidden();
  let body: unknown;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'Corpo JSON inválido.' }, { status: 400 }); }
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Solicitação inválida.' }, { status: 400 });
  const data = body as Record<string, unknown>;
  const ids = data.ids;
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 50 || ids.some(id => typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id))
    || new Set(ids).size !== ids.length) return NextResponse.json({ error: 'Selecione de 1 a 50 notas distintas.' }, { status: 400 });
  const denied = await requireAdminReauthentication({ actorId: user.id, password: data.adminPassword,
    justification: data.justification, action: 'LEGACY_FISCAL_ENVIRONMENT_CONFIRM' });
  if (denied) return denied;
  const results = await confirmLegacyFiscalEnvironments(user.id, ids as string[], String(data.justification).trim());
  return NextResponse.json({ results, confirmed: results.filter(result => result.status === 'CONFIRMADA').length });
}, { maxBodyBytes: 16 * 1024 });
