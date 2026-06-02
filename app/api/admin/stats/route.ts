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

async function safeQuery<T>(label: string, query: Promise<T>, fallback: T): Promise<T> {
  try {
    return await query;
  } catch (error) {
    console.error(`Erro parcial em /api/admin/stats (${label}):`, error);
    return fallback;
  }
}

function countFallback() {
  return 0;
}

function groupFallback() {
  return [] as any[];
}

function sumFallback(field: string) {
  return { _sum: { [field]: null } } as any;
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

    const totalUsuarios = await safeQuery('totalUsuarios', prisma.user.count(), countFallback());
    const usuariosPorRole = await safeQuery('usuariosPorRole', prisma.user.groupBy({ by: ['role'], _count: { _all: true } }), groupFallback());
    const usuariosNovosMes = await safeQuery('usuariosNovosMes', prisma.user.count({ where: { createdAt: { gte: mesAtual } } }), countFallback());
    const usuariosNovosMesAnterior = await safeQuery('usuariosNovosMesAnterior', prisma.user.count({ where: { createdAt: { gte: mesAnterior, lt: mesAtual } } }), countFallback());

    const totalEmpresas = await safeQuery('totalEmpresas', prisma.empresa.count({ where: { arquivadoEm: null } }), countFallback());
    const empresasCompletas = await safeQuery('empresasCompletas', prisma.empresa.count({ where: { cadastroCompleto: true, arquivadoEm: null } }), countFallback());
    const empresasArquivadas = await safeQuery('empresasArquivadas', prisma.empresa.count({ where: { arquivadoEm: { not: null } } }), countFallback());
    const empresasSemIbge = await safeQuery('empresasSemIbge', prisma.empresa.count({
        where: {
          arquivadoEm: null,
          OR: [{ codigoIbge: null }, { codigoIbge: '' }]
        }
      }), countFallback());
    const empresasSemCertificado = await safeQuery('empresasSemCertificado', prisma.empresa.count({
        where: {
          arquivadoEm: null,
          OR: [{ certificadoA1: null }, { certificadoA1: '' }]
        }
      }), countFallback());
    const certificadosVencendo = await safeQuery('certificadosVencendo', prisma.empresa.count({
        where: {
          arquivadoEm: null,
          certificadoVencimento: { gte: agora, lte: proximos30Dias }
        }
      }), countFallback());
    const empresasPorAmbiente = await safeQuery('empresasPorAmbiente', prisma.empresa.groupBy({ by: ['ambiente'], _count: { _all: true } }), groupFallback());
    const empresasPorUf = await safeQuery('empresasPorUf', prisma.empresa.groupBy({
        by: ['uf'],
        where: { uf: { not: null }, arquivadoEm: null },
        _count: { _all: true },
        orderBy: { _count: { uf: 'desc' } },
        take: 8
      }), groupFallback());
    const municipiosMaisUsados = await safeQuery('municipiosMaisUsados', prisma.empresa.groupBy({
        by: ['codigoIbge', 'cidade', 'uf'],
        where: { codigoIbge: { not: null }, arquivadoEm: null },
        _count: { _all: true },
        orderBy: { _count: { codigoIbge: 'desc' } },
        take: 8
      }), groupFallback());

    const totalClientes = await safeQuery('totalClientes', prisma.cliente.count({ where: { arquivadoEm: null } }), countFallback());
    const totalVinculosCarteira = await safeQuery('totalVinculosCarteira', prisma.vinculoCarteira.count({ where: { arquivadoEm: null } }), countFallback());

    const totalNotas = await safeQuery('totalNotas', prisma.notaFiscal.count({ where: { arquivadoEm: null } as any }), countFallback());
    const notasPorStatus = await safeQuery('notasPorStatus', prisma.notaFiscal.groupBy({ by: ['status'], where: { arquivadoEm: null } as any, _count: { _all: true } }), groupFallback());
    const notasMes = await safeQuery('notasMes', prisma.notaFiscal.count({ where: { arquivadoEm: null, createdAt: { gte: mesAtual } } as any }), countFallback());
    const notasMesAnterior = await safeQuery('notasMesAnterior', prisma.notaFiscal.count({ where: { arquivadoEm: null, createdAt: { gte: mesAnterior, lt: mesAtual } } as any }), countFallback());
    const valorNotasMes = await safeQuery('valorNotasMes', prisma.notaFiscal.aggregate({
        where: { status: 'AUTORIZADA', createdAt: { gte: mesAtual } },
        _sum: { valor: true }
      }), sumFallback('valor'));
    const valorNotasMesAnterior = await safeQuery('valorNotasMesAnterior', prisma.notaFiscal.aggregate({
        where: { status: 'AUTORIZADA', createdAt: { gte: mesAnterior, lt: mesAtual } },
        _sum: { valor: true }
      }), sumFallback('valor'));
    const notas30dPorDia = await safeQuery('notas30dPorDia', prisma.notaFiscal.groupBy({
        by: ['createdAt'],
        where: { arquivadoEm: null, createdAt: { gte: ultimos30Dias } } as any,
        _count: { _all: true },
        orderBy: { createdAt: 'asc' }
      }), groupFallback());
    const notasCanceladasMes = await safeQuery('notasCanceladasMes', prisma.notaFiscal.count({ where: { status: 'CANCELADA', arquivadoEm: null, createdAt: { gte: mesAtual } } as any }), countFallback());

    const totalVendas = await safeQuery('totalVendas', prisma.venda.count({ where: { arquivadoEm: null } }), countFallback());
    const vendasPorStatus = await safeQuery('vendasPorStatus', prisma.venda.groupBy({ by: ['status'], where: { arquivadoEm: null }, _count: { _all: true } }), groupFallback());

    const totalTickets = await safeQuery('totalTickets', prisma.ticket.count({ where: { arquivadoEm: null } }), countFallback());
    const ticketsPorStatus = await safeQuery('ticketsPorStatus', prisma.ticket.groupBy({ by: ['status'], where: { arquivadoEm: null }, _count: { _all: true } }), groupFallback());
    const ticketsPorPrioridade = await safeQuery('ticketsPorPrioridade', prisma.ticket.groupBy({ by: ['prioridade'], where: { arquivadoEm: null }, _count: { _all: true } }), groupFallback());
    const ticketsAbertos = await safeQuery('ticketsAbertos', prisma.ticket.count({ where: { arquivadoEm: null, status: { in: ['ABERTO', 'EM_ANDAMENTO'] } } }), countFallback());
    const ticketsNovos7d = await safeQuery('ticketsNovos7d', prisma.ticket.count({ where: { arquivadoEm: null, createdAt: { gte: ultimos7Dias } } }), countFallback());

    const totalGlobalCnae = await safeQuery('totalGlobalCnae', prisma.globalCnae.count(), countFallback());
    const cnaesComRetencao = await safeQuery('cnaesComRetencao', prisma.globalCnae.count({ where: { OR: [{ temRetencaoInss: true }, { retemCrsf: true }, { retemIr: true }] } }), countFallback());
    const cnaesLocais = await safeQuery('cnaesLocais', prisma.cnae.count(), countFallback());
    const tributacoesMunicipais = await safeQuery('tributacoesMunicipais', prisma.tributacaoMunicipal.count(), countFallback());
    const municipiosHomologados = await safeQuery('municipiosHomologados', prisma.municipioHomologado.count(), countFallback());
    const municipiosPorStatus = await safeQuery('municipiosPorStatus', prisma.municipioHomologado.groupBy({ by: ['status'], _count: { _all: true } }), groupFallback());
    const cnaesMaisUsados = await safeQuery('cnaesMaisUsados', prisma.cnae.groupBy({
        by: ['codigo', 'descricao'],
        _count: { _all: true },
        orderBy: { _count: { codigo: 'desc' } },
        take: 8
      }), groupFallback());

    const planosAtivos = await safeQuery('planosAtivos', prisma.plan.count({ where: { active: true } }), countFallback());
    const assinaturasAtivas = await safeQuery('assinaturasAtivas', prisma.planHistory.count({ where: { status: 'ATIVO', arquivadoEm: null } }), countFallback());
    const assinaturasPorStatus = await safeQuery('assinaturasPorStatus', prisma.planHistory.groupBy({ by: ['status'], where: { arquivadoEm: null }, _count: { _all: true } }), groupFallback());
    const faturasMes = await safeQuery('faturasMes', prisma.fatura.count({ where: { createdAt: { gte: mesAtual } } }), countFallback());
    const faturasPagasMes = await safeQuery('faturasPagasMes', prisma.fatura.count({ where: { status: 'PAGO', pagoEm: { gte: mesAtual } } }), countFallback());
    const faturasPendentes = await safeQuery('faturasPendentes', prisma.fatura.count({ where: { status: 'PENDENTE' } }), countFallback());
    const valorPagoMes = await safeQuery('valorPagoMes', prisma.fatura.aggregate({
        where: { status: 'PAGO', pagoEm: { gte: mesAtual } },
        _sum: { valorTotal: true }
      }), sumFallback('valorTotal'));
    const pedidosPorStatus = await safeQuery('pedidosPorStatus', prisma.pedido.groupBy({ by: ['status'], _count: { _all: true } }), groupFallback());
    const cuponsAtivos = await safeQuery('cuponsAtivos', prisma.cupom.count({ where: { ativo: true } }), countFallback());
    const cuponsUsadosMes = await safeQuery('cuponsUsadosMes', prisma.cupomLog.count({ where: { createdAt: { gte: mesAtual } } }), countFallback());

    const logsErro7d = await safeQuery('logsErro7d', prisma.systemLog.count({ where: { level: { in: ['ERROR', 'ERRO', 'CRITICAL'] }, createdAt: { gte: ultimos7Dias } } }), countFallback());
    const logsRecentes = await safeQuery('logsRecentes', prisma.systemLog.findMany({
        orderBy: { createdAt: 'desc' },
        take: 8,
        select: { id: true, level: true, action: true, message: true, createdAt: true }
      }), [] as any[]);

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
