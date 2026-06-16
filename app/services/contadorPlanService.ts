import { prisma } from '@/app/utils/prisma';

const BASE_PLAN_TYPES = new Set(['PLANO', 'CUSTOM']);

export const DEFAULT_CONTADOR_PLAN_SLUG = 'CONTADOR_STARTER';

export function getContadorCustomPlanSlug(userId: string) {
  return `parceiro-contabil-${userId}`;
}

function addDays(date: Date, days: number) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function addYears(date: Date, years: number) {
  const result = new Date(date);
  result.setFullYear(result.getFullYear() + years);
  return result;
}

async function finalizarPlanosBaseAtivos(userId: string, exceptPlanId?: string) {
  const historicosAtivos = await prisma.planHistory.findMany({
    where: { userId, status: 'ATIVO' },
    include: { plan: true },
  });

  await Promise.all(
    historicosAtivos
      .filter((hist) => hist.plan && BASE_PLAN_TYPES.has(hist.plan.tipo) && hist.planId !== exceptPlanId)
      .map((hist) =>
        prisma.planHistory.update({
          where: { id: hist.id },
          data: { status: 'FINALIZADO', dataFim: new Date() },
        }),
      ),
  );
}

export async function ensureContadorStarterPlan() {
  return prisma.plan.upsert({
    where: { slug: DEFAULT_CONTADOR_PLAN_SLUG },
    update: {
      name: 'Contador Starter',
      description: 'Plano privado inicial para contadores parceiros.',
      priceMonthly: 0,
      priceYearly: 0,
      features: JSON.stringify(['Painel do contador', 'Carteira de clientes', 'Empresas vinculadas', 'Suporte administrativo']),
      maxNotasMensal: 60,
      maxClientes: 25,
      diasTeste: 0,
      active: true,
      recommended: false,
      privado: true,
      tipo: 'PLANO',
    },
    create: {
      name: 'Contador Starter',
      slug: DEFAULT_CONTADOR_PLAN_SLUG,
      description: 'Plano privado inicial para contadores parceiros.',
      priceMonthly: 0,
      priceYearly: 0,
      features: JSON.stringify(['Painel do contador', 'Carteira de clientes', 'Empresas vinculadas', 'Suporte administrativo']),
      maxNotasMensal: 60,
      maxClientes: 25,
      diasTeste: 0,
      active: true,
      recommended: false,
      privado: true,
      tipo: 'PLANO',
    },
  });
}

export async function ativarPlanoContadorPadrao(userId: string, ciclo = 'ANUAL') {
  const plano = await ensureContadorStarterPlan();
  const dataFim = ciclo === 'MENSAL' ? addDays(new Date(), 30) : addYears(new Date(), 1);

  await finalizarPlanosBaseAtivos(userId, plano.id);

  const historicoAtual = await prisma.planHistory.findFirst({
    where: { userId, planId: plano.id, status: 'ATIVO' },
  });

  if (historicoAtual) {
    await prisma.planHistory.update({
      where: { id: historicoAtual.id },
      data: { dataFim },
    });
  } else {
    await prisma.planHistory.create({
      data: {
        userId,
        planId: plano.id,
        status: 'ATIVO',
        dataInicio: new Date(),
        dataFim,
        notasEmitidas: 0,
      },
    });
  }

  await prisma.user.update({
    where: { id: userId },
    data: {
      plano: plano.slug,
      planoStatus: 'active',
      planoCiclo: ciclo,
      planoExpiresAt: dataFim,
    },
  });

  return { plano, dataFim };
}

export async function aplicarPlanoContadorCustom({
  userId,
  limiteNotas,
  limiteClientes,
  assinaturaAtiva = true,
  renovacaoAutomatica = false,
}: {
  userId: string;
  limiteNotas?: number;
  limiteClientes?: number;
  assinaturaAtiva?: boolean;
  renovacaoAutomatica?: boolean;
}) {
  const slug = getContadorCustomPlanSlug(userId);
  const planoAtual = await prisma.plan.findUnique({ where: { slug } });
  const maxNotasMensal = Number.isFinite(limiteNotas) ? Number(limiteNotas) : planoAtual?.maxNotasMensal ?? 60;
  const maxClientes = Number.isFinite(limiteClientes) ? Number(limiteClientes) : planoAtual?.maxClientes ?? 25;
  const dataFim = renovacaoAutomatica ? addYears(new Date(), 10) : addDays(new Date(), 30);
  const status = assinaturaAtiva ? 'ATIVO' : 'CANCELADO';

  const plano = await prisma.plan.upsert({
    where: { slug },
    update: {
      maxNotasMensal,
      maxClientes,
      active: false,
      privado: true,
      tipo: 'CUSTOM',
    },
    create: {
      name: 'Parceiro Contabil Custom',
      slug,
      description: 'Plano individual configurado pelo administrativo para contador parceiro.',
      priceMonthly: 0,
      priceYearly: 0,
      features: JSON.stringify(['Limites personalizados', 'Carteira de clientes', 'Empresas vinculadas']),
      maxNotasMensal,
      maxClientes,
      diasTeste: 0,
      active: false,
      recommended: false,
      privado: true,
      tipo: 'CUSTOM',
    },
  });

  await finalizarPlanosBaseAtivos(userId, plano.id);

  const historicoAtual = await prisma.planHistory.findFirst({
    where: { userId, planId: plano.id, status: 'ATIVO' },
  });

  if (historicoAtual) {
    await prisma.planHistory.update({
      where: { id: historicoAtual.id },
      data: {
        status,
        dataFim: assinaturaAtiva ? dataFim : new Date(),
      },
    });
  } else {
    await prisma.planHistory.create({
      data: {
        userId,
        planId: plano.id,
        status,
        dataInicio: new Date(),
        dataFim: assinaturaAtiva ? dataFim : new Date(),
        notasEmitidas: 0,
      },
    });
  }

  await prisma.user.update({
    where: { id: userId },
    data: {
      plano: plano.slug,
      planoStatus: assinaturaAtiva ? 'active' : 'canceled',
      planoCiclo: 'ANUAL',
      planoExpiresAt: assinaturaAtiva ? dataFim : new Date(),
    },
  });

  return { plano, dataFim, assinaturaAtiva };
}
