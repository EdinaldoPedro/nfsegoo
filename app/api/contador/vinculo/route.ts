import { withApiGuard } from '@/app/utils/api-route';
import { NextResponse } from 'next/server';
import { prisma } from '@/app/utils/prisma';
import { getAuthenticatedUser, forbidden, unauthorized } from '@/app/utils/api-middleware';
import { upsertEmpresaAndLinkUser } from '@/app/services/empresaService';
import { stripEmpresaSecrets } from '@/app/utils/safe-data';
import { decideAccountantLink } from '@/app/services/accountantLinkService';
import { requireAdminReauthentication } from '@/app/utils/admin-security';
import { CommercialError } from '@/app/utils/commercial-pricing';
import { normalizeCnpj } from '@/app/utils/cnpj';
import { currentFiscalMonth, reportPeriod } from '@/app/utils/fiscal-report';
import { noteEnvironmentWhere } from '@/app/services/fiscalReportService';

const PENDING_LINK_STATUSES = ['PENDENTE', 'PENDENTE_DONO', 'PENDENTE_CUSTODIANTE'];

// GET
export const GET = withApiGuard(async function GET(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return unauthorized();

  const { searchParams } = new URL(request.url);
  const mode = searchParams.get('mode');

  try {
    if (mode === 'contador') {
        if (!['CONTADOR', 'MASTER', 'ADMIN'].includes(user.role)) return forbidden();
        const vinculos = await prisma.contadorVinculo.findMany({
            where: { contadorId: user.id, arquivadoEm: null } as any,
            include: { empresa: true },
            orderBy: { updatedAt: 'desc' }
        });

        const month = currentFiscalMonth();
        const { startsAt: inicioMes, endsAt: fimPeriodo } = reportPeriod(month.startDate, month.endDate);

        const vinculosComResumo = await Promise.all(vinculos.map(async (vinculo) => {
            if (vinculo.status !== 'APROVADO') return {
                id: vinculo.id, status: vinculo.status, empresaId: vinculo.empresaId, createdAt: vinculo.createdAt, updatedAt: vinculo.updatedAt,
                empresa: { id: vinculo.empresa.id, documento: vinculo.empresa.documento, razaoSocial: vinculo.empresa.razaoSocial }, resumo: null,
            };
            const [notasMes, ultimaNota, clientesCarteira, notasSemAmbiente, notasHomologacao] = await Promise.all([
                prisma.notaFiscal.count({
                    where: {
                        empresaId: vinculo.empresaId,
                        status: 'AUTORIZADA',
                        ambiente: 'PRODUCAO',
                        arquivadoEm: null,
                        OR: [
                            { dataEmissao: { gte: inicioMes, lt: fimPeriodo } },
                            { dataEmissao: null, createdAt: { gte: inicioMes, lt: fimPeriodo } }
                        ]
                    } as any
                }),
                prisma.notaFiscal.findFirst({
                    where: { empresaId: vinculo.empresaId, status: 'AUTORIZADA', ambiente: 'PRODUCAO', arquivadoEm: null } as any,
                    orderBy: [{ dataEmissao: 'desc' }, { createdAt: 'desc' }],
                    select: { dataEmissao: true, createdAt: true, valor: true }
                }),
                prisma.vinculoCarteira.count({
                    where: { empresaId: vinculo.empresaId, arquivadoEm: null } as any
                }),
                prisma.notaFiscal.count({ where: { empresaId: vinculo.empresaId, arquivadoEm: null, AND: [noteEnvironmentWhere('LEGADO')] } }),
                prisma.notaFiscal.count({ where: { empresaId: vinculo.empresaId, arquivadoEm: null, ambiente: 'HOMOLOGACAO' } }),
            ]);

            return {
                ...vinculo,
                empresa: stripEmpresaSecrets(vinculo.empresa),
                resumo: {
                    notasMes,
                    ambiente: 'PRODUCAO', notasSemAmbiente, notasHomologacao,
                    clientesCarteira,
                    ultimaEmissao: ultimaNota?.dataEmissao || ultimaNota?.createdAt || null,
                    valorUltimaNota: ultimaNota?.valor || null
                }
            };
        }));

        return NextResponse.json(vinculosComResumo);
    }
    if (mode === 'pendentes-custodia') {
        if (!['CONTADOR', 'MASTER', 'ADMIN'].includes(user.role)) return forbidden();

        const empresasCustodiadas = await prisma.empresa.findMany({
          where: { contadorCustodianteId: user.id, arquivadoEm: null }, select: { id: true },
        });
        const empresaIds = empresasCustodiadas.map((empresa) => empresa.id);

        if (empresaIds.length === 0) return NextResponse.json([]);

        const solicitacoes = await prisma.contadorVinculo.findMany({
            where: {
                empresaId: { in: empresaIds },
                contadorId: { not: user.id },
                status: 'PENDENTE_CUSTODIANTE',
                arquivadoEm: null,
            } as any,
            include: {
                contador: { select: { id: true, nome: true, email: true, telefone: true } },
                empresa: true,
            },
            orderBy: { updatedAt: 'asc' },
        });

        return NextResponse.json(solicitacoes.map((vinculo: any) => ({
            ...vinculo,
            empresa: stripEmpresaSecrets(vinculo.empresa),
        })));
    }
    if (mode === 'cliente') {
        const empresasDoDono = await prisma.empresa.findMany({
            where: {
                arquivadoEm: null,
                OR: [
                    { proprietarioUserId: user.id } as any,
                    ...(user.empresaId ? [{ id: user.empresaId }] : []),
                ],
            } as any,
            select: { id: true },
        });
        const empresaIds = empresasDoDono.map((empresa) => empresa.id);
        if (empresaIds.length === 0) return NextResponse.json([]);

        const solicitacoes = await prisma.contadorVinculo.findMany({
            where: { empresaId: { in: empresaIds }, status: { in: ['PENDENTE', 'PENDENTE_DONO', 'APROVADO'] }, arquivadoEm: null } as any,
            include: { contador: { select: { nome: true, email: true } } }
        });
        return NextResponse.json(solicitacoes);
    }
    return NextResponse.json([]);
  } catch (e) { return NextResponse.json({ error: 'Erro ao buscar dados.' }, { status: 500 }); }
});

