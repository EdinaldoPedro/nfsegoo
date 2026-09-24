'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { ChevronRight, CircleUserRound, ExternalLink, LogOut, Menu, Shield, X } from 'lucide-react';
import Link from 'next/link';
import { checkIsStaff, ROLE_LABELS } from '@/app/utils/permissions';
import { adminHome, canAccessAdminPage } from '@/app/utils/admin-navigation';
import { adminAccountViews, adminSections, sectionForAdminPath, viewForAdminPath } from '@/app/utils/admin-sections';
import { logoutAndRedirect } from '@/app/utils/client-session';

export const dynamic = 'force-dynamic';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [role, setRole] = useState<string | null>(null);
  const [accessError, setAccessError] = useState('');
  const [retry, setRetry] = useState(0);
  const [authorized, setAuthorized] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    let active = true;

    const validateAccess = async () => {
      try {
        const res = await fetch('/api/perfil', { cache: 'no-store' });
        if (!res.ok) {
          setAccessError('Não foi possível conferir seu acesso. Tente novamente quando o serviço estiver disponível.');
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
          setRole(data.role);
          setAccessError('');
          setAuthorized(true);
        }
      } catch {
        if (active) setAccessError('Conexão indisponível. Sua sessão não foi encerrada.');
      }
    };

    validateAccess();

    return () => {
      active = false;
    };
  }, [router, retry]);

  if (!authorized) return <div className="p-8" role="status">{accessError || 'Conferindo acesso…'} {accessError && <button className="ml-3 underline" onClick={() => setRetry((value) => value + 1)}>Tentar novamente</button>}</div>;
  if (!canAccessAdminPage(role, pathname)) return <div className="p-8"><h1 className="text-xl font-bold">Área não disponível para este perfil</h1><Link className="mt-4 inline-block text-blue-700 underline" href={adminHome(role)}>Ir para minha área</Link></div>;


  const visibleSections = adminSections.filter(section => canAccessAdminPage(role, section.href));
  const currentSection = sectionForAdminPath(pathname);
  const currentView = currentSection && viewForAdminPath(currentSection, pathname);
  const visibleViews = currentSection?.views.filter(view => canAccessAdminPage(role, view.href)) || [];
  const inAccount = pathname === '/admin/minha-conta' || pathname.startsWith('/admin/minha-conta/');

  const handleLogout = async () => {
    try {
        await logoutAndRedirect();
    } catch (error) {
        console.error("Erro ao terminar sessão", error);
    }
};

  return (
    <div className="min-h-screen bg-[#f4f7fb] text-slate-900 lg:flex">
        {sidebarOpen && (
          <button
            type="button"
            aria-label="Fechar navegação"
            className="fixed inset-0 z-30 bg-slate-950/55 backdrop-blur-sm lg:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        <aside className={`fixed inset-y-0 left-0 z-40 flex w-[272px] flex-col bg-[#101d35] text-white shadow-2xl transition-transform duration-200 lg:translate-x-0 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
            <div className="flex items-center gap-3 border-b border-white/10 px-5 py-6">
                <div className="rounded-2xl bg-blue-500 p-2.5 shadow-lg shadow-blue-950/40">
                    <Shield size={22} className="text-white" />
                </div>
                <div>
                    <h1 className="text-base font-black tracking-tight">NFSeGoo <span className="text-blue-300">Admin</span></h1>
                    <p className="text-xs text-slate-400">{ROLE_LABELS[role || ''] || 'Equipe interna'}</p>
                </div>
                <button type="button" aria-label="Fechar menu" onClick={() => setSidebarOpen(false)} className="ml-auto rounded-lg p-2 text-slate-300 hover:bg-slate-800 lg:hidden">
                  <X size={20} />
                </button>
            </div>

            <nav aria-label="Áreas do administrador" className="flex-1 space-y-1 overflow-y-auto px-3 py-6 custom-scrollbar">
                <p className="mb-3 px-3 text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Áreas de trabalho</p>
                {visibleSections.map(section => {
                  const active = currentSection?.id === section.id || (section.id === 'overview' && pathname === '/admin');
                  const Icon = section.icon;
                  return <Link key={section.id} href={section.href} onClick={() => setSidebarOpen(false)} aria-current={active ? 'page' : undefined}
                    className={`group flex items-center gap-3 rounded-xl border px-3.5 py-3 text-sm font-semibold transition ${active ? 'border-blue-400/30 bg-blue-500/20 text-white shadow-sm' : 'border-transparent text-slate-300 hover:bg-white/7 hover:text-white'}`}>
                    <Icon size={19} className={active ? 'text-blue-300' : 'text-slate-400 group-hover:text-blue-300'} />
                    <span className="flex-1">{section.label}</span><ChevronRight size={15} className={active ? 'text-blue-300' : 'text-slate-600'} />
                  </Link>;
                })}
            </nav>

            <div className="space-y-1 border-t border-white/10 p-3">
                <Link href="/admin/minha-conta" onClick={() => setSidebarOpen(false)} aria-current={inAccount ? 'page' : undefined} className={`flex items-center gap-3 rounded-xl px-3.5 py-3 text-sm font-semibold transition ${inAccount ? 'bg-blue-500/20 text-white' : 'text-slate-300 hover:bg-white/7 hover:text-white'}`}>
                  <CircleUserRound size={20} className="text-blue-300" /> Minha conta
                </Link>
                <Link href="/cliente/dashboard" className="flex items-center gap-3 rounded-xl px-3.5 py-3 text-sm text-slate-300 transition hover:bg-white/7 hover:text-white">
                    <ExternalLink size={18} /> Área do cliente
                </Link>
                <button 
                    onClick={handleLogout}
                    className="flex w-full items-center gap-3 rounded-xl px-3.5 py-3 text-sm text-rose-300 transition hover:bg-rose-500/10"
                >
                    <LogOut size={18} /> Sair
                </button>
            </div>
        </aside>

        <main className="min-w-0 flex-1 lg:ml-[272px]">
            <div className="sticky top-0 z-20 flex h-14 items-center border-b border-slate-200 bg-white/95 px-[var(--saas-gutter)] shadow-sm backdrop-blur lg:hidden">
              <button type="button" onClick={() => setSidebarOpen(true)} className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 text-slate-700" aria-label="Abrir navegação">
                <Menu size={21} />
              </button>
              <span className="ml-3 font-black text-slate-900">{currentSection?.label || (inAccount ? 'Minha conta' : 'Admin')}</span>
            </div>
            <div className="admin-page mx-auto max-w-[var(--saas-content-max)] p-[var(--saas-gutter)]">
                {currentSection && currentSection.views.length > 0 && <header className="mb-6 overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_12px_34px_rgba(15,23,42,0.05)]">
                  <div className="flex flex-col gap-3 bg-gradient-to-r from-white via-white to-blue-50/70 px-5 py-5 sm:px-7 sm:py-6">
                    <nav aria-label="Caminho" className="flex items-center gap-1.5 text-xs font-semibold text-slate-500"><Link href="/admin/dashboard" className="hover:text-blue-700">Admin</Link><ChevronRight size={13} /><span className="text-blue-700">{currentSection.label}</span>{currentView && <><ChevronRight size={13} /><span className="text-slate-700">{currentView.label}</span></>}</nav>
                    <div className="flex items-center gap-3"><div className="rounded-2xl bg-blue-600 p-2.5 text-white"><currentSection.icon size={22} /></div><div><h1 className="text-xl font-black tracking-tight text-slate-950 sm:text-2xl">{currentSection.label}</h1><p className="mt-0.5 text-sm text-slate-500">{currentSection.description}</p></div></div>
                  </div>
                  {currentView && <nav aria-label={`Visualizações de ${currentSection.label}`} className="flex gap-1 overflow-x-auto border-t border-slate-100 px-3 py-2 sm:px-5">
                    {visibleViews.map(view => { const active = currentView?.href === view.href; return <Link key={view.href} href={view.href} aria-current={active ? 'page' : undefined} className={`inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-xl px-3 py-2 text-sm font-bold transition ${active ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-950'}`}><view.icon size={16} />{view.label}</Link>; })}
                  </nav>}
                </header>}
                {inAccount && <header className="mb-6 overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm"><div className="px-6 py-6"><p className="text-xs font-black uppercase tracking-[0.18em] text-blue-600">Área pessoal</p><h1 className="mt-2 text-2xl font-black text-slate-950">Minha conta</h1><p className="mt-1 text-sm text-slate-500">Dados, acesso e proteção da sua conta administrativa.</p></div>{pathname !== '/admin/minha-conta' && <nav aria-label="Visualizações da minha conta" className="flex gap-1 overflow-x-auto border-t border-slate-100 px-4 py-2">{adminAccountViews.map(view => <Link key={view.href} href={view.href} aria-current={pathname === view.href ? 'page' : undefined} className={`inline-flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-sm font-bold ${pathname === view.href ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}><view.icon size={16} />{view.label}</Link>)}</nav>}</header>}
                {children}
            </div>
        </main>
    </div>
  );
}
