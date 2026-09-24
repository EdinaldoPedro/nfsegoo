import { NextResponse } from 'next/server';
import { withApiGuard } from '@/app/utils/api-route';
import { validateRequest } from '@/app/utils/api-security';
import { exportFiscalReport } from '@/app/services/fiscalReportExportService';
import { checkRateLimit } from '@/app/utils/rate-limit';

export const POST = withApiGuard(async function POST(request: Request) {
  const { targetId, errorResponse } = await validateRequest(request);
  if (errorResponse) return errorResponse;
  if (!targetId) return NextResponse.json({ error: 'Autenticação necessária.' }, { status: 401 });
  if (!await checkRateLimit('fiscal_export_' + targetId, 5, 60_000)) return NextResponse.json({ error: 'Aguarde antes de exportar mais documentos.' }, { status: 429 });
  try {
    const archive = await exportFiscalReport(targetId, request.headers.get('x-empresa-id'), await request.json());
    return new NextResponse(new Uint8Array(archive.bytes), { headers: { 'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${archive.filename}"`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
  } catch (error) {
    const failure = error as Error & { status?: number };
    if (failure.status && failure.status < 500) return NextResponse.json({ error: failure.message }, { status: failure.status });
    throw error;
  }
}, { maxBodyBytes: 16 * 1024 });
