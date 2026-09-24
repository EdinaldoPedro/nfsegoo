import { NextResponse } from 'next/server';
import { withApiGuard } from '@/app/utils/api-route';
import { validateRequest } from '@/app/utils/api-security';
import { validateJsonContentLength } from '@/app/utils/request-guards';
import { checkRateLimit } from '@/app/utils/rate-limit';
import { createPrivacyRequest, privacyOverview, PrivacyError } from '@/app/services/privacyService';

export const GET = withApiGuard(async function GET(request: Request) {
  const { user, targetId, errorResponse } = await validateRequest(request);
  if (errorResponse) return errorResponse;
  if (!user || user.id !== targetId) return NextResponse.json({ error: 'Use sua própria conta para exercer direitos de privacidade.' }, { status: 403 });
  try { return NextResponse.json(await privacyOverview(user.id)); }
  catch (error) { return NextResponse.json({ error: error instanceof PrivacyError ? error.message : 'Não foi possível carregar os dados de privacidade.' }, { status: error instanceof PrivacyError ? error.status : 500 }); }
});

export const POST = withApiGuard(async function POST(request: Request) {
  const { user, targetId, errorResponse } = await validateRequest(request);
  if (errorResponse) return errorResponse;
  if (!user || user.id !== targetId) return NextResponse.json({ error: 'Use sua própria conta para exercer direitos de privacidade.' }, { status: 403 });
  const sizeError = validateJsonContentLength(request, 8 * 1024); if (sizeError) return sizeError;
  if (!await checkRateLimit(`privacy_request:${user.id}`, 10, 24 * 60 * 60 * 1000)) return NextResponse.json({ error: 'Limite diário de solicitações atingido.' }, { status: 429 });
  try {
    const result = await createPrivacyRequest(user.id, await request.json());
    return NextResponse.json({ ...result, message: result.created ? 'Solicitação registrada sem custo.' : 'Já existe uma solicitação aberta deste tipo.' }, { status: result.created ? 201 : 200 });
  } catch (error) { return NextResponse.json({ error: error instanceof PrivacyError ? error.message : 'Não foi possível registrar a solicitação.' }, { status: error instanceof PrivacyError ? error.status : 500 }); }
}, { maxBodyBytes: 8 * 1024 });
