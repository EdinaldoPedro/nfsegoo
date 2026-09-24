import { withApiGuard } from '@/app/utils/api-route';
import { validateRequest } from '@/app/utils/api-security';
import { validateJsonContentLength } from '@/app/utils/request-guards';
import { checkRateLimit } from '@/app/utils/rate-limit';
import { privacyAccountExport, PrivacyError } from '@/app/services/privacyService';

export const POST = withApiGuard(async function POST(request: Request) {
  const { user, targetId, errorResponse } = await validateRequest(request);
  if (errorResponse) return errorResponse;
  if (!user || user.id !== targetId) return Response.json({ error: 'Exportação disponível apenas para a própria conta.' }, { status: 403 });
  const sizeError = validateJsonContentLength(request, 4 * 1024); if (sizeError) return sizeError;
  if (!await checkRateLimit(`privacy_export:${user.id}`, 3, 24 * 60 * 60 * 1000)) return Response.json({ error: 'Limite diário de exportações atingido.' }, { status: 429 });
  try {
    const body = await request.json();
    const data = await privacyAccountExport(user.id, body?.password);
    return new Response(JSON.stringify(data, null, 2), { headers: { 'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="dados-pessoais-${new Date().toISOString().slice(0, 10)}.json"`,
      'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
  } catch (error) { return Response.json({ error: error instanceof PrivacyError ? error.message : 'Não foi possível gerar a exportação.' }, { status: error instanceof PrivacyError ? error.status : 500 }); }
}, { maxBodyBytes: 4 * 1024 });
