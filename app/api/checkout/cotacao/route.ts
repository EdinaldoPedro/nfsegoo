import { NextResponse } from 'next/server';
import { withApiGuard } from '@/app/utils/api-route';
import { getAuthenticatedUser, unauthorized } from '@/app/utils/api-middleware';
import { checkRateLimit } from '@/app/utils/rate-limit';
import { CommercialError } from '@/app/utils/commercial-pricing';
import { commercialTransaction, loadCommercialQuote } from '@/app/services/commercialService';

export const POST = withApiGuard(async function POST(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return unauthorized();
  if (!await checkRateLimit(`quote:${user.id}`, 120, 15 * 60_000)) return NextResponse.json({ error: 'Muitas consultas. Tente novamente em alguns minutos.' }, { status: 429 });
  const body = await request.json();
  try {
    const result = await commercialTransaction(user.id, (tx) => loadCommercialQuote(tx, user.id, body));
    return NextResponse.json({ cotacao: result.quote, cotacaoHash: result.hash });
  } catch (error) {
    if (error instanceof CommercialError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
});
