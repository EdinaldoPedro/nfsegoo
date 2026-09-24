import type { User, Prisma } from '@prisma/client';
import { prisma } from '@/app/utils/prisma';

type AccessUser = Pick<User, 'id' | 'role' | 'empresaId'>;

export const ADMIN_ROLES = ['MASTER', 'ADMIN'];
export const SUPPORT_ROLES = ['MASTER', 'ADMIN', 'SUPORTE', 'SUPORTE_TI'];
export const SUPPORT_TICKET_ROLES = [...SUPPORT_ROLES];
export const COMMERCIAL_ROLES = ['MASTER', 'ADMIN', 'COMERCIAL'];
export const INTERNAL_CUSTOMER_GRANT_ROLES = ['SUPORTE', 'SUPORTE_TI', 'COMERCIAL'];

export function internalCustomerGrantActive(user: { role: string; customerPortalGrantedAt?: Date | null; customerPortalRevokedAt?: Date | null }) {
  if (user.role === 'ADMIN' || user.role === 'MASTER') return true;
  return INTERNAL_CUSTOMER_GRANT_ROLES.includes(user.role) && Boolean(user.customerPortalGrantedAt) && !user.customerPortalRevokedAt;
}

export async function hasInternalCustomerAccess(userId: string, db: Prisma.TransactionClient = prisma) {
  const user = await db.user.findUnique({ where: { id: userId }, select: {
    role: true, customerPortalGrantedAt: true, customerPortalRevokedAt: true,
  } });
  return Boolean(user && internalCustomerGrantActive(user));
}

export function isCommercialRole(role: string | null | undefined) {
  return !!role && COMMERCIAL_ROLES.includes(role);
}

export function isAdminRole(role: string | null | undefined) {
  return !!role && ADMIN_ROLES.includes(role);
}

export function isSupportRole(role: string | null | undefined) {
  return !!role && SUPPORT_ROLES.includes(role);
}

export function isSupportTicketRole(role: string | null | undefined) {
  return !!role && SUPPORT_TICKET_ROLES.includes(role);
}

export function isCustomerRole(role: string | null | undefined) {
  return role === 'COMUM' || role === 'CONTADOR';
}

/** Capability used inside the customer portal. Internal roles receive no
 * tenant-wide privilege here: they can operate only a company they directly
 * own (primary account company or explicit proprietary owner). */
export async function hasCustomerCompanyAccess(
  user: AccessUser,
  empresaId: string | null | undefined,
  db: Prisma.TransactionClient = prisma,
) {
  if (!empresaId) return false;
  if (isCustomerRole(user.role)) return hasEmpresaAccess(user, empresaId, db);
  if (!checkKnownInternalRole(user.role)) return false;
  if (!await hasInternalCustomerAccess(user.id, db)) return false;
  return Boolean(await db.empresa.findFirst({ where: {
    id: empresaId, arquivadoEm: null,
    OR: [{ proprietarioUserId: user.id }, ...(user.empresaId === empresaId ? [{ id: empresaId }] : [])],
  }, select: { id: true } }));
}

/** Account-level customer capability for enrollment and subscription flows.
 * The explicit grant permits an internal user to register their first PJ;
 * individual company access still requires direct ownership. */
export async function hasCustomerAccountCapability(
  user: AccessUser,
  db: Prisma.TransactionClient = prisma,
) {
  if (isCustomerRole(user.role)) return true;
  if (!checkKnownInternalRole(user.role)) return false;
  return hasInternalCustomerAccess(user.id, db);
}

function checkKnownInternalRole(role: string | null | undefined) {
  return !!role && [...SUPPORT_ROLES, ...COMMERCIAL_ROLES].includes(role);
}

export async function getAccessibleEmpresaIds(user: AccessUser, db: Prisma.TransactionClient = prisma): Promise<string[] | null> {
  if (INTERNAL_CUSTOMER_GRANT_ROLES.includes(user.role)) {
    if (!await hasInternalCustomerAccess(user.id, db)) return [];
    const owned = await db.empresa.findMany({ where: { arquivadoEm: null,
      OR: [{ proprietarioUserId: user.id }, ...(user.empresaId ? [{ id: user.empresaId }] : [])] }, select: { id: true } });
    return owned.map(({ id }) => id);
  }
  const empresas = new Set<string>();

  if (user.empresaId) {
    empresas.add(user.empresaId);
  }

  const [empresasColaborador, vinculosContador, empresasProprietarias] = await Promise.all([
    db.userCliente.findMany({
      where: { userId: user.id, revokedAt: null },
      select: { empresaId: true },
    }),
    db.contadorVinculo.findMany({
      where: { contadorId: user.id, status: 'APROVADO', arquivadoEm: null } as any,
      select: { empresaId: true },
    }),
    db.empresa.findMany({
      where: { proprietarioUserId: user.id, arquivadoEm: null } as any,
      select: { id: true },
    })
  ]);

  empresasColaborador.forEach(({ empresaId }) => empresas.add(empresaId));
  vinculosContador.forEach(({ empresaId }) => empresas.add(empresaId));
  empresasProprietarias.forEach(({ id }) => empresas.add(id));

  const activeCompanies = await db.empresa.findMany({
    where: { id: { in: Array.from(empresas) }, arquivadoEm: null },
    select: { id: true },
  });
  return activeCompanies.map(({ id }) => id);
}

export async function hasEmpresaAccess(user: AccessUser, empresaId: string | null | undefined, db: Prisma.TransactionClient = prisma) {
  if (!empresaId) {
    return false;
  }

  const accessibleEmpresaIds = await getAccessibleEmpresaIds(user, db);
  return accessibleEmpresaIds === null || accessibleEmpresaIds.includes(empresaId);
}

export async function resolveEmpresaContexto(
  user: AccessUser,
  contextId: string | null | undefined,
  db: Prisma.TransactionClient = prisma,
): Promise<string | null> {
  const requestedEmpresaId =
    contextId && contextId !== 'null' && contextId !== 'undefined'
      ? contextId
      : user.empresaId;

  if (!requestedEmpresaId) {
    return null;
  }

  const allowed = await hasCustomerCompanyAccess(user, requestedEmpresaId, db);
  return allowed ? requestedEmpresaId : null;
}
