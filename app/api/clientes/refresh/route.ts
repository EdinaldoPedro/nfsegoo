import { NextResponse } from 'next/server';
import { withApiGuard } from '@/app/utils/api-route';
import { validateRequest } from '@/app/utils/api-security';
import { prisma } from '@/app/utils/prisma';
import { resolveEmpresaContexto } from '@/app/utils/access-control';
import { validateJsonContentLength } from '@/app/utils/request-guards';
import { findTenantCustomer } from '@/app/services/tenantCustomerService';
import { refreshCanonicalFiscalEntity } from '@/app/services/fiscalEntityService';
import { checkRateLimit } from '@/app/utils/rate-limit';

export const POST = withApiGuard(async function POST(request: Request) {
  const { targetId, errorResponse } = await validateRequest(request);
  if (errorResponse) return errorResponse;
  const user = await prisma.user.findUnique({ where: { id: targetId } });
  if (!user) return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 });
  const empresaId = await resolveEmpresaContexto(user, request.headers.get('x-empresa-id'));
  if (!empresaId) return NextResponse.json({ error: 'Empresa não autorizada.' }, { status: 403 });
  if (!(await checkRateLimit(`fiscal_entity_refresh_${user.id}`, 10, 60 * 60 * 1000))) {
    return NextResponse.json({ error: 'Muitas atualizações cadastrais. Aguarde uma hora ou procure o atendimento.' }, { status: 429 });
  }
  try {
    const sizeError = validateJsonContentLength(request, 8 * 1024);
    if (sizeError) return sizeError;
    const body = await request.json();
    if (typeof body?.clienteId !== 'string' || !/^[a-z0-9_-]{1,100}$/i.test(body.clienteId)) {
      return NextResponse.json({ error: 'Cliente inválido.' }, { status: 400 });
    }
    const customer = await findTenantCustomer(body.clienteId, empresaId);
    if (!customer || customer.tipo !== 'PJ' || !customer.documento || !customer.entidadeFiscalId) {
      return NextResponse.json({ error: 'Este cadastro não possui uma identidade fiscal PJ compartilhada.' }, { status: 409 });
    }
    await refreshCanonicalFiscalEntity(customer.documento, user.id);
    const refreshed = await findTenantCustomer(customer.id, empresaId);
    await prisma.systemLog.create({ data: { level: 'INFO', module: 'CLIENTES', action: 'ENTIDADE_FISCAL_ATUALIZADA',
      userId: user.id, empresaId, message: 'Identidade fiscal pública atualizada; dados privados da carteira preservados.',
      details: JSON.stringify({ clienteId: customer.id, entidadeFiscalId: customer.entidadeFiscalId }) } });
    return NextResponse.json({ success: true, cliente: refreshed });
  } catch (error) {
    const status = Number((error as { status?: number })?.status) || 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Não foi possível atualizar o cadastro.' }, { status });
  }
}, { maxBodyBytes: 8 * 1024 });
