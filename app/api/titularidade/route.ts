import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { withApiGuard } from '@/app/utils/api-route';
import { getAuthenticatedUser, unauthorized, forbidden } from '@/app/utils/api-middleware';
import { currentSessionId } from '@/app/utils/auth-session';
import { checkRateLimit } from '@/app/utils/rate-limit';
import { CommercialError } from '@/app/utils/commercial-pricing';
import { decideOwnershipRequest, listOwnershipRequests } from '@/app/services/companyOwnershipService';

async function actor(request: Request) {
  const user = await getAuthenticatedUser(request), sessionId = user ? await currentSessionId() : null;
  return user && sessionId ? { id: user.id, role: user.role, sessionVersion: user.sessionVersion, sessionId } : null;
}
function failure(error: unknown) {
  if (error instanceof SyntaxError) return NextResponse.json({ error: 'Envie uma operação JSON válida.' }, { status: 400 });
  if (error instanceof CommercialError) return NextResponse.json({ error: error.message }, { status: error.status });
  throw error;
}
export const GET = withApiGuard(async function GET(request: Request) {
  const current = await actor(request);
  if (!current) return unauthorized();
  if (!['COMUM', 'CONTADOR'].includes(current.role)) return forbidden();
  try { return NextResponse.json(await listOwnershipRequests(current, new URL(request.url).searchParams)); } catch (error) { return failure(error); }
});
export const POST = withApiGuard(async function POST(request: Request) {
  const current = await actor(request);
  if (!current) return unauthorized();
  if (!['COMUM', 'CONTADOR'].includes(current.role) || (await cookies()).get('impersonation_token')?.value) return forbidden();
  if (!await checkRateLimit(`ownership_consent_${current.id}`, 10, 10 * 60 * 1000)) return NextResponse.json({ error: 'Muitas tentativas. Aguarde 10 minutos.' }, { status: 429 });
  try { return NextResponse.json(await decideOwnershipRequest(current, await request.json())); } catch (error) { return failure(error); }
}, { maxBodyBytes: 12 * 1024 });
