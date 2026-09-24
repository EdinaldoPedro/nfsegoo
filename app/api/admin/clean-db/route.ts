import { withApiGuard } from '@/app/utils/api-route';
import { NextResponse } from 'next/server';
import { getAuthenticatedUser, forbidden, unauthorized } from '@/app/utils/api-middleware';
import { prisma } from '@/app/utils/prisma';
import { requireAdminReauthentication } from '@/app/utils/admin-security';
import { createLog } from '@/app/services/logger';
import { validateJsonContentLength } from '@/app/utils/request-guards';

export const DELETE = withApiGuard(async function DELETE(request: Request) {
  try {
    if (process.env.ENABLE_MAINTENANCE_ROUTES !== 'true') {
      return NextResponse.json({ error: 'Recurso indisponivel.' }, { status: 404 });
    }
    // 1. Verificação de Segurança (NOVO)
    const user = await getAuthenticatedUser(request);
    if (!user) return unauthorized();
    
    // Limpeza em massa e exclusiva do papel de maior privilegio.
    if (user.role !== 'MASTER') {
        return forbidden();
    }

    const sizeError = validateJsonContentLength(request, 16 * 1024);
    if (sizeError) return sizeError;
    const body = await request.json().catch(() => ({}));
    if (body.confirmation !== 'LIMPAR TABELAS FISCAIS') {
      return NextResponse.json({ error: 'Confirmacao textual invalida.' }, { status: 400 });
    }

    const reauthError = await requireAdminReauthentication({
      actorId: user.id,
      password: body.adminPassword,
      justification: body.justification,
      action: 'CLEAR_FISCAL_SUPPORT_TABLES',
    });
    if (reauthError) return reauthError;

    const result = await prisma.$transaction(async (tx) => ({
      cnaes: (await tx.cnae.deleteMany({})).count,
      regrasMunicipais: (await tx.tributacaoMunicipal.deleteMany({})).count,
      municipios: (await tx.municipioHomologado.deleteMany({})).count,
      cnaesGlobais: (await tx.globalCnae.deleteMany({})).count,
    }));

    await createLog({
      level: 'ALERTA',
      action: 'FISCAL_SUPPORT_TABLES_CLEARED',
      module: 'SEGURANCA',
      userId: user.id,
      message: 'Tabelas fiscais de apoio foram limpas pelo MASTER.',
      details: { result, justification: body.justification },
    });

    return NextResponse.json({ success: true, message: 'Tabelas de apoio limpas.', result });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}, { maxBodyBytes: 16 * 1024 });
