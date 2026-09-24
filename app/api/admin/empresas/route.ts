import { withApiGuard } from '@/app/utils/api-route';
import { NextResponse } from 'next/server';
import { getAuthenticatedUser, forbidden, unauthorized } from '@/app/utils/api-middleware';
import { AdminCompanyError, companyPublicRegistryData, listAdminCompanies, mutateAdminCompany, parseAdminCompanyMutation } from '@/app/services/adminCompanyService';
import { checkRateLimit } from '@/app/utils/rate-limit';
import { consultarEntidadeFiscalPublica } from '@/app/services/fiscalEntityService';
import { prisma } from '@/app/utils/prisma';

export const GET = withApiGuard(async function GET(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return unauthorized();
  if (!['MASTER', 'ADMIN'].includes(user.role)) return forbidden();
  try {
    return NextResponse.json(await listAdminCompanies(new URL(request.url).searchParams));
  } catch (error) {
    if (error instanceof AdminCompanyError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
});

export const POST = withApiGuard(async function POST(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return unauthorized();
  if (!['MASTER', 'ADMIN'].includes(user.role)) return forbidden();
  try {
    const body = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)
      || Object.keys(body).some(key => !['id', 'expectedUpdatedAt'].includes(key))
      || typeof body.id !== 'string' || !/^[a-z0-9_-]{1,100}$/i.test(body.id)
      || typeof body.expectedUpdatedAt !== 'string' || !Number.isFinite(Date.parse(body.expectedUpdatedAt))) {
      throw new AdminCompanyError('Solicitação de consulta pública inválida.');
    }
    if (!await checkRateLimit(`admin_company_preview_${user.id}`, 10, 60_000)) {
      return NextResponse.json({ error: 'Aguarde antes de realizar novas consultas públicas.' }, { status: 429 });
    }
    const company = await prisma.empresa.findUnique({ where: { id: body.id }, select: { documento: true, updatedAt: true, arquivadoEm: true } });
    if (!company) throw new AdminCompanyError('Prestador não encontrado.', 404);
    if (company.arquivadoEm) throw new AdminCompanyError('Restaure o prestador antes de consultar a fonte pública.', 409);
    if (company.updatedAt.toISOString() !== body.expectedUpdatedAt) throw new AdminCompanyError('Cadastro alterado. Reabra o prestador antes de consultar.', 409);
    const registry = await consultarEntidadeFiscalPublica(company.documento);
    if (!registry || registry.data.documento !== company.documento) throw new AdminCompanyError('A fonte pública não confirmou este CNPJ agora. Nenhum dado foi alterado; tente novamente em alguns instantes.', 424);
    return NextResponse.json({ data: companyPublicRegistryData(registry), fonte: registry.fonte,
      consultedAt: registry.consultedAt, sourceHash: registry.payloadHash, expectedUpdatedAt: company.updatedAt.toISOString() });
  } catch (error) {
    if (error instanceof SyntaxError) return NextResponse.json({ error: 'Operação JSON inválida.' }, { status: 400 });
    if (error instanceof AdminCompanyError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
}, { maxBodyBytes: 4 * 1024 });

async function mutate(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return unauthorized();
  if (!['MASTER', 'ADMIN'].includes(user.role)) return forbidden();
  if (!(await checkRateLimit(`admin_reauth_${user.id}`, 10, 5 * 60 * 1000))) {
    return NextResponse.json({ error: 'Muitas verificações administrativas. Aguarde 5 minutos.' }, { status: 429 });
  }
  try {
    const body = await request.json();
    // DELETE requires the same explicit, versioned body. Old query-string
    // unbinding/deletion cannot bypass scope, reauthentication or audit.
    if (request.method === 'DELETE' && body?.action !== 'ARCHIVE') {
      return NextResponse.json({ error: 'Para arquivar, confirme cadastro, versão, senha e justificativa.' }, { status: 400 });
    }
    let registry = null;
    if (body?.action === 'REFRESH') {
      const parsed = parseAdminCompanyMutation(body);
      const company = await prisma.empresa.findUnique({ where: { id: parsed.id }, select: { documento: true } });
      if (!company) throw new AdminCompanyError('Prestador não encontrado.', 404);
      registry = await consultarEntidadeFiscalPublica(company.documento);
      if (!registry || registry.data.documento !== company.documento) throw new AdminCompanyError('Não foi possível confirmar novamente os dados na fonte pública. Nada foi alterado; faça uma nova consulta.', 424);
      if (registry.payloadHash !== parsed.sourceHash) throw new AdminCompanyError('A fonte pública mudou desde a prévia. Consulte novamente antes de aplicar.', 409);
    }
    return NextResponse.json(await mutateAdminCompany(user.id, body, registry));
  } catch (error) {
    if (error instanceof SyntaxError) return NextResponse.json({ error: 'Envie a operação confirmada no corpo JSON. Atualize a tela.' }, { status: 400 });
    if (error instanceof AdminCompanyError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
export const PUT = withApiGuard(mutate, { maxBodyBytes: 16 * 1024 });
export const DELETE = withApiGuard(mutate, { maxBodyBytes: 16 * 1024 });
