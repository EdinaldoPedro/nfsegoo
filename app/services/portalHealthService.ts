import { prisma } from '@/app/utils/prisma';

export type PortalHealthStatus = 'OPERACIONAL' | 'OSCILANDO' | 'INDISPONIVEL' | 'RECUPERANDO';

function diagnosticFromDetails(details: string | null) {
  if (!details) return null;
  try {
    const parsed = JSON.parse(details);
    return parsed?.portalDiagnostic || null;
  } catch {
    return null;
  }
}

export async function portalHealth(now = new Date()) {
  const recentSince = new Date(now.getTime() - 5 * 60_000);
  const recoverySince = new Date(now.getTime() - 15 * 60_000);
  const logs = await prisma.systemLog.findMany({
    where: {
      createdAt: { gte: recoverySince },
      action: { in: ['EMISSION_ERRO_TEMPORARIO', 'EMISSION_AUTHORIZED'] },
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
    select: { action: true, empresaId: true, createdAt: true, details: true },
  });

  const allConfirmed = logs.filter((log) => {
    const diagnostic = diagnosticFromDetails(log.details);
    return diagnostic?.category === 'PORTAL_INSTABILITY'
      && diagnostic?.doubleChecked === true;
  });
  const confirmed = allConfirmed.filter((log) => log.createdAt >= recentSince);
  const affectedCompanies = new Set(confirmed.map((log) => log.empresaId).filter(Boolean));
  const latestInstability = allConfirmed[0];
  const recentAuthorization = logs.find((log) => log.action === 'EMISSION_AUTHORIZED'
    && (!latestInstability || log.createdAt > latestInstability.createdAt));

  let status: PortalHealthStatus = 'OPERACIONAL';
  if (confirmed.length >= 3 && affectedCompanies.size >= 2) status = 'INDISPONIVEL';
  else if (confirmed.length > 0) status = 'OSCILANDO';
  else if (latestInstability && recentAuthorization) status = 'RECUPERANDO';
  else if (latestInstability) status = 'OSCILANDO';

  return {
    status,
    confirmedFailures: confirmed.length,
    affectedCompanies: affectedCompanies.size,
    lastConfirmedFailureAt: confirmed[0]?.createdAt || null,
    lastAuthorizationAt: recentAuthorization?.createdAt || null,
    source: 'DOUBLE_CHECKED_FISCAL_GETS',
  };
}
