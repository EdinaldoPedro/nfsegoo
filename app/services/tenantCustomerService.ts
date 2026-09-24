import { prisma } from '@/app/utils/prisma';
import type { Prisma } from '@prisma/client';
import { mergeTenantCustomer, tenantCustomerFiscalInclude } from './fiscalEntityService';

/** An old browser/draft ID can only be rebound inside the same company. */
export async function findTenantCustomer(clienteId: string, empresaId: string, db: Prisma.TransactionClient = prisma) {
  if (!clienteId || !empresaId) return null;
  const activeWhere = { empresaId, arquivadoEm: null, vinculos: { some: { empresaId, arquivadoEm: null } } };
  const direct = await db.cliente.findFirst({ where: { id: clienteId, ...activeWhere }, include: { entidadeFiscal: { include: tenantCustomerFiscalInclude } } });
  if (direct) return mergeTenantCustomer(direct);
  const mapping = await db.clienteTenantMigration.findUnique({
    where: { originalClienteId_empresaId: { originalClienteId: clienteId, empresaId } },
    select: { clienteId: true },
  });
  if (!mapping || mapping.clienteId === clienteId) return null;
  const migrated = await db.cliente.findFirst({ where: { id: mapping.clienteId, ...activeWhere }, include: { entidadeFiscal: { include: tenantCustomerFiscalInclude } } });
  return migrated ? mergeTenantCustomer(migrated) : null;
}
