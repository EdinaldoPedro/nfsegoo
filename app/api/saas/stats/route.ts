import { withApiGuard } from '@/app/utils/api-route';
import { NextResponse } from 'next/server';
import { prisma } from '@/app/utils/prisma';
import { validateRequest } from '@/app/utils/api-security';
import { resolveEmpresaContexto } from '@/app/utils/access-control';
import { currentFiscalMonth, reportPeriod } from '@/app/utils/fiscal-report';
import { noteDateWhere, noteEnvironmentWhere } from '@/app/services/fiscalReportService';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const GET = withApiGuard(async function GET(request: Request) {
    try {
        const { targetId, errorResponse } = await validateRequest(request);
        if (errorResponse) return errorResponse;
        const user = await prisma.user.findUnique({ where: { id: targetId } });
        if (!user) return NextResponse.json({ error: 'Nao autorizado.' }, { status: 401 });
        const empresaId = await resolveEmpresaContexto(user, request.headers.get('x-empresa-id'));
        if (!empresaId) return NextResponse.json({ totalNotas: 0, totalClientes: 0, municipios: 0, valorMes: 0 });

        // 1. Total de clientes cadastrados no SaaS inteiro
        const totalClientes = await prisma.cliente.count({ where: { empresaId, arquivadoEm: null, vinculos: { some: { empresaId, arquivadoEm: null } } } });

        // 2. Total de NFS-e emitidas (Status AUTORIZADA) na plataforma toda
        const totalNotas = await prisma.notaFiscal.count({
            where: { empresaId, status: 'AUTORIZADA', ambiente: 'PRODUCAO', arquivadoEm: null }
        });

        // 3. Municípios atingidos (Resolvido no JS para não quebrar o banco SQLite)
        const clientes = await prisma.cliente.groupBy({
            by: ['cidade'], where: { empresaId, arquivadoEm: null, cidade: { not: null } },
        });
        const municipiosUnicos = new Set(clientes.map(c => c.cidade).filter(Boolean));
        const municipios = municipiosUnicos.size;

        // 4. Valor Total do Mês Atual de todas as notas do SaaS
        const month = currentFiscalMonth();
        const period = reportPeriod(month.startDate, month.endDate);

        const notasMes = await prisma.notaFiscal.aggregate({
            where: {
                empresaId,
                status: 'AUTORIZADA', ambiente: 'PRODUCAO', arquivadoEm: null,
                AND: [noteDateWhere(period.startsAt, period.endsAt)],
            },
            _sum: { valor: true }
        });

        const notasSemAmbiente = await prisma.notaFiscal.count({ where: { empresaId, arquivadoEm: null,
            status: { in: ['AUTORIZADA', 'CANCELADA'] }, AND: [noteEnvironmentWhere('LEGADO')] } });
        const notasHomologacao = await prisma.notaFiscal.count({ where: { empresaId, arquivadoEm: null,
            status: { in: ['AUTORIZADA', 'CANCELADA'] }, ambiente: 'HOMOLOGACAO' } });
        return NextResponse.json({
            totalNotas,
            totalClientes,
            municipios,
            valorMes: notasMes._sum.valor?.toFixed(2) || '0.00', ambiente: 'PRODUCAO', notasSemAmbiente, notasHomologacao,
        }, {
            headers: {
                'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
                'Pragma': 'no-cache',
                'Expires': '0',
            }
        });

    } catch (error) {
        console.error('Erro ao buscar estatísticas globais:', error);
        return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
    }
});
