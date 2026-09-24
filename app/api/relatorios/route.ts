import { NextResponse } from 'next/server';
import { withApiGuard } from '@/app/utils/api-route';
import { validateRequest } from '@/app/utils/api-security';
import { getFiscalReport } from '@/app/services/fiscalReportService';
import { checkRateLimit } from '@/app/utils/rate-limit';

export const dynamic = 'force-dynamic';

export const GET = withApiGuard(async function GET(request: Request) {
  const { targetId, errorResponse } = await validateRequest(request);
  if (errorResponse) return errorResponse;
  if (!targetId) return NextResponse.json({ error: 'Autenticação necessária.' }, { status: 401 });
  if (!await checkRateLimit('fiscal_report_' + targetId, 30, 60_000)) return NextResponse.json({ error: 'Aguarde antes de consultar novos relatórios.' }, { status: 429 });
  try {
    const report = await getFiscalReport(targetId, request.headers.get('x-empresa-id'), new URL(request.url).searchParams);
    return NextResponse.json(report, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    const failure = error as Error & { status?: number };
    if (failure.status && failure.status < 500) return NextResponse.json({ error: failure.message }, { status: failure.status });
    throw error;
  }
});
