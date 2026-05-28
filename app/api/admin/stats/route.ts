import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { getAuthenticatedUser, forbidden, unauthorized } from '@/app/utils/api-middleware';

export const dynamic = 'force-dynamic';

const prisma = new PrismaClient();

const STAFF_ROLES = ['MASTER', 'ADMIN', 'SUPORTE', 'SUPORTE_TI'];

function inicioDoMes(data: Date) {
  return new Date(data.getFullYear(), data.getMonth(), 1);
}

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

export async function GET(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return unauthorized();
    if (!['MASTER', 'ADMIN'].includes(user.role)) return forbidden();

    const agora = new Date();
    const mesAtual = inicioDoMes(agora);
    const mesAnterior = new Date(agora.getFullYear(), agora.getMonth() - 1, 1);
    const ultimos7Dias = new Date(agora.getTime() - 7 * 24 * 60 * 60 * 1000);
    const ultimos30Dias = new Date(agora.getTime() - 30 * 24 * 60 * 60 * 1000);
    const proximos30Dias = new Date(agora.getTime() + 30 * 24 * 60 * 60 * 1000);

    const [
      totalUsuarios,
      usuariosPorRole,
      usuariosNovosMes,
      usuariosNovosMesAnterior,
      totalEmpresas,
      empresasCompletas,
      empresasArquivadas,
      empresasSemIbge,
      empresasSemCertificado,
      certificadosVencendo,
      empresasPorAmbiente,
      empresasPorUf,
      municipiosMaisUsados,
      totalClientes,
      totalVinculosCarteira,
      totalNotas,
      notasPorStatus,
      notasMes,
      notasMesAnterior,
      valorNotasMes,
      valorNotasMesAnterior,
      notas30dPorDia,
      notasCanceladasMes,
      totalVendas,
      vendasPorStatus,
      totalTickets,
      ticketsPorStatus,
      ticketsPorPrioridade,
      ticketsAbertos,
      ticketsNovos7d,
      totalGlobalCnae,
      cnaesComRetencao,
      cnaesLocais,
      tributacoesMunicipais,
      municipiosHomologados,
      municipiosPorStatus,
      cnaesMaisUsados,
      planosAtivos,
      assinaturasAtivas,
      assinaturasPorStatus,
      faturasMes,
      faturasPagasMes,
      faturasPendentes,
      valorPagoMes,
      pedidosPorStatus,
      cuponsAtivos,
      cuponsUsadosMes,
      logsErro7d,
      logsRecentes
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.groupBy({ by: ['role'], _count: { _all: true } }),
      prisma.user.count({ where: { createdAt: { gte: mesAtual } } }),
      prisma.user.count({ where: { createdAt: { gte: mesAnterior, lt: mesAtual } } }),
      prisma.empresa.count(),
      prisma.empresa.count({ where: { cadastroCompleto: true, arquivadoEm: null } }),
      prisma.empresa.count({ where: { arquivadoEm: { not: null } } }),
      prisma.empresa.count({
        where: {
          arquivadoEm: null,
          OR: [{ codigoIbge: null }, { codigoIbge: '' }]
        }
      }),
      prisma.empresa.count({
        where: {
          arquivadoEm: null,
          OR: [{ certificadoA1: null }, { certificadoA1: '' }]
        }
      }),
      prisma.empresa.count({
        where: {
          arquivadoEm: null,
          certificadoVencimento: { gte: agora, lte: proximos30Dias }
        }
      }),
      prisma.empresa.groupBy({ by: ['ambiente'], _count: { _all: true } }),
      prisma.empresa.groupBy({
        by: ['uf'],
        where: { uf: { not: null }, arquivadoEm: null },
        _count: { _all: true },
        orderBy: { _count: { uf: 'desc' } },
        take: 8
      }),
      prisma.empresa.groupBy({
        by: ['codigoIbge', 'cidade', 'uf'],
        where: { codigoIbge: { not: null }, arquivadoEm: null },
        _count: { _all: true },
        orderBy: { _count: { codigoIbge: 'desc' } },
        take: 8
      }),
      prisma.cliente.count({ where: { arquivadoEm: null } }),
      prisma.vinculoCarteira.count({ where: { arquivadoEm: null } }),
      prisma.notaFiscal.count(),
      prisma.notaFiscal.groupBy({ by: ['status'], _count: { _all: true } }),
      prisma.notaFiscal.count({ where: { createdAt: { gte: mesAtual } } }),
      prisma.notaFiscal.count({ where: { createdAt: { gte: mesAnterior, lt: mesAtual } } }),
      prisma.notaFiscal.aggregate({
        where: { status: 'AUTORIZADA', createdAt: { gte: mesAtual } },
        _sum: { valor: true }
      }),
      prisma.notaFiscal.aggregate({
        where: { status: 'AUTORIZADA', createdAt: { gte: mesAnterior, lt: mesAtual } },
        _sum: { valor: true }
      }),
      prisma.notaFiscal.groupBy({
        by: ['createdAt'],
        where: { createdAt: { gte: ultimos30Dias } },
        _count: { _all: true },
        orderBy: { createdAt: 'asc' }
      }),
      prisma.notaFiscal.count({ where: { status: 'CANCELADA', createdAt: { gte: mesAtual } } }),
      prisma.venda.count({ where: { arquivadoEm: null } }),
      prisma.venda.groupBy({ by: ['status'], where: { arquivadoEm: null }, _count: { _all: true } }),
      prisma.ticket.count({ where: { arquivadoEm: null } }),
      prisma.ticket.groupBy({ by: ['status'], where: { arquivadoEm: null }, _count: { _all: true } }),
      prisma.ticket.groupBy({ by: ['prioridade'], where: { arquivadoEm: null }, _count: { _all: true } }),
      prisma.ticket.count({ where: { arquivadoEm: null, status: { in: ['ABERTO', 'EM_ANDAMENTO'] } } }),
      prisma.ticket.count({ where: { arquivadoEm: null, createdAt: { gte: ultimos7Dias } } }),
      prisma.globalCnae.count(),
      prisma.globalCnae.count({ where: { OR: [{ temRetencaoInss: true }, { retemCrsf: true }, { retemIr: true }] } }),
      prisma.cnae.count(),
      prisma.tributacaoMunicipal.count(),
      prisma.municipioHomologado.count(),
      prisma.municipioHomologado.groupBy({ by: ['status'], _count: { _all: true } }),
      prisma.cnae.groupBy({
        by: ['codigo', 'descricao'],
        _count: { _all: true },
        orderBy: { _count: { codigo: 'desc' } },
        take: 8
      }),
      prisma.plan.count({ where: { active: true } }),
      prisma.planHistory.count({ where: { status: 'ATIVO', arquivadoEm: null } }),
      prisma.planHistory.groupBy({ by: ['status'], where: { arquivadoEm: null }, _count: { _all: true } }),
      prisma.fatura.count({ where: { createdAt: { gte: mesAtual } } }),
      prisma.fatura.count({ where: { status: 'PAGO', pagoEm: { gte: mesAtual } } }),
      prisma.fatura.count({ where: { status: 'PENDENTE' } }),
      prisma.fatura.aggregate({
        where: { status: 'PAGO', pagoEm: { gte: mesAtual } },
        _sum: { valorTotal: true }
      }),
      prisma.pedido.groupBy({ by: ['status'], _count: { _all: true } }),
      prisma.cupom.count({ where: { ativo: true } }),
      prisma.cupomLog.count({ where: { createdAt: { gte: mesAtual } } }),
      prisma.systemLog.count({ where: { level: { in: ['ERROR', 'ERRO', 'CRITICAL'] }, createdAt: { gte: ultimos7Dias } } }),
      prisma.systemLog.findMany({
        orderBy: { createdAt: 'desc' },
        take: 8,
        select: { id: true, level: true, action: true, message: true, createdAt: true }
      })
    ]);

    const usuariosOperacionais = usuariosPorRole
      .filter((item) => !STAFF_ROLES.includes(item.role))
      .reduce((acc, item) => acc + item._count._all, 0);

    const notasPorDia = notas30dPorDia.reduce((acc, item) => {
      const chave = item.createdAt.toISOString().slice(0, 10);
      acc[chave] = (acc[chave] || 0) + item._count._all;
      return acc;
    }, {} as Record<string, number>);

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
        empresasIncompletas: Math.max(totalEmpresas - empresasCompletas - empresasArquivadas, 0),
        empresasArquivadas,
        clientes: totalClientes,
        vinculosCarteira: totalVinculosCarteira,
        notas: totalNotas,
        notasMes,
        variacaoNotasMes,
        valorNotasMes: paraNumero(valorNotasMes._sum.valor),
        valorNotasMesAnterior: paraNumero(valorNotasMesAnterior._sum.valor),
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
  } catch (error) {
    console.error('Erro ao carregar estatisticas admin:', error);
    return NextResponse.json({ error: 'Erro ao carregar estatísticas.' }, { status: 500 });
  }
}
