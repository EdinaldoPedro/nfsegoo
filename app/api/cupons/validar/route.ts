import { NextResponse } from 'next/server';
import { withApiGuard } from '@/app/utils/api-route';

// Coupon validation requires the complete cart, quantities and billing cycle.
export const POST = withApiGuard(async function POST() {
  return NextResponse.json({ error: 'Consulte o cupom na cotação completa em /api/checkout/cotacao.' }, { status: 410 });
});
