import { NextResponse } from 'next/server';
import { withApiGuard } from '@/app/utils/api-route';
import { getAuthenticatedUser, forbidden, unauthorized } from '@/app/utils/api-middleware';
import { requireAdminReauthentication } from '@/app/utils/admin-security';
import { prisma } from '@/app/utils/prisma';
import { decideAccountantLink } from '@/app/services/accountantLinkService';

export const dynamic = 'force-dynamic';

const personSelect = { id: true, nome: true, email: true, role: true } as const;

export const GET = withApiGuard(async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getAuthenticatedUser(request);
  if (!actor) return unauthorized();
  if (!['MASTER', 'ADMIN'].includes(actor.role)) return forbidden();
  const { id } = await params;
  const company = await prisma.empresa.findUnique({
    where: { id },
    select: {
      id: true, razaoSocial: true, documento: true, statusPropriedade: true,
      proprietarioUser: { select: personSelect }, donoUser: { select: personSelect },
      donoFaturamento: { select: personSelect }, contadorCustodiante: { select: personSelect },
      contadoresLink: {
        where: { status: 'APROVADO', arquivadoEm: null }, orderBy: { updatedAt: 'desc' },
        select: { id: true, contadorId: true, clientePodeAcessarPortal: true, nivelPortal: true, contador: { select: personSelect } },
      },
      vinculadoA: {
        where: { revokedAt: null }, orderBy: { createdAt: 'desc' },
        select: { id: true, createdAt: true, user: { select: personSelect } },
      },
    },
  });
  if (!company) return NextResponse.json({ error: 'Empresa não encontrada.' }, { status: 404 });

  return NextResponse.json({
    empresa: { id: company.id, razaoSocial: company.razaoSocial, documento: company.documento, statusPropriedade: company.statusPropriedade },
    responsabilidades: [
      company.proprietarioUser && { kind: 'OWNER', label: 'Proprietário', user: company.proprietarioUser },
      company.donoUser && company.donoUser.id !== company.proprietarioUser?.id && { kind: 'LEGACY_OWNER', label: 'Responsável principal legado', user: company.donoUser },
      company.donoFaturamento && { kind: 'BILLING', label: 'Responsável pelo faturamento', user: company.donoFaturamento },
      company.contadorCustodiante && { kind: 'CUSTODIAN', label: 'Custodiante contábil', user: company.contadorCustodiante },
    ].filter(Boolean),
    acessosContabeis: company.contadoresLink.map(link => ({ kind: 'ACCOUNTANT', linkId: link.id, user: link.contador,
      nivelPortal: link.nivelPortal, clientePodeAcessarPortal: link.clientePodeAcessarPortal,
      revogavel: company.contadorCustodiante?.id !== link.contadorId })),
    acessosOperacionais: company.vinculadoA.map(link => ({ kind: 'OPERATOR', linkId: link.id, user: link.user,
      createdAt: link.createdAt, revogavel: true })),
  });
});

export const DELETE = withApiGuard(async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getAuthenticatedUser(request);
  if (!actor) return unauthorized();
  if (!['MASTER', 'ADMIN'].includes(actor.role)) return forbidden();
  const { id: empresaId } = await params;
  const body = await request.json();
  if (!body || !['ACCOUNTANT', 'OPERATOR'].includes(body.kind) || typeof body.linkId !== 'string'
    || Object.keys(body).some(key => !['kind', 'linkId', 'adminPassword', 'justification'].includes(key))) {
    return NextResponse.json({ error: 'Solicitação de desvinculação inválida.' }, { status: 400 });
  }
  const denied = await requireAdminReauthentication({ actorId: actor.id, password: body.adminPassword,
    justification: body.justification, action: 'ADMIN_COMPANY_ACCESS_REVOKE' });
  if (denied) return denied;

  if (body.kind === 'ACCOUNTANT') {
    const link = await prisma.contadorVinculo.findUnique({ where: { id: body.linkId }, select: { empresaId: true } });
    if (!link || link.empresaId !== empresaId) return NextResponse.json({ error: 'Vínculo contábil não encontrado nesta empresa.' }, { status: 404 });
    await decideAccountantLink({ actorId: actor.id, linkId: body.linkId, action: 'REVOGAR', adminReauthenticated: true,
      justification: body.justification });
  } else {
    await prisma.$transaction(async tx => {
      const link = await tx.userCliente.findUnique({ where: { id: body.linkId }, select: { empresaId: true, revokedAt: true, userId: true } });
      if (!link || link.empresaId !== empresaId) throw new Error('Vínculo operacional não encontrado nesta empresa.');
      if (link.revokedAt) throw new Error('Este acesso já foi encerrado.');
      await tx.userCliente.update({ where: { id: body.linkId }, data: { revokedAt: new Date(), revokedBy: actor.id,
        revocationReason: body.justification.trim() } });
      await tx.systemLog.create({ data: { level: 'ALERTA', module: 'VINCULOS', action: 'OPERATOR_ACCESS_REVOKED',
        userId: actor.id, empresaId, message: 'Acesso operacional encerrado pelo painel administrativo.',
        details: JSON.stringify({ linkId: body.linkId, affectedUserId: link.userId, justification: body.justification.trim() }) } });
    });
  }
  return NextResponse.json({ success: true, message: 'Acesso encerrado. O histórico e a auditoria foram preservados.' });
}, { maxBodyBytes: 8 * 1024 });
