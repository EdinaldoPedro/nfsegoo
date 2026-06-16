import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export type TipoAcao = 'EMITIR' | 'VISUALIZAR' | 'CADASTRAR_CLIENTE';

export type EffectivePlanLimits = {
  allowedBase: boolean;
  status: 'ATIVO' | 'EXPIRADO' | 'INATIVO' | 'LIMITE_ATINGIDO';
  reason?: string;
  historyIdDisponivel?: string;
  planoBase?: {
    id: string;
    nome: string;
    slug: string;
    tipo: string;
    dataInicio: Date;
    dataFim: Date | null;
    diasTeste: number;
  };
  limiteNotas: number;
  notasUsadas: number;
  limiteClientes: number;
  clientesUsados: number;
  limiteEmpresas: number;
  empresasUsadas: number;
  empresasAdicionais: number;
  origem: 'ADMIN' | 'PLANO' | 'CUSTOM' | 'PACOTE' | 'SEM_PLANO';
};

function inicioDoMes(data = new Date()) {
  return new Date(data.getFullYear(), data.getMonth(), 1);
}

function isBasePlanType(tipo?: string | null) {
  return tipo === 'PLANO' || tipo === 'CUSTOM';
}

export async function renovarUsoMensalSeNecessario(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { dataRenovacaoCiclo: true, empresaId: true },
  });

  if (!user) return;

  const mesAtual = inicioDoMes();
  const ultimaRenovacao = user.dataRenovacaoCiclo ? inicioDoMes(user.dataRenovacaoCiclo) : null;

  if (ultimaRenovacao && ultimaRenovacao >= mesAtual) return;

  const historicosAtivos = await prisma.planHistory.findMany({
    where: { userId, status: 'ATIVO' },
    include: { plan: true },
    orderBy: { createdAt: 'asc' },
  });

  const notasAutorizadasMes = await prisma.notaFiscal.count({
    where: {
      status: 'AUTORIZADA',
      arquivadoEm: null,
      createdAt: { gte: mesAtual },
      empresa: {
        OR: [
          { donoFaturamentoId: userId },
          { proprietarioUserId: userId } as any,
          { id: user.empresaId || '' },
          { contadoresLink: { some: { contadorId: userId, status: 'APROVADO', arquivadoEm: null } } },
        ],
      },
    } as any,
  });

  let restante = notasAutorizadasMes;
  const updates = historicosAtivos.map((hist) => {
    const limite = hist.plan.maxNotasMensal || 0;
    const uso = limite > 0 ? Math.min(restante, limite) : 0;
    restante = Math.max(0, restante - uso);

    return prisma.planHistory.update({
      where: { id: hist.id },
      data: { notasEmitidas: uso },
    });
  });

  await prisma.$transaction([
    ...updates,
    prisma.user.update({
      where: { id: userId },
      data: { dataRenovacaoCiclo: mesAtual },
    }),
  ]);
}

export async function resolveBillingUserId(params: {
  empresaId: string;
  actorUserId: string;
  acao?: TipoAcao;
}) {
  const { empresaId, actorUserId } = params;

  const [empresa, actor] = await Promise.all([
    prisma.empresa.findUnique({
      where: { id: empresaId },
      select: {
        id: true,
        donoFaturamentoId: true,
        proprietarioUserId: true,
        modoCobranca: true,
        contadorCustodianteId: true,
      } as any,
    }),
    prisma.user.findUnique({
      where: { id: actorUserId },
      select: { id: true, role: true },
    }),
  ]);

  if (!empresa) {
    throw new Error('Empresa nao encontrada para resolver cobranca.');
  }

  if ((empresa as any).modoCobranca === 'POR_OPERADOR') return actorUserId;
  if ((empresa as any).donoFaturamentoId) return (empresa as any).donoFaturamentoId as string;
  if ((empresa as any).proprietarioUserId) return (empresa as any).proprietarioUserId as string;

  const donoEmpresa = await prisma.user.findFirst({
    where: { empresaId, role: { notIn: ['CONTADOR', 'SUPORTE', 'SUPORTE_TI'] } },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });

  if (donoEmpresa) return donoEmpresa.id;
  if ((empresa as any).contadorCustodianteId) return (empresa as any).contadorCustodianteId as string;
  if (actor?.role === 'CONTADOR') return actorUserId;

  return actorUserId;
}

