import { NextResponse } from 'next/server';
import { getAuthenticatedUser, forbidden, unauthorized } from '@/app/utils/api-middleware';
import { isSupportRole } from '@/app/utils/access-control';
import { getEffectivePlanLimits } from '@/app/services/planService';
import { prisma } from '@/app/utils/prisma';

export const dynamic = 'force-dynamic';

function parseDetails(details?: string | null) {
  if (!details) return null;
  try {
    return JSON.parse(details);
  } catch {
    return details;
  }
}

export async function GET(request: Request, { params }: { params: { id: string } }) {
  const admin = await getAuthenticatedUser(request);
  if (!admin) return unauthorized();
  if (!isSupportRole(admin.role)) return forbidden();

  const userId = params.id;

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        nome: true,
        email: true,
        role: true,
        plano: true,
        planoStatus: true,
        planoCiclo: true,
        planoExpiresAt: true,
        empresaId: true,
        limiteEmpresas: true,
        empresasAdicionais: true,
        createdAt: true,
      },
    });

    if (!user) return NextResponse.json({ error: 'Usuario nao encontrado.' }, { status: 404 });

    const limites = await getEffectivePlanLimits(userId);

    const [empresasProprietarias, vinculosContador, tickets, logsRecentes, vendasRecentes] = await Promise.all([
      prisma.empresa.findMany({
        where: { proprietarioUserId: userId, arquivadoEm: null } as any,
        select: { id: true, documento: true, razaoSocial: true, statusPropriedade: true, ambiente: true },
        orderBy: { razaoSocial: 'asc' },
        take: 20,
      }),
      prisma.contadorVinculo.findMany({
        where: { contadorId: userId, arquivadoEm: null } as any,
        include: {
          empresa: { select: { id: true, documento: true, razaoSocial: true, ambiente: true, statusPropriedade: true } },
        },
        orderBy: { updatedAt: 'desc' },
        take: 30,
      }),
      prisma.ticket.findMany({
        where: { solicitanteId: userId, arquivadoEm: null },
        select: { id: true, protocolo: true, assunto: true, status: true, prioridade: true, createdAt: true, updatedAt: true },
        orderBy: { updatedAt: 'desc' },
        take: 8,
      }),
      prisma.systemLog.findMany({
        where: {
          OR: [
            { userId },
            { details: { contains: userId } },
            { message: { contains: user.email } },
          ],
        },
        orderBy: { createdAt: 'desc' },
        take: 12,
      }),
      prisma.venda.findMany({
        where: {
          empresa: {
            OR: [
              { donoFaturamentoId: userId },
              { proprietarioUserId: userId } as any,
              { contadoresLink: { some: { contadorId: userId, status: 'APROVADO', arquivadoEm: null } } },
            ],
          },
        } as any,
        select: { id: true, status: true, valor: true, createdAt: true, cliente: { select: { nome: true, documento: true } } },
        orderBy: { createdAt: 'desc' },
        take: 8,
      }),
    ]);

    const problemas = [];
    if (limites.status !== 'ATIVO') problemas.push({ tipo: 'PLANO', mensagem: limites.reason || `Plano com status ${limites.status}.` });
    if (limites.limiteNotas > 0 && limites.notasUsadas >= limites.limiteNotas) problemas.push({ tipo: 'LIMITE_NOTAS', mensagem: 'Limite de NFS-e atingido.' });
    if (limites.limiteClientes > 0 && limites.clientesUsados >= limites.limiteClientes) problemas.push({ tipo: 'LIMITE_CLIENTES', mensagem: 'Limite de clientes atingido.' });
    if (user.role === 'CONTADOR' && user.plano === 'PARCEIRO') problemas.push({ tipo: 'PLANO_LEGADO', mensagem: 'Contador ainda usa PARCEIRO legado.' });
    if (user.role === 'CONTADOR' && vinculosContador.length === 0 && empresasProprietarias.length === 0) problemas.push({ tipo: 'CARTEIRA', mensagem: 'Contador sem empresas vinculadas ou proprietarias.' });

    return NextResponse.json({
      user,
      limites,
      empresas: {
        proprietarias: empresasProprietarias,
        custodiadas: vinculosContador.map((v) => ({
          id: v.id,
          status: v.status,
          clientePodeAcessarPortal: v.clientePodeAcessarPortal,
          nivelPortal: v.nivelPortal,
          empresa: v.empresa,
        })),
      },
      tickets,
      vendasRecentes: vendasRecentes.map((v) => ({ ...v, valor: Number(v.valor || 0) })),
      logsRecentes: logsRecentes.map((log) => ({
        id: log.id,
        level: log.level,
        module: log.module,
        action: log.action,
        message: log.message,
        details: parseDetails(log.details),
        createdAt: log.createdAt,
        statusCode: log.statusCode,
        debugHint: log.debugHint,
      })),
      problemas,
      resumo: {
        empresasProprietarias: empresasProprietarias.length,
        empresasCustodiadas: vinculosContador.length,
        ticketsAbertos: tickets.filter((t) => ['ABERTO', 'EM_ANDAMENTO'].includes(t.status)).length,
        logsErroRecentes: logsRecentes.filter((l) => ['ERRO', 'ERROR', 'CRITICAL'].includes(l.level)).length,
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: 'Erro ao montar diagnostico.', detalhes: error.message }, { status: 500 });
  }
}
