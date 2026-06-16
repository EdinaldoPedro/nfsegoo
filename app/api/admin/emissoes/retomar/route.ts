import { NextResponse } from 'next/server';
import { getAuthenticatedUser, forbidden, unauthorized } from '@/app/utils/api-middleware';
import { isSupportRole } from '@/app/utils/access-control';
import { retomarEmissoesPendentes } from '@/app/services/emissaoJobService';
import { createLog } from '@/app/services/logger';

export const dynamic = 'force-dynamic';

function cronAutorizado(request: Request) {
  const secret = process.env.EMISSION_RESUME_SECRET;
  if (!secret) return false;
  return request.headers.get('x-emission-resume-secret') === secret;
}

function parseLimit(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = Number(searchParams.get('limit'));
  return Number.isFinite(limit) && limit > 0 ? Math.min(limit, 100) : undefined;
}

async function autorizar(request: Request) {
  if (cronAutorizado(request)) return { userId: 'CRON', error: null as NextResponse | null };

  const user = await getAuthenticatedUser(request);
  if (!user) return { userId: null, error: unauthorized() };
  if (!isSupportRole(user.role)) return { userId: user.id, error: forbidden() };

  return { userId: user.id, error: null as NextResponse | null };
}

async function executar(request: Request) {
  const auth = await autorizar(request);
  if (auth.error) return auth.error;

  const limit = parseLimit(request);
  const startedAt = Date.now();
  const resultado = await retomarEmissoesPendentes({ limit, recuperarTravados: true });

  await createLog({
    level: 'INFO',
    module: 'EMISSAO_JOB',
    action: 'EMISSAO_JOBS_RETOMADA_EXECUTADA',
    message: 'Rotina de retomada de emissoes pendentes executada.',
    userId: auth.userId || undefined,
    durationMs: Date.now() - startedAt,
    details: resultado,
  });

  return NextResponse.json({ success: true, ...resultado });
}

export async function GET(request: Request) {
  return executar(request);
}

export async function POST(request: Request) {
  return executar(request);
}
