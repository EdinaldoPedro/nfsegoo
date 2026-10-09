import { NextResponse } from 'next/server';
import { withApiGuard } from '@/app/utils/api-route';
import { validateRequest } from '@/app/utils/api-security';
import { hasCustomerCompanyAccess, resolveEmpresaContexto } from '@/app/utils/access-control';
import { prisma } from '@/app/utils/prisma';

export const PUT = withApiGuard(async function PUT(request: Request) {
  const auth = await validateRequest(request);
  if (auth.errorResponse) return auth.errorResponse;
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some((key) => key !== 'enviar')) {
    return NextResponse.json({ error: 'Configuração inválida.' }, { status: 400 });
  }
  if (typeof body.enviar !== 'boolean') return NextResponse.json({ error: 'Informe se a IM deve ser enviada.' }, { status: 400 });
  const empresaId = auth.user ? await resolveEmpresaContexto(auth.user, request.headers.get('x-empresa-id')) : null;
  if (!auth.user || !empresaId || !await hasCustomerCompanyAccess(auth.user, empresaId)) {
    return NextResponse.json({ error: 'Empresa indisponível.' }, { status: 403 });
  }
  const result = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Empresa" WHERE "id" = ${empresaId} FOR UPDATE`;
    const companies = await tx.$queryRaw<Array<{ id: string; inscricaoMunicipal: string | null; enviar: boolean }>>`
      SELECT "id", "inscricaoMunicipal", "enviarInscricaoMunicipalDps" AS enviar
      FROM "Empresa" WHERE "id" = ${empresaId} AND "arquivadoEm" IS NULL LIMIT 1
    `;
    const company = companies[0];
    if (!company) throw Object.assign(new Error('Empresa indisponível.'), { status: 404 });
    if (!company.inscricaoMunicipal && body.enviar === false) {
      throw Object.assign(new Error('A empresa não possui Inscrição Municipal cadastrada para omitir.'), { status: 409 });
    }
    if (company.enviar !== body.enviar) {
      await tx.$executeRaw`UPDATE "Empresa" SET "enviarInscricaoMunicipalDps" = ${body.enviar}, "updatedAt" = clock_timestamp() WHERE "id" = ${empresaId}`;
      await tx.systemLog.create({ data: {
        level: 'ALERTA', action: 'COMPANY_DPS_PRESTADOR_IM_PREFERENCE_UPDATED', module: 'EMISSAO',
        userId: auth.user.id, empresaId,
        message: body.enviar ? 'Envio da IM do prestador reativado pelo usuário.' : 'Envio da IM do prestador desativado pelo usuário após orientação fiscal.',
        details: JSON.stringify({ previous: company.enviar, current: body.enviar }),
      } });
    }
    const updated = await tx.empresa.findUniqueOrThrow({ where: { id: empresaId }, select: { updatedAt: true } });
    return { enviar: body.enviar, inscricaoMunicipalPreservada: true, empresaAtualizadaEm: updated.updatedAt.toISOString() };
  });
  return NextResponse.json(result);
});
