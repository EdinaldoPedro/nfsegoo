'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { 
  LayoutDashboard, Users, Building, Shield, Activity, 
  LogOut, MapPin, List, LifeBuoy, CreditCard, Settings, Map, Briefcase, Ticket,
  ClipboardList, Wrench
} from 'lucide-react';
import Link from 'next/link';
import { checkIsStaff } from '@/app/utils/permissions';

export const dynamic = 'force-dynamic';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [authorized, setAuthorized] = useState(false);

  useEffect(() => {
    let active = true;

    const validateAccess = async () => {
      try {
        const res = await fetch('/api/perfil', { cache: 'no-store' });
        if (!res.ok) {
          router.push('/login');
          return;
        }

        const data = await res.json();
        if (!checkIsStaff(data.role)) {
          router.push('/login');
          return;
        }

        localStorage.setItem('userRole', data.role);
        if (data.id || data.userId) {
          localStorage.setItem('userId', data.id || data.userId);
        }

        if (active) {
          setAuthorized(true);
        }
      } catch {
        router.push('/login');
      }
    };

    validateAccess();

    return () => {
      active = false;
    };
  }, [router]);

  if (!authorized) return null;

  const menuItems = [
    { icon: LayoutDashboard, label: 'Dashboard', href: '/admin/dashboard' },
    
    // === MÓDULO DE CRM E NEGÓCIOS ===
    { icon: Briefcase, label: 'CRM / Clientes', href: '/admin/crm' }, 
    
    // Gestão do Negócio
    { icon: CreditCard, label: 'Planos e Pacotes', href: '/admin/planos' },
    { icon: Ticket, label: 'Cupons & Parceiros', href: '/admin/cupons' }, // <--- AQUI ESTÁ A NOVA ABA
    { icon: Activity, label: 'Central de Emissões', href: '/admin/emissoes' }, 
    
    // Sistema (Antigo "Usuários")
    { icon: Users, label: 'Configurar Contas', href: '/admin/usuarios' },
    { icon: Shield, label: 'Bancada de Vinculos', href: '/admin/vinculos-custodia' },
    
    // Cadastros Técnicos
    { icon: Building, label: 'Base de Empresas', href: '/admin/empresas' }, 
    { icon: List, label: 'Tabela CNAEs', href: '/admin/cnaes' },
    { icon: MapPin, label: 'Trib. Municipal', href: '/admin/tributacao-municipal' },
    { icon: Map, label: 'Mapa de Cobertura', href: '/admin/cobertura' },
    
    // Suporte
    { icon: LifeBuoy, label: 'Helpdesk / Suporte', href: '/admin/suporte' },

    // Time
    { icon: Shield, label: 'Colaboradores', href: '/admin/colaboradores' }, 

    // Configurações
    { icon: Settings, label: 'Configurações', href: '/admin/configuracoes' },
  ];

  const menuSections = [
    {
      title: 'Visão Geral',
      items: [
        { icon: LayoutDashboard, label: 'Dashboard', href: '/admin/dashboard' },
        { icon: ClipboardList, label: 'Bancadas', href: '/admin/bancadas' },
      ],
    },
    {
      title: 'Bancada Operacional',
      items: [
        { icon: Activity, label: 'Central de Emissões', href: '/admin/emissoes' },
        { icon: Building, label: 'Base de Empresas', href: '/admin/empresas' },
        { icon: LifeBuoy, label: 'Helpdesk / Suporte', href: '/admin/suporte' },
        { icon: Shield, label: 'Bancada de Vínculos', href: '/admin/vinculos-custodia' },
      ],
    },
    {
      title: 'Bancada Técnica',
      items: [
        { icon: Wrench, label: 'Logs do Sistema', href: '/admin/logs' },
        { icon: List, label: 'Tabela CNAEs', href: '/admin/cnaes' },
        { icon: MapPin, label: 'Trib. Municipal', href: '/admin/tributacao-municipal' },
        { icon: Map, label: 'Mapa de Cobertura', href: '/admin/cobertura' },
        { icon: Settings, label: 'Configurações', href: '/admin/configuracoes' },
      ],
    },
    {
      title: 'Gestão do SaaS',
      items: [
        { icon: Briefcase, label: 'CRM / Clientes', href: '/admin/crm' },
        { icon: CreditCard, label: 'Planos e Pacotes', href: '/admin/planos' },
        { icon: Ticket, label: 'Cupons & Parceiros', href: '/admin/cupons' },
        { icon: Users, label: 'Configurar Contas', href: '/admin/usuarios' },
        { icon: Shield, label: 'Colaboradores', href: '/admin/colaboradores' },
      ],
    },
  ];

  const handleLogout = async () => {
    try {
        await fetch('/api/auth/logout', { method: 'POST' });
        // Limpa qualquer resquício antigo
        localStorage.clear(); 
        sessionStorage.clear();
        // Redireciona para o login
        router.push('/');
    } catch (error) {
        console.error("Erro ao terminar sessão", error);
    }
};

  return (
    <div className="min-h-screen bg-slate-100 flex">
        <aside className="w-64 bg-slate-900 text-white flex flex-col fixed h-full shadow-xl z-20">
            <div className="p-6 border-b border-slate-800 flex items-center gap-3">
                <div className="bg-blue-600 p-2 rounded-lg">
                    <Shield size={24} className="text-white" />
                </div>
                <div>
                    <h1 className="font-bold text-lg tracking-tight">Admin</h1>
                    <p className="text-xs text-slate-400">Master Access</p>
                </div>
            </div>

            <nav className="flex-1 p-4 space-y-5 overflow-y-auto custom-scrollbar">
                {menuSections.map((section) => (
                    <div key={section.title}>
                        <p className="px-3 mb-2 text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
                            {section.title}
                        </p>
                        <div className="space-y-1.5">
                            {section.items.map((item) => (
                                <Link
                                key={item.href}
                                href={item.href}
                                className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-all font-medium ${
                                    item.href === '/admin/bancadas'
                                        ? 'bg-blue-900/50 text-blue-200 border border-blue-800/50 hover:bg-blue-800/50'
                                        : item.href === '/admin/crm'
                                            ? 'bg-purple-900/40 text-purple-300 border border-purple-800/40 hover:bg-purple-800/50'
                                            : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                                }`}
                                >
                                <item.icon size={19} />
                                {item.label}
                                </Link>
                            ))}
                        </div>
                    </div>
                ))}
            </nav>

            <div className="p-4 border-t border-slate-800 space-y-2">
                <Link href="/cliente/dashboard" className="flex items-center gap-3 px-4 py-3 text-blue-300 hover:bg-blue-900/30 rounded-lg w-full transition-colors border border-dashed border-blue-800">
                    <LayoutDashboard size={20} /> Área do Cliente
                </Link>

                <button 
                    onClick={handleLogout}
                    className="flex items-center gap-3 px-4 py-3 text-red-400 hover:bg-red-900/20 rounded-lg w-full transition-colors"
                >
                    <LogOut size={20} /> Sair
                </button>
            </div>
        </aside>

        <main className="flex-1 ml-64 p-8 overflow-y-auto">
            <div className="max-w-7xl mx-auto">
                {children}
            </div>
        </main>
    </div>
  );
}