export async function getEffectivePlanLimits(userId: string): Promise<EffectivePlanLimits> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      role: true,
      empresaId: true,
      limiteEmpresas: true,
      empresasAdicionais: true,
    },
  });

  if (!user) {
    return {
      allowedBase: false,
      status: 'INATIVO',
      reason: 'Usuario nao encontrado.',
      limiteNotas: 0,
      notasUsadas: 0,
      limiteClientes: 0,
      clientesUsados: 0,
      limiteEmpresas: 0,
      empresasUsadas: 0,
      empresasAdicionais: 0,
      origem: 'SEM_PLANO',
    };
  }

  if (['MASTER', 'ADMIN', 'SUPORTE', 'SUPORTE_TI'].includes(user.role)) {
    return {
      allowedBase: true,
      status: 'ATIVO',
      historyIdDisponivel: 'ADMIN_BYPASS',
      limiteNotas: 99999,
      notasUsadas: 0,
      limiteClientes: 99999,
      clientesUsados: 0,
      limiteEmpresas: 99999,
      empresasUsadas: 0,
      empresasAdicionais: 0,
      origem: 'ADMIN',
    };
  }

  await renovarUsoMensalSeNecessario(userId);

  const historicosAtivos = await prisma.planHistory.findMany({
    where: { userId, status: 'ATIVO' },
    include: { plan: true },
    orderBy: { createdAt: 'asc' },
  });

  const historicosValidos = [];
  let hasBasePlanExpired = false;

  for (const hist of historicosAtivos) {
    if (hist.dataFim && new Date() > hist.dataFim) {
      await prisma.planHistory.update({
        where: { id: hist.id },
        data: { status: 'EXPIRADO' },
      });

      if (isBasePlanType(hist.plan.tipo)) hasBasePlanExpired = true;
    } else {
      historicosValidos.push(hist);
    }
  }

  if (hasBasePlanExpired) {
    await prisma.user.update({
      where: { id: userId },
      data: { planoStatus: 'expired' },
    });
  }

  const limiteEmpresas = (user.limiteEmpresas || 0) + (user.empresasAdicionais || 0);

  if (historicosValidos.length === 0) {
    const expirado = await prisma.planHistory.findFirst({
      where: { userId, status: 'EXPIRADO' },
      orderBy: { createdAt: 'desc' },
    });

    return {
      allowedBase: false,
      status: expirado ? 'EXPIRADO' : 'INATIVO',
      reason: expirado
        ? 'Seu plano expirou. Renove sua assinatura para acessar o sistema.'
        : 'Nenhum plano ou pacote ativo. Escolha um plano para comecar.',
      limiteNotas: 0,
      notasUsadas: 0,
      limiteClientes: 0,
      clientesUsados: 0,
      limiteEmpresas,
      empresasUsadas: 0,
      empresasAdicionais: user.empresasAdicionais || 0,
      origem: 'SEM_PLANO',
    };
  }

  let limiteNotas = 0;
  let notasUsadas = 0;
  let limiteClientes = 0;
  let historyIdDisponivel = historicosValidos[0].id;
  let encontrouEspaco = false;

  for (const hist of historicosValidos) {
    const limiteHist = hist.plan.maxNotasMensal || 0;
    limiteNotas += limiteHist;
    notasUsadas += hist.notasEmitidas || 0;
    limiteClientes += hist.plan.maxClientes || 0;

    if (!encontrouEspaco && limiteHist > 0 && hist.notasEmitidas < limiteHist) {
      historyIdDisponivel = hist.id;
      encontrouEspaco = true;
    }
  }

  const [clientesUsados, empresasUsadas] = await Promise.all([
    prisma.vinculoCarteira.count({
      where: {
        arquivadoEm: null,
        empresa: {
          OR: [
            { donoFaturamentoId: userId },
            { proprietarioUserId: userId } as any,
            { id: user.empresaId || '' },
          ],
        },
      },
    }),
    prisma.empresa.count({
      where: {
        arquivadoEm: null,
        OR: [
          { donoFaturamentoId: userId },
          { proprietarioUserId: userId } as any,
          { id: user.empresaId || '' },
          { contadoresLink: { some: { contadorId: userId, status: 'APROVADO', arquivadoEm: null } } } as any,
        ],
      } as any,
    }),
  ]);

  const planoBase = historicosValidos.find((h) => isBasePlanType(h.plan.tipo)) || historicosValidos[0];
  const origem = planoBase.plan.tipo === 'CUSTOM' ? 'CUSTOM' : planoBase.plan.tipo === 'PLANO' ? 'PLANO' : 'PACOTE';

  return {
    allowedBase: true,
    status: 'ATIVO',
    historyIdDisponivel,
    planoBase: {
      id: planoBase.plan.id,
      nome: planoBase.plan.name,
      slug: planoBase.plan.slug,
      tipo: planoBase.plan.tipo,
      dataInicio: planoBase.dataInicio,
      dataFim: planoBase.dataFim,
      diasTeste: planoBase.plan.diasTeste || 0,
    },
    limiteNotas,
    notasUsadas,
    limiteClientes,
    clientesUsados,
    limiteEmpresas,
    empresasUsadas,
    empresasAdicionais: user.empresasAdicionais || 0,
    origem,
  };
}

