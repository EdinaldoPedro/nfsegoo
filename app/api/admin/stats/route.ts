import { withApiGuard } from '@/app/utils/api-route';
import { getAdminFiscalStats, fiscalStatsPeriods } from '@/app/services/fiscalStatsService';
import { NextResponse } from 'next/server';
import { prisma } from '@/app/utils/prisma';
import { getAuthenticatedUser, forbidden, unauthorized } from '@/app/utils/api-middleware';

export const dynamic = 'force-dynamic';


const STAFF_ROLES = ['MASTER', 'ADMIN', 'SUPORTE', 'SUPORTE_TI', 'COMERCIAL'];

function paraNumero(valor: any) {
  if (!valor) return 0;
  return Number(valor.toString());
}

function contarPorChave(grupos: any[], chave: string) {
  return grupos.reduce((acc, item) => {
    acc[String(item[chave] || 'NAO_INFORMADO')] = item._count?._all || 0;
    return acc;
  }, {} as Record<string, number>);
}

export const GET = withApiGuard(async function GET(request: Request) {
    const user = await getAuthenticatedUser(request);
    if (!user) return unauthorized();
    if (!['MASTER', 'ADMIN'].includes(user.role)) return forbidden();

    const agora = new Date();
    const periods = fiscalStatsPeriods(agora);
    const mesAtual = periods.current.startsAt;
    const mesAnterior = periods.previous.startsAt;
    const ultimos7Dias = new Date(agora.getTime() - 7 * 24 * 60 * 60 * 1000);
    const proximos30Dias = new Date(agora.getTime() + 30 * 24 * 60 * 60 * 1000);

    const totalUsuarios = await prisma.user.count();
    const usuariosPorRole = await prisma.user.groupBy({ by: ['role'], _count: { _all: true } });
    const usuariosNovosMes = await prisma.user.count({ where: { createdAt: { gte: mesAtual } } });
    const usuariosNovosMesAnterior = await prisma.user.count({ where: { createdAt: { gte: mesAnterior, lt: mesAtual } } });

    const totalEmpresas = await prisma.empresa.count({ where: { arquivadoEm: null } });
    const empresasCompletas = await prisma.empresa.count({ where: { cadastroCompleto: true, arquivadoEm: null } });
    const empresasArquivadas = await prisma.empresa.count({ where: { arquivadoEm: { not: null } } });
    const empresasSemIbge = await prisma.empresa.count({
        where: {
          arquivadoEm: null,
          OR: [{ codigoIbge: null }, { codigoIbge: '' }]
        }
      });
    const empresasSemCertificado = await prisma.empresa.count({
        where: {
          arquivadoEm: null,
          OR: [{ certificadoA1: null }, { certificadoA1: '' }]
        }
      });
    const certificadosVencendo = await prisma.empresa.count({
        where: {
          arquivadoEm: null,
          certificadoVencimento: { gte: agora, lte: proximos30Dias }
        }
      });
    const empresasPorAmbiente = await prisma.empresa.groupBy({ by: ['ambiente'], _count: { _all: true } });
    const empresasPorUf = await prisma.empresa.groupBy({
        by: ['uf'],
        where: { uf: { not: null }, arquivadoEm: null },
        _count: { _all: true },
        orderBy: { _count: { uf: 'desc' } },
        take: 8
      });
    const municipiosMaisUsados = await prisma.empresa.groupBy({
        by: ['codigoIbge', 'cidade', 'uf'],
        where: { codigoIbge: { not: null }, arquivadoEm: null },
        _count: { _all: true },
        orderBy: { _count: { codigoIbge: 'desc' } },
        take: 8
      });

    const totalClientes = await prisma.cliente.count({ where: { arquivadoEm: null } });
    const totalVinculosCarteira = await prisma.vinculoCarteira.count({ where: { arquivadoEm: null } });

    const fiscal = await getAdminFiscalStats(agora);
    const { total: totalNotas, byStatus: notasPorStatus, month: notasMes,
      previousMonth: notasMesAnterior, cancelled: notasCanceladasMes, byDay: notasPorDia } = fiscal;

    const totalVendas = await prisma.venda.count({ where: { arquivadoEm: null } });
    const vendasPorStatus = await prisma.venda.groupBy({ by: ['status'], where: { arquivadoEm: null }, _count: { _all: true } });

    const totalTickets = await prisma.ticket.count({ where: { arquivadoEm: null } });
    const ticketsPorStatus = await prisma.ticket.groupBy({ by: ['status'], where: { arquivadoEm: null }, _count: { _all: true } });
    const ticketsPorPrioridade = await prisma.ticket.groupBy({ by: ['prioridade'], where: { arquivadoEm: null }, _count: { _all: true } });
    const ticketsAbertos = await prisma.ticket.count({ where: { arquivadoEm: null, status: { in: ['ABERTO', 'EM_ANDAMENTO'] } } });
    const ticketsNovos7d = await prisma.ticket.count({ where: { arquivadoEm: null, createdAt: { gte: ultimos7Dias } } });

    const totalGlobalCnae = await prisma.globalCnae.count();
    const cnaesComRetencao = await prisma.globalCnae.count({ where: { OR: [{ temRetencaoInss: true }, { retemCrsf: true }, { retemIr: true }] } });
    const cnaesLocais = await prisma.cnae.count();
    const tributacoesMunicipais = await prisma.tributacaoMunicipal.count();
    const municipiosHomologados = await prisma.municipioHomologado.count();
    const municipiosPorStatus = await prisma.municipioHomologado.groupBy({ by: ['status'], _count: { _all: true } });
    const cnaesMaisUsados = await prisma.cnae.groupBy({
        by: ['codigo', 'descricao'],
        _count: { _all: true },
        orderBy: { _count: { codigo: 'desc' } },
        take: 8
      });

    const planosAtivos = await prisma.plan.count({ where: { active: true } });
    const assinaturasAtivas = await prisma.planHistory.count({ where: { status: 'ATIVO', arquivadoEm: null } });
    const assinaturasPorStatus = await prisma.planHistory.groupBy({ by: ['status'], where: { arquivadoEm: null }, _count: { _all: true } });
    const faturasMes = await prisma.fatura.count({ where: { createdAt: { gte: mesAtual } } });
    const faturasPagasMes = await prisma.fatura.count({ where: { status: 'PAGO', pagoEm: { gte: mesAtual } } });
    const faturasPendentes = await prisma.fatura.count({ where: { status: 'PENDENTE' } });
    const valorPagoMes = await prisma.fatura.aggregate({
        where: { status: 'PAGO', pagoEm: { gte: mesAtual } },
        _sum: { valorTotal: true }
      });
    const pedidosPorStatus = await prisma.pedido.groupBy({ by: ['status'], _count: { _all: true } });
    const cuponsAtivos = await prisma.cupom.count({ where: { ativo: true } });
    const cuponsUsadosMes = await prisma.cupomLog.count({ where: { createdAt: { gte: mesAtual } } });

    const logsErro7d = await prisma.systemLog.count({ where: { level: { in: ['ERROR', 'ERRO', 'CRITICAL'] }, createdAt: { gte: ultimos7Dias } } });
    const logsRecentes = await prisma.systemLog.findMany({
        orderBy: { createdAt: 'desc' },
        take: 8,
        select: { id: true, level: true, action: true, message: true, createdAt: true }
      });

    const usuariosOperacionais = usuariosPorRole
      .filter((item) => !STAFF_ROLES.includes(item.role))
      .reduce((acc, item) => acc + item._count._all, 0);

    const crescimentoUsuariosMes =
      usuariosNovosMesAnterior > 0
        ? Math.round(((usuariosNovosMes - usuariosNovosMesAnterior) / usuariosNovosMesAnterior) * 100)
        : usuariosNovosMes > 0 ? 100 : 0;

    const variacaoNotasMes =
      notasMesAnterior > 0
        ? Math.round(((notasMes - notasMesAnterior) / notasMesAnterior) * 100)
        : notasMes > 0 ? 100 : 0;

    return NextResponse.json({
      atualizadoEm: agora.toISOString(),
      resumo: {
        usuarios: totalUsuarios,
        usuariosOperacionais,
        usuariosNovosMes,
        crescimentoUsuariosMes,
        empresas: totalEmpresas,
        empresasCompletas,
        empresasIncompletas: Math.max(totalEmpresas - empresasCompletas, 0),
        empresasArquivadas,
        clientes: totalClientes,
        vinculosCarteira: totalVinculosCarteira,
        notas: totalNotas,
        notasMes,
        variacaoNotasMes,
        valorNotasMes: fiscal.value,
        valorNotasMesAnterior: fiscal.previousValue,
        ticketsAbertos,
        logsErro7d
      },
      usuarios: {
        porRole: contarPorChave(usuariosPorRole, 'role'),
        novosMes: usuariosNovosMes,
        novosMesAnterior: usuariosNovosMesAnterior
      },
      empresas: {
        semIbge: empresasSemIbge,
        semCertificado: empresasSemCertificado,
        certificadosVencendo,
        porAmbiente: contarPorChave(empresasPorAmbiente, 'ambiente'),
        porUf: empresasPorUf.map((item) => ({ uf: item.uf || 'NI', total: item._count._all })),
        municipiosMaisUsados: municipiosMaisUsados.map((item) => ({
          codigoIbge: item.codigoIbge,
          cidade: item.cidade || 'Não informado',
          uf: item.uf || '',
          total: item._count._all
        }))
      },
      notas: {
        ambiente: fiscal.ambiente,
        porAmbiente: contarPorChave(fiscal.byEnvironment, 'ambiente'),
        semAmbiente: fiscal.legacy, datasEstimadasMes: fiscal.estimated, canceladasSemData: fiscal.cancellationDateUnknown,
        porStatus: contarPorChave(notasPorStatus, 'status'),
        canceladasMes: notasCanceladasMes,
        porDia30d: notasPorDia
      },
      vendas: {
        total: totalVendas,
        porStatus: contarPorChave(vendasPorStatus, 'status')
      },
      suporte: {
        total: totalTickets,
        abertos: ticketsAbertos,
        novos7d: ticketsNovos7d,
        porStatus: contarPorChave(ticketsPorStatus, 'status'),
        porPrioridade: contarPorChave(ticketsPorPrioridade, 'prioridade')
      },
      tecnico: {
        globalCnae: totalGlobalCnae,
        cnaesComRetencao,
        cnaesLocais,
        tributacoesMunicipais,
        municipiosHomologados,
        municipiosPorStatus: contarPorChave(municipiosPorStatus, 'status'),
        cnaesMaisUsados: cnaesMaisUsados.map((item) => ({
          codigo: item.codigo,
          descricao: item.descricao,
          total: item._count._all
        }))
      },
      financeiro: {
        planosAtivos,
        assinaturasAtivas,
        assinaturasPorStatus: contarPorChave(assinaturasPorStatus, 'status'),
        faturasMes,
        faturasPagasMes,
        faturasPendentes,
        valorPagoMes: paraNumero(valorPagoMes._sum.valorTotal),
        pedidosPorStatus: contarPorChave(pedidosPorStatus, 'status'),
        cuponsAtivos,
        cuponsUsadosMes
      },
      sistema: {
        logsErro7d,
        logsRecentes
      }
    });
});
