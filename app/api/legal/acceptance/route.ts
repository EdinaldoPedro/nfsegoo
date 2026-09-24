import { NextResponse } from 'next/server';
import { withApiGuard } from '@/app/utils/api-route';
import { getAuthenticatedUser, unauthorized } from '@/app/utils/api-middleware';
import { validateJsonContentLength } from '@/app/utils/request-guards';
import { acceptCurrentLegalDocuments, currentLegalAcceptance, LegalAcceptanceError, parseLegalAcceptanceInput } from '@/app/services/legalAcceptanceService';

export const GET = withApiGuard(async function GET(request: Request) {
  const user = await getAuthenticatedUser(request); if (!user) return unauthorized();
  return NextResponse.json(await currentLegalAcceptance(user.id));
});

export const POST = withApiGuard(async function POST(request: Request) {
  const user = await getAuthenticatedUser(request); if (!user) return unauthorized();
  const sizeError = validateJsonContentLength(request, 4 * 1024); if (sizeError) return sizeError;
  try { const body = await request.json(); parseLegalAcceptanceInput(body); return NextResponse.json(await acceptCurrentLegalDocuments(user.id, request, body)); }
  catch (error) { return NextResponse.json({ error: error instanceof LegalAcceptanceError ? error.message : 'Não foi possível registrar o aceite.' },
    { status: error instanceof LegalAcceptanceError ? error.status : 500 }); }
}, { maxBodyBytes: 4 * 1024 });