export async function checkPlanLimits(userId: string, acao: TipoAcao = 'EMITIR') {
  const limits = await getEffectivePlanLimits(userId);

  if (!limits.allowedBase) {
    return {
      allowed: false,
      reason: limits.reason,
      status: limits.status,
      limiteNotas: limits.limiteNotas,
      notasUsadas: limits.notasUsadas,
      limiteClientes: limits.limiteClientes,
      clientesUsados: limits.clientesUsados,
      limiteEmpresas: limits.limiteEmpresas,
      empresasUsadas: limits.empresasUsadas,
    };
  }

  if (acao === 'EMITIR' && limits.limiteNotas > 0 && limits.notasUsadas >= limits.limiteNotas) {
    return {
      allowed: false,
      reason: `Voce atingiu o limite de ${limits.limiteNotas} emissoes mensais. Faca um upgrade ou compre um pacote extra de notas.`,
      status: 'LIMITE_ATINGIDO',
      limiteNotas: limits.limiteNotas,
      notasUsadas: limits.notasUsadas,
      limiteClientes: limits.limiteClientes,
      clientesUsados: limits.clientesUsados,
      limiteEmpresas: limits.limiteEmpresas,
      empresasUsadas: limits.empresasUsadas,
    };
  }

  if (acao === 'CADASTRAR_CLIENTE' && limits.limiteClientes > 0 && limits.clientesUsados >= limits.limiteClientes) {
    return {
      allowed: false,
      reason: `Voce atingiu o limite de ${limits.limiteClientes} clientes cadastrados na sua carteira.`,
      status: 'LIMITE_ATINGIDO',
      limiteNotas: limits.limiteNotas,
      notasUsadas: limits.notasUsadas,
      limiteClientes: limits.limiteClientes,
      clientesUsados: limits.clientesUsados,
      limiteEmpresas: limits.limiteEmpresas,
      empresasUsadas: limits.empresasUsadas,
    };
  }

  return {
    allowed: true,
    historyId: limits.historyIdDisponivel || 'ADMIN_BYPASS',
    status: limits.status,
    limiteNotas: limits.limiteNotas,
    notasUsadas: limits.notasUsadas,
    limiteClientes: limits.limiteClientes,
    clientesUsados: limits.clientesUsados,
    limiteEmpresas: limits.limiteEmpresas,
    empresasUsadas: limits.empresasUsadas,
  };
}

export async function incrementUsage(historyId: string) {
  if (historyId === 'ADMIN_BYPASS') return;
  await prisma.planHistory.update({
    where: { id: historyId },
    data: { notasEmitidas: { increment: 1 } },
  });
}

export async function reserveEmissionCredit(userId: string) {
  const limits = await getEffectivePlanLimits(userId);

  if (!limits.allowedBase) {
    return {
      allowed: false,
      reason: limits.reason,
      status: limits.status,
      limiteNotas: limits.limiteNotas,
      notasUsadas: limits.notasUsadas,
      historyId: null as string | null,
      reserved: false,
    };
  }

  if (limits.historyIdDisponivel === 'ADMIN_BYPASS') {
    return {
      allowed: true,
      status: limits.status,
      limiteNotas: limits.limiteNotas,
      notasUsadas: limits.notasUsadas,
      historyId: 'ADMIN_BYPASS',
      reserved: false,
    };
  }

  if (limits.limiteNotas <= 0) {
    return {
      allowed: true,
      status: limits.status,
      limiteNotas: limits.limiteNotas,
      notasUsadas: limits.notasUsadas,
      historyId: limits.historyIdDisponivel || null,
      reserved: false,
    };
  }

  const historicosAtivos = await prisma.planHistory.findMany({
    where: { userId, status: 'ATIVO' },
    include: { plan: true },
    orderBy: { createdAt: 'asc' },
  });

  for (const hist of historicosAtivos) {
    if (hist.dataFim && new Date() > hist.dataFim) continue;

    const limite = hist.plan.maxNotasMensal || 0;
    if (limite <= 0) continue;

    const reservado = await prisma.planHistory.updateMany({
      where: {
        id: hist.id,
        status: 'ATIVO',
        notasEmitidas: { lt: limite },
      },
      data: { notasEmitidas: { increment: 1 } },
    });

    if (reservado.count === 1) {
      return {
        allowed: true,
        status: 'ATIVO',
        limiteNotas: limits.limiteNotas,
        notasUsadas: limits.notasUsadas + 1,
        historyId: hist.id,
        reserved: true,
      };
    }
  }

  return {
    allowed: false,
    reason: `Voce atingiu o limite de ${limits.limiteNotas} emissoes mensais. Faca um upgrade ou compre um pacote extra de notas.`,
    status: 'LIMITE_ATINGIDO',
    limiteNotas: limits.limiteNotas,
    notasUsadas: limits.notasUsadas,
    historyId: null as string | null,
    reserved: false,
  };
}

export async function releaseEmissionCredit(historyId?: string | null) {
  if (!historyId || historyId === 'ADMIN_BYPASS') return;

  await prisma.planHistory.updateMany({
    where: {
      id: historyId,
      notasEmitidas: { gt: 0 },
    },
    data: { notasEmitidas: { decrement: 1 } },
  });
}