// POST
export const POST = withApiGuard(async function POST(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return unauthorized();
  
  if (user.role !== 'CONTADOR') {
      return NextResponse.json({ error: 'Apenas contadores.' }, { status: 403 });
  }

  try {
    const { cnpj } = await request.json();
    if (!cnpj) return NextResponse.json({ error: 'CNPJ obrigatório.' }, { status: 400 });
    const cnpjLimpo = normalizeCnpj(cnpj);

    // Chama Service
    const resultado: any = await upsertEmpresaAndLinkUser(cnpjLimpo, user.id, null, 'CONTADOR');
    
    // Verifica se ficou PENDENTE ou APROVADO
    const isPendente = PENDING_LINK_STATUSES.includes(resultado._statusVinculo);
    const messageByStatus: Record<string, string> = {
        APROVADO: 'Empresa vinculada com sucesso!',
        PENDENTE: 'Solicitacao enviada ao dono da empresa.',
        PENDENTE_DONO: 'Solicitacao enviada ao dono da empresa.',
        PENDENTE_CUSTODIANTE: 'Solicitacao registrada. A liberacao depende do contador custodiante atual.'
    };

    return NextResponse.json({ 
        success: true, 
        message: messageByStatus[resultado._statusVinculo] || (isPendente ? 'Solicitacao pendente.' : 'Empresa vinculada com sucesso!'),
        status: resultado._statusVinculo 
    });

  } catch (e: any) { 
      if (e instanceof CommercialError) return NextResponse.json({ error: e.message }, { status: e.status });
      throw e;
  }
});

// PUT
export const PUT = withApiGuard(async function PUT(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return unauthorized();

  const body = await request.json();
  const customerMode = request.headers.get('x-portal-mode') === 'customer';
  const admin = ['MASTER', 'ADMIN'].includes(user.role) && !customerMode;
  if (admin) {
    const denied = await requireAdminReauthentication({ actorId: user.id, password: body.adminPassword,
      justification: body.justification, action: 'ACCOUNTANT_LINK_DECISION' });
    if (denied) return denied;
  }
  try {
    return NextResponse.json(await decideAccountantLink({ actorId: user.id, linkId: body.vinculoId,
      action: body.acao === 'NEGAR' ? 'REJEITAR' : body.acao, adminReauthenticated: admin,
      customerMode, justification: admin ? body.justification : undefined }));
  } catch (error) {
    if (error instanceof CommercialError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
}, { maxBodyBytes: 16 * 1024 });

export const DELETE = withApiGuard(async function DELETE(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return unauthorized();
  const customerMode = request.headers.get('x-portal-mode') === 'customer';
  const admin = ['MASTER', 'ADMIN'].includes(user.role) && !customerMode;
  const body = admin ? await request.json() : {};
  if (admin) {
    const denied = await requireAdminReauthentication({ actorId: user.id, password: body.adminPassword,
      justification: body.justification, action: 'ACCOUNTANT_LINK_REVOKE' });
    if (denied) return denied;
  }
  try {
    return NextResponse.json(await decideAccountantLink({ actorId: user.id, linkId: new URL(request.url).searchParams.get('id'),
      action: 'REVOGAR', adminReauthenticated: admin, customerMode, justification: admin ? body.justification : undefined }));
  } catch (error) {
    if (error instanceof CommercialError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
}, { maxBodyBytes: 16 * 1024 });
