import { withApiGuard } from '@/app/utils/api-route';
import { NextResponse } from 'next/server';
import { validateRequest } from '@/app/utils/api-security';
import { hasCustomerCompanyAccess, resolveEmpresaContexto } from '@/app/utils/access-control';
import { findDpsSequence, normalizeDpsEnvironment, normalizeDpsSeries, syncDpsSequence } from '@/app/services/dpsSequenceService';
import { nextDpsCandidate, normalizeDpsNumber } from '@/app/utils/dps-identity';
import { checkRateLimit } from '@/app/utils/rate-limit';

export const dynamic = 'force-dynamic';

async function resolveAuthorizedCompany(request: Request, user: any) {
  const contextId = request.headers.get('x-empresa-id');
  const empresaId = await resolveEmpresaContexto(user, contextId);
  if (!empresaId) return null;
  return await hasCustomerCompanyAccess(user, empresaId) ? empresaId : null;
}

export const GET = withApiGuard(async function GET(request: Request) {
  const { user, targetId, errorResponse } = await validateRequest(request);
  if (errorResponse) return errorResponse;
  if (!user || !targetId) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });

  const empresaId = await resolveAuthorizedCompany(request, user);
  if (!empresaId) return NextResponse.json({ error: 'Acesso proibido.' }, { status: 403 });

  const { searchParams } = new URL(request.url);
  try {
    const ambiente = normalizeDpsEnvironment(searchParams.get('ambiente'));
    const serie = normalizeDpsSeries(searchParams.get('serie'));
    const sequence = await findDpsSequence(empresaId, ambiente, serie);
    return NextResponse.json({
      ambiente,
      serie,
      ultimoConfirmado: sequence?.ultimoConfirmado || 0,
      ultimoReservado: sequence?.ultimoReservado || 0,
      proximoNumero: nextDpsCandidate(sequence?.ultimoConfirmado || 0, sequence?.ultimoReservado || 0),
      sincronizadoEm: sequence?.sincronizadoEm || null,
      origem: sequence?.origem || null,
      statusSincronizacao: sequence?.statusSincronizacao || 'NAO_SINCRONIZADO',
    });
  } catch (error: any) {
    if (error.status && error.status < 500) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
});

export const POST = withApiGuard(async function POST(request: Request) {
  const { user, targetId, errorResponse } = await validateRequest(request);
  if (errorResponse) return errorResponse;
  if (!user || !targetId) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
  const empresaId = await resolveAuthorizedCompany(request, user);
  if (!empresaId) return NextResponse.json({ error: 'Acesso proibido.' }, { status: 403 });
  if (!await checkRateLimit('sync_dps_company_' + empresaId, 3, 60_000)) return NextResponse.json({ error: 'Aguarde antes de consultar a numeração novamente.' }, { status: 429 });

  try {
    const body = await request.json();
    const result = await syncDpsSequence({
      empresaId,
      ambiente: normalizeDpsEnvironment(body.ambiente),
      serie: normalizeDpsSeries(body.serie),
      ultimoConhecido: normalizeDpsNumber(body.ultimoConhecido ?? 0, true),
      maxConsultas: body.maxConsultas,
      userId: user.id,
    });

    return NextResponse.json({
      success: true,
      ambiente: result.ambiente, serie: result.serie, ultimoConfirmado: result.ultimoConfirmado,
      ultimoReservado: result.ultimoReservado, proximoNumero: result.proximoNumero,
      sincronizadoEm: result.sincronizadoEm, statusSincronizacao: result.statusSincronizacao,
      consultas: result.consultas, completo: result.completo,
      message: result.proximoNumero === null
        ? 'Intervalo de numeração suportado esgotado. Solicite análise; não reinicie a sequência.'
        : result.completo
          ? `Consulta concluída. Próximo candidato local: ${result.proximoNumero}. A reserva ocorre ao processar a emissão.`
          : `Consultamos ${result.consultas} números. Resultado parcial; próximo candidato local ${result.proximoNumero}.`,
    }, { status: result.completo ? 200 : 206 });
  } catch (error: any) {
    if (error.status && error.status < 500) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: 'Não foi possível sincronizar a numeração da DPS. Os números já reservados foram preservados.' }, { status: 503 });
  }
});
