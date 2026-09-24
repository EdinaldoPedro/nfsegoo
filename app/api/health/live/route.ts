import { withApiGuard } from '@/app/utils/api-route';

export const dynamic = 'force-dynamic';

export const GET = withApiGuard(async function GET() {
  return Response.json({ status: 'ok' }, { headers: { 'Cache-Control': 'no-store' } });
});
