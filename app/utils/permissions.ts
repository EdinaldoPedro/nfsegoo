// Cargos internos que tem acesso ao Painel Admin.
// CONTADOR e um perfil operacional/parceiro, nao equipe interna do SaaS.
export const STAFF_ROLES = ['MASTER', 'ADMIN', 'SUPORTE', 'SUPORTE_TI'];

export const checkIsStaff = (role: string | null) => {
  if (!role) return false;
  return STAFF_ROLES.includes(role);
};

export const ROLE_LABELS: Record<string, string> = {
  MASTER: 'Master',
  ADMIN: 'Administrador',
  SUPORTE: 'Suporte',
  SUPORTE_TI: 'Suporte T.I.',
  CONTADOR: 'Contador',
  COMUM: 'Cliente',
};
