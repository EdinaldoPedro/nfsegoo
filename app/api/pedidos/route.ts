import { NextResponse } from 'next/server';
import { withApiGuard } from '@/app/utils/api-route';

// The legacy endpoint trusted a client-supplied total. Never create financial records here.
export const POST = withApiGuard(async function POST() {
  return NextResponse.json({ error: 'Fluxo antigo descontinuado. Utilize /checkout para conferir e solicitar a contratação.' }, { status: 410 });
});
