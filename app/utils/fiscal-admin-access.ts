const FISCAL_CATALOG_READ_ROLES = new Set(['MASTER', 'ADMIN']);
const FISCAL_CATALOG_WRITE_ROLES = new Set(['MASTER', 'ADMIN']);

export function canReadFiscalCatalog(role: string | null | undefined) {
  return typeof role === 'string' && FISCAL_CATALOG_READ_ROLES.has(role);
}

export function canWriteFiscalCatalog(role: string | null | undefined) {
  return typeof role === 'string' && FISCAL_CATALOG_WRITE_ROLES.has(role);
}
