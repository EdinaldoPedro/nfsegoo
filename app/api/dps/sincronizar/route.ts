import { NextResponse } from 'next/server';
import { validateRequest } from '@/app/utils/api-security';
import { hasEmpresaAccess, resolveEmpresaContexto } from '@/app/utils/access-control';
import { findDpsSequence, normalizeDpsEnvironment, normalizeDpsSeries, syncDpsSequence } from '@/app/services/dpsSequenceService';

export const dynamic = 'force-dynamic';

async function resolveAuthorizedCompany(request: Request, user: any, targetId: string) {
  const contextId = request.headers.get('x-empresa-id');
  const empresaId = await resolveEmpresaContexto(user, contextId);
  if (!empresaId) return null;
  return await hasEmpresaAccess(user, empresaId) ? empresaId : null;
}

export async function GET(request: Request) {
  const { user, targetId, errorResponse } = await validateRequest(request);
  if (errorResponse) return errorResponse;
  if (!user || !targetId) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });

  const empresaId = await resolveAuthorizedCompany(request, user, targetId);
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
      proximoNumero: (sequence?.ultimoConfirmado || 0) + 1,
      sincronizadoEm: sequence?.sincronizadoEm || null,
      origem: sequence?.origem || null,
      statusSincronizacao: sequence?.statusSincronizacao || 'NAO_SINCRONIZADO',
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: error.status || 400 });
  }
}

export async function POST(request: Request) {
  const { user, targetId, errorResponse } = await validateRequest(request);
  if (errorResponse) return errorResponse;
  if (!user || !targetId) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });

  const empresaId = await resolveAuthorizedCompany(request, user, targetId);
  if (!empresaId) return NextResponse.json({ error: 'Acesso proibido.' }, { status: 403 });

  try {
    const body = await request.json();
    const result = await syncDpsSequence({
      empresaId,
      ambiente: normalizeDpsEnvironment(body.ambiente),
      serie: normalizeDpsSeries(body.serie),
      ultimoConhecido: Math.max(0, Number(body.ultimoConhecido || 0)),
      maxConsultas: body.maxConsultas,
      userId: targetId,
    });

    return NextResponse.json({
      success: true,
      ...result,
      message: result.completo
        ? `Numeração sincronizada. Próxima DPS disponível: ${result.proximoNumero}.`
        : `Consultamos ${result.consultas} números. A sincronização ficou parcial e pode ser continuada a partir da DPS ${result.proximoNumero}.`,
    }, { status: result.completo ? 200 : 206 });
  } catch (error: any) {
    return NextResponse.json({
      error: error.message || 'Não foi possível sincronizar a numeração da DPS.',
    }, { status: error.status || (error?.response?.status ? 502 : 503) });
  }
}
