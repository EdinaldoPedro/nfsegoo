import { NextResponse } from 'next/server';
import { withApiGuard } from '@/app/utils/api-route';
import { getAuthenticatedUser, forbidden, unauthorized } from '@/app/utils/api-middleware';
import { requireAdminReauthentication } from '@/app/utils/admin-security';
import { consultarEntidadeFiscalPublica } from '@/app/services/fiscalEntityService';
import { AdminFiscalEntityError, listAdminFiscalEntities, mutateAdminFiscalEntity, parseAdminFiscalEntityMutation } from '@/app/services/adminFiscalEntityService';
import { prisma } from '@/app/utils/prisma';
import { checkRateLimit } from '@/app/utils/rate-limit';

export const GET = withApiGuard(async function GET(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return unauthorized();
  if (!['ADMIN', 'MASTER'].includes(user.role)) return forbidden();
  try { return NextResponse.json(await listAdminFiscalEntities(new URL(request.url).searchParams)); }
  catch (error) {
    if (error instanceof AdminFiscalEntityError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
});

// Public-source lookup is a read-only preview. Authentication, authorization
// and throttling protect the external provider; reauthentication is reserved
// for the later operation that commits a global canonical identity change.
export const POST = withApiGuard(async function POST(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return unauthorized();
  if (!['ADMIN', 'MASTER'].includes(user.role)) return forbidden();
  try {
    const body = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)
      || Object.keys(body).some(key => !['id', 'expectedVersion'].includes(key))
      || typeof body.id !== 'string' || !/^[a-z0-9_-]{1,100}$/i.test(body.id)
      || !Number.isSafeInteger(Number(body.expectedVersion)) || Number(body.expectedVersion) < 1) {
      throw new AdminFiscalEntityError('Solicitação de consulta pública inválida.');
    }
    if (!await checkRateLimit(`admin_fiscal_entity_preview_${user.id}`, 10, 60_000)) {
      return NextResponse.json({ error: 'Aguarde antes de realizar novas consultas públicas.' }, { status: 429 });
    }
    const entity = await prisma.entidadeFiscal.findUnique({ where: { id: body.id },
      select: { documento: true, version: true } });
    if (!entity) throw new AdminFiscalEntityError('Identidade fiscal não encontrada.', 404);
    if (entity.version !== Number(body.expectedVersion)) throw new AdminFiscalEntityError('Cadastro alterado. Reabra a identidade antes de consultar.', 409);
    const registry = await consultarEntidadeFiscalPublica(entity.documento);
    if (!registry || registry.data.documento !== entity.documento) throw new AdminFiscalEntityError('A fonte pública não confirmou este CNPJ agora. Nenhum dado foi alterado; tente novamente em alguns instantes.', 424);
    const { documento: _documento, emailPublico: _email, telefonePublico: _telefone, ...publicData } = registry.data;
    return NextResponse.json({ data: publicData, fonte: registry.fonte, consultedAt: registry.consultedAt,
      sourceHash: registry.payloadHash, expectedVersion: entity.version,
      atividades: registry.atividades.map(item => ({ codigo: item.codigo, descricao: item.descricao, principal: item.principal })) });
  } catch (error) {
    if (error instanceof SyntaxError) return NextResponse.json({ error: 'Operação JSON inválida.' }, { status: 400 });
    if (error instanceof AdminFiscalEntityError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
}, { maxBodyBytes: 4 * 1024 });

export const PUT = withApiGuard(async function PUT(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return unauthorized();
  if (!['ADMIN', 'MASTER'].includes(user.role)) return forbidden();
  try {
    const body = await request.json();
    const parsed = parseAdminFiscalEntityMutation(body);
    const denied = await requireAdminReauthentication({ actorId: user.id, password: body.adminPassword,
      justification: body.justification, action: `ENTIDADE_FISCAL_${parsed.action}` });
    if (denied) return denied;
    let registry = null;
    if (parsed.action === 'REFRESH') {
      const entity = await prisma.entidadeFiscal.findUnique({ where: { id: parsed.id }, select: { documento: true } });
      if (!entity) throw new AdminFiscalEntityError('Identidade fiscal não encontrada.', 404);
      registry = await consultarEntidadeFiscalPublica(entity.documento);
      if (!registry || registry.data.documento !== entity.documento) throw new AdminFiscalEntityError('Não foi possível confirmar novamente os dados na fonte pública. Nada foi alterado; faça uma nova consulta.', 424);
      if (registry?.payloadHash !== parsed.sourceHash) throw new AdminFiscalEntityError('A fonte pública mudou desde a prévia. Consulte novamente antes de aplicar.', 409);
    }
    return NextResponse.json(await mutateAdminFiscalEntity(user.id, body, registry));
  } catch (error) {
    if (error instanceof SyntaxError) return NextResponse.json({ error: 'Operação JSON inválida.' }, { status: 400 });
    if (error instanceof AdminFiscalEntityError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
}, { maxBodyBytes: 16 * 1024 });
