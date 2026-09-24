import { withApiGuard } from '@/app/utils/api-route';
import { NextResponse } from 'next/server';
import { validateRequest } from '@/app/utils/api-security';
import { CommercialError } from '@/app/utils/commercial-pricing';
import { registerAdditionalCompany } from '@/app/services/companyRegistrationService';

export const POST = withApiGuard(async function POST(request: Request) {
  const { targetId, errorResponse } = await validateRequest(request);
  if (errorResponse) return errorResponse;
  if (!targetId) return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 });
  try {
    const result = await registerAdditionalCompany(targetId, await request.json());
    return NextResponse.json({ success: true, ...result }, { status: result.created ? 201 : 200 });
  } catch (error) {
    if (error instanceof CommercialError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
}, { maxBodyBytes: 16 * 1024 });
