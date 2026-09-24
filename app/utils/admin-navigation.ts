import { checkIsStaff } from './permissions';
import { adminSections } from './admin-sections';

const operational = ['/admin/dashboard', '/admin/bancadas', '/admin/emissoes', '/admin/consultas-fiscais', '/admin/vendas', '/admin/empresas', '/admin/suporte', '/admin/usuarios'];
export function canAccessAdminPage(role: string | null, path: string): boolean {
  if (!role || !checkIsStaff(role)) return false;
  if (path === '/admin' || path === '/admin/minha-conta' || path.startsWith('/admin/minha-conta/')) return true;
  const hub = adminSections.find(section => section.href === path && section.views.length > 0);
  if (hub) return hub.views.some(view => canAccessAdminPage(role, view.href));
  if (role === 'ADMIN' || role === 'MASTER') return true;
  const pages = role === 'COMERCIAL' ? ['/admin/contratacoes'] : role === 'SUPORTE_TI' ? [...operational, '/admin/logs'] : operational;
  return pages.some((page) => path === page || path.startsWith(`${page}/`));
}

export function adminHome(role: string | null) {
  return role === 'COMERCIAL' ? '/admin/contratacoes' : '/admin/dashboard';
}
