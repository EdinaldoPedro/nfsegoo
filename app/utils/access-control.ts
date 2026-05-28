import type { User } from '@prisma/client';
import { prisma } from '@/app/utils/prisma';
import { checkIsStaff } from '@/app/utils/permissions';

type AccessUser = Pick<User, 'id' | 'role' | 'empresaId'>;

export const ADMIN_ROLES = ['MASTER', 'ADMIN'];
export const SUPPORT_ROLES = ['MASTER', 'ADMIN', 'SUPORTE', 'SUPORTE_TI'];
export const SUPPORT_TICKET_ROLES = [...SUPPORT_ROLES, 'CONTADOR'];

export function isAdminRole(role: string | null | undefined) {
  return !!role && ADMIN_ROLES.includes(role);
}

export function isSupportRole(role: string | null | undefined) {
  return !!role && SUPPORT_ROLES.includes(role);
}

export function isSupportTicketRole(role: string | null | undefined) {
  return !!role && SUPPORT_TICKET_ROLES.includes(role);
}

export async function getAccessibleEmpresaIds(user: AccessUser): Promise<string[] | null> {
  if (checkIsStaff(user.role)) {
    return null;
  }

  const empresas = new Set<string>();

  if (user.empresaId) {
    empresas.add(user.empresaId);
  }

  const [empresasColaborador, vinculosContador, empresasFaturadas] = await Promise.all([
    prisma.userCliente.findMany({
      where: { userId: user.id },
      select: { empresaId: true },
    }),
    prisma.contadorVinculo.findMany({
      where: { contadorId: user.id, status: 'APROVADO', arquivadoEm: null } as any,
      select: { empresaId: true },
    }),
    prisma.empresa.findMany({
      where: { donoFaturamentoId: user.id, arquivadoEm: null } as any,
      select: { id: true },
    }),
  ]);

  empresasColaborador.forEach(({ empresaId }) => empresas.add(empresaId));
  vinculosContador.forEach(({ empresaId }) => empresas.add(empresaId));
  empresasFaturadas.forEach(({ id }) => empresas.add(id));

  return Array.from(empresas);
}

export async function hasEmpresaAccess(user: AccessUser, empresaId: string | null | undefined) {
  if (!empresaId) {
    return false;
  }

  const accessibleEmpresaIds = await getAccessibleEmpresaIds(user);
  return accessibleEmpresaIds === null || accessibleEmpresaIds.includes(empresaId);
}
