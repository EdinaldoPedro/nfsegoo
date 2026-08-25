import { NextResponse } from 'next/server';
import { getAuthenticatedUser, forbidden, unauthorized } from '@/app/utils/api-middleware';
import { isSupportRole } from '@/app/utils/access-control';
import { inspecionarEmissaoVenda } from '@/app/services/emissao/EmissionInspector';
import { validateSelectableNbs } from '@/app/utils/nbs';

async function ensureSupport(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return unauthorized();
  if (!isSupportRole(user.role)) return forbidden();
  return null;
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const authError = await ensureSupport(request);
  if (authError) return authError;

  try {
    const body = await request.json().catch(() => ({}));
    if (body?.overrides?.codigoNbs !== undefined) {
      const nbsValidation = await validateSelectableNbs(body.overrides.codigoNbs);
      if (nbsValidation.error) return NextResponse.json({ error: nbsValidation.error }, { status: 400 });
      body.overrides.codigoNbs = nbsValidation.code;
    }
    const data = await inspecionarEmissaoVenda(params.id, body?.overrides || {});
    return NextResponse.json(data);
  } catch (error: any) {
    return NextResponse.json({
      error: error.message || 'Nao foi possivel inspecionar a emissao.',
    }, { status: 500 });
  }
}
