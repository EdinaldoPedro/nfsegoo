import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { withApiGuard } from '@/app/utils/api-route';
import { getAuthenticatedUser, unauthorized, forbidden } from '@/app/utils/api-middleware';
import { checkRateLimit } from '@/app/utils/rate-limit';
import { CommercialError } from '@/app/utils/commercial-pricing';
import { listAccountCompanies, mutateAccountCompany } from '@/app/services/adminAccountCompanyService';

type Context = { params: Promise<{ id: string }> };
export const GET = withApiGuard(async function GET(request: Request, context: Context) {
  const actor = await getAuthenticatedUser(request);
  if (!actor) return unauthorized();
  if (!['ADMIN', 'MASTER'].includes(actor.role)) return forbidden();
  try { return NextResponse.json(await listAccountCompanies(actor.id, (await context.params).id, new URL(request.url).searchParams)); }
  catch (error) {
    if (error instanceof CommercialError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
});

export const POST = withApiGuard(async function POST(request: Request, context: Context) {
  const actor = await getAuthenticatedUser(request);
  if (!actor) return unauthorized();
  if (!['ADMIN', 'MASTER'].includes(actor.role)) return forbidden();
  if ((await cookies()).get('impersonation_token')?.value) return forbidden();
  if (!await checkRateLimit(`admin_reauth_${actor.id}`, 10, 5 * 60 * 1000)) return NextResponse.json({ error: 'Muitas verificações administrativas. Aguarde 5 minutos.' }, { status: 429 });
  try {
    const result = await mutateAccountCompany(actor.id, (await context.params).id, await request.json());
    return NextResponse.json(result, { status: 'created' in result && result.created ? 201 : 200 });
  } catch (error) {
    if (error instanceof SyntaxError) return NextResponse.json({ error: 'Envie a operação confirmada em JSON.' }, { status: 400 });
    if (error instanceof CommercialError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
}, { maxBodyBytes: 16 * 1024 });
