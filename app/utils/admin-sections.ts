import {
  Activity, BadgeCheck, BriefcaseBusiness, Building2, CreditCard, Database,
  FileClock, FileText, Fingerprint, Headset, KeyRound, LayoutDashboard,
  List, Map, MapPin, Settings2, ShieldAlert, ShieldCheck, Ticket,
  UserCog, Users, Workflow, Wrench,
  type LucideIcon,
} from 'lucide-react';

export type AdminView = { label: string; href: string; description: string; icon: LucideIcon };
export type AdminSection = {
  id: string;
  label: string;
  href: string;
  description: string;
  icon: LucideIcon;
  views: AdminView[];
};

export const adminSections: AdminSection[] = [
  {
    id: 'overview', label: 'Visão geral', href: '/admin/dashboard', icon: LayoutDashboard,
    description: 'Indicadores e alertas da operação.', views: [],
  },
  {
    id: 'people', label: 'Pessoas e contas', href: '/admin/pessoas', icon: Users,
    description: 'Contas, equipe, relacionamento e titularidade.',
    views: [
      { label: 'Contas comuns', href: '/admin/usuarios', description: 'Clientes, acesso, empresas e planos atribuídos.', icon: UserCog },
      { label: 'Colaboradores', href: '/admin/colaboradores', description: 'Equipe interna, contadores e permissões.', icon: Users },
      { label: 'CRM e clientes', href: '/admin/crm', description: 'Relacionamento, histórico e métricas.', icon: BriefcaseBusiness },
      { label: 'Titularidade', href: '/admin/titularidade', description: 'Verificações e solicitações de titularidade.', icon: BadgeCheck },
    ],
  },
  {
    id: 'operation', label: 'Operação fiscal', href: '/admin/operacao', icon: Activity,
    description: 'Emissões, cadastros fiscais, suporte e vínculos.',
    views: [
      { label: 'Emissões', href: '/admin/emissoes', description: 'Acompanhamento, falhas e ações fiscais.', icon: Activity },
      { label: 'Consultas fiscais', href: '/admin/consultas-fiscais', description: 'Consultas e retorno dos serviços fiscais.', icon: FileText },
      { label: 'Empresas', href: '/admin/empresas', description: 'Prestadores e cadastros da operação.', icon: Building2 },
      { label: 'Tomadores', href: '/admin/tomadores', description: 'Identidades fiscais globais dos tomadores.', icon: Database },
      { label: 'CNAEs', href: '/admin/cnaes', description: 'Tabela de atividades e códigos.', icon: List },
      { label: 'Tributação municipal', href: '/admin/tributacao-municipal', description: 'Regras por município e atividade.', icon: MapPin },
      { label: 'Legado fiscal', href: '/admin/legado-fiscal', description: 'Conciliação dos registros legados.', icon: FileClock },
      { label: 'Suporte', href: '/admin/suporte', description: 'Chamados e atendimento interno.', icon: Headset },
      { label: 'Vínculos', href: '/admin/vinculos-custodia', description: 'Custódia e vínculos entre contas e empresas.', icon: Workflow },
    ],
  },
  {
    id: 'commercial', label: 'Comercial', href: '/admin/comercial', icon: CreditCard,
    description: 'Contratações, catálogo e campanhas.',
    views: [
      { label: 'Contratações', href: '/admin/contratacoes', description: 'Pedidos e conferência de pagamentos.', icon: CreditCard },
      { label: 'Planos e pacotes', href: '/admin/planos', description: 'Catálogo, limites e ofertas.', icon: BriefcaseBusiness },
      { label: 'Cupons e parceiros', href: '/admin/cupons', description: 'Campanhas e parcerias.', icon: Ticket },
    ],
  },
  {
    id: 'system', label: 'Sistema', href: '/admin/sistema', icon: Settings2,
    description: 'Parâmetros, tabelas, cobertura e diagnóstico.',
    views: [
      { label: 'Configurações', href: '/admin/configuracoes', description: 'Parâmetros fiscais, e-mail, avisos e manutenção.', icon: Settings2 },
      { label: 'Cobertura', href: '/admin/cobertura', description: 'Municípios atendidos e pendências.', icon: Map },
      { label: 'Logs', href: '/admin/logs', description: 'Eventos técnicos e investigação.', icon: Wrench },
    ],
  },
  {
    id: 'governance', label: 'Segurança e privacidade', href: '/admin/governanca', icon: ShieldCheck,
    description: 'Incidentes do sistema e direitos dos titulares.',
    views: [
      { label: 'Incidentes', href: '/admin/seguranca/incidentes', description: 'Registro e acompanhamento de incidentes.', icon: ShieldAlert },
      { label: 'Direitos dos titulares', href: '/admin/privacidade', description: 'Solicitações relativas a dados pessoais.', icon: Fingerprint },
    ],
  },
];

export const adminAccountViews: AdminView[] = [
  { label: 'Dados e senha', href: '/admin/minha-conta/dados', description: 'Perfil, e-mail e senha da sua conta.', icon: UserCog },
  { label: 'Autenticação e sessões', href: '/admin/minha-conta/seguranca', description: 'Autenticador, dispositivos e sessões ativas.', icon: KeyRound },
];

export function sectionForAdminPath(path: string) {
  if (path.startsWith('/admin/vendas/')) return adminSections.find(section => section.id === 'operation');
  return adminSections.find(section => section.href === path || section.views.some(view => path === view.href || path.startsWith(`${view.href}/`)));
}

export function viewForAdminPath(section: AdminSection, path: string) {
  if (path.startsWith('/admin/vendas/')) return section.views.find(view => view.href === '/admin/emissoes');
  return section.views.find(view => path === view.href || path.startsWith(`${view.href}/`));
}
