import { withApiGuard } from '@/app/utils/api-route';
import { NextResponse } from 'next/server';
import { getAuthenticatedUser, forbidden } from '@/app/utils/api-middleware';
import { getCrmMetrics } from '@/app/services/crmMetricsService';
import { CommercialError } from '@/app/utils/commercial-pricing';

export const GET = withApiGuard(async function GET(request: Request) {
  const admin = await getAuthenticatedUser(request);
  if (!admin || !['MASTER', 'ADMIN'].includes(admin.role)) return forbidden();
  try {
    return NextResponse.json(await getCrmMetrics(admin.id));
  } catch (error) {
    if (error instanceof CommercialError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
});
