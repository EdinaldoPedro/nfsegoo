'use client';

import { useState, useEffect } from 'react';
import { Menu, X, User, Briefcase, FileText, Settings, LogOut, Phone, Shield, ArrowLeft, Building2, Search, ChevronDown, BadgeHelp } from 'lucide-react';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { checkIsStaff } from '@/app/utils/permissions';
import { useAppConfig } from '@/app/contexts/AppConfigContext';

export default function Sidebar() {
  const [isOpen, setIsOpen] = useState(false);
  const [userData, setUserData] = useState<any>(null);
  const [userRole, setUserRole] = useState('');
  const [isContador, setIsContador] = useState(false);
  const [notificacoes, setNotificacoes] = useState(0);
  const [isSupportMode, setIsSupportMode] = useState(false);
  const [empresaSearch, setEmpresaSearch] = useState('');
  const [empresaSwitcherOpen, setEmpresaSwitcherOpen] = useState(false);

  const { t } = useAppConfig();
  const router = useRouter();
  const pathname = usePathname();

  const getAdminIdFromToken = () => {
      try {
          const token = localStorage.getItem('token');
          if (!token) return null;
          const payload = JSON.parse(atob(token.split('.')[1]));
          return payload.sub || payload.id; 
      } catch (e) {
          return null;
      }
  };

  useEffect(() => {
    const userId = localStorage.getItem('userId');
    const role = localStorage.getItem('userRole');
    
    const supportActive = localStorage.getItem("isSupportMode") === 'true';
    setIsSupportMode(supportActive);

    if (role) {
        setUserRole(role);
        setIsContador(role === 'CONTADOR');
    }

    const fetchData = async () => {
        if(userId) {
            try {
                const contextId = localStorage.getItem('empresaContextId');
                
                const res = await fetch('/api/perfil', { 
                    headers: { 
                        'x-user-id': userId, 
                        'x-empresa-id': contextId || ''
                    }
                });
                
                if (res.status === 401 && localStorage.getItem("isSupportMode") === 'true') {
                    console.warn("Sidebar: 401 ignored in Support Mode.");
                    return; 
                }

                if(res.ok) {
                    setUserData(await res.json());
                }

                if (!checkIsStaff(role || '')) {
                    const resNotif = await fetch('/api/clientes/notificacoes', {
                        headers: { 'x-user-id': userId }
                    });
                    if (resNotif.ok) {
                        const dataNotif = await resNotif.json();
                        setNotificacoes(dataNotif.count || 0);
                    }
                }
            } catch (error) { 
                console.error("Sidebar error", error); 
            }
        }
    };

    if (isOpen) fetchData(); 

    const handleStorage = () => setIsSupportMode(localStorage.getItem("isSupportMode") === 'true');
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);

  }, [isOpen, pathname]); 

  useEffect(() => {
    setIsOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!isOpen) {
      setEmpresaSearch('');
      setEmpresaSwitcherOpen(false);
    }
  }, [isOpen]);

  const handleLogoutOrReturn = async () => { // <--- Adicione async aqui
    const isSupportActive = localStorage.getItem('isSupportMode') === 'true';
    let adminBackUpId = localStorage.getItem('adminBackUpId');
    const adminBackUpRole = localStorage.getItem('adminBackUpRole');

    if (isSupportActive && !adminBackUpId) adminBackUpId = getAdminIdFromToken();

    if (isSupportActive && adminBackUpId) {
        localStorage.setItem('userId', adminBackUpId);
        localStorage.setItem('userRole', adminBackUpRole || 'MASTER'); 
        localStorage.removeItem('isSupportMode');
        localStorage.removeItem('adminBackUpId');
        localStorage.removeItem('adminBackUpRole');
        localStorage.removeItem('empresaContextId');
        window.location.href = '/admin/usuarios';
    } else {
        // === NOVA LÓGICA DE LOGOUT AQUI ===
        try {
            await fetch('/api/auth/logout', { method: 'POST' });
            localStorage.clear();
            sessionStorage.clear();
            router.push('/'); // Redireciona para o login em vez de '/' para forçar a tela de autenticação
        } catch (error) {
            console.error("Erro ao terminar sessão", error);
        }
    }
  };

  const abrirMenu = () => {
      setIsOpen(true);
      if (typeof window !== 'undefined') window.dispatchEvent(new Event('tour:menu-opened'));
  };

  // === NOVO: FUNÇÃO PARA TROCAR DE EMPRESA ===
  const handleEmpresaChange = (newEmpresaId: string) => {
      if (newEmpresaId === userData.empresaPrimariaId) {
          localStorage.removeItem('empresaContextId'); // Volta para a principal
      } else {
          localStorage.setItem('empresaContextId', newEmpresaId); // Define a nova como contexto
      }
      // O reload garante que TODO o sistema (dashboard, notas, configs) puxe os dados do novo CNPJ
      window.location.reload(); 
  };

  const abrirSwitcherEmpresa = () => {
      setEmpresaSwitcherOpen(true);
      setEmpresaSearch('');
  };

  const getStatusCertificado = () => {
    if (!userData?.temCertificado) return { label: 'Pendente', classes: 'text-red-500' };
    if (!userData.vencimentoCertificado) return { label: 'Ativo', classes: 'text-green-600' };
    const hoje = new Date();
    const vencimento = new Date(userData.vencimentoCertificado);
    const diffDays = Math.ceil((vencimento.getTime() - hoje.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays < 0) return { label: 'Vencido', classes: 'text-red-600 font-bold' };
    if (diffDays <= 30) return { label: 'A Vencer', classes: 'text-amber-600 font-bold' };
    return { label: 'Válido', classes: 'text-green-600' };
  };

  const statusCert = getStatusCertificado();
  const showAdminPanel = checkIsStaff(userRole) && !isSupportMode;
  const supportHref =
    !isSupportMode && ['MASTER', 'ADMIN', 'SUPORTE', 'SUPORTE_TI'].includes(userRole)
      ? '/admin/suporte'
      : '/cliente/suporte';
  const empresasDisponiveis = userData?.listaEmpresas || [];
  const empresaAtualId =
    typeof window !== 'undefined'
      ? localStorage.getItem('empresaContextId') || userData?.empresaPrimariaId
      : userData?.empresaPrimariaId;
  const empresasFiltradas = empresasDisponiveis
    .filter((emp: any) => {
      const termo = empresaSearch.trim().toLowerCase();
      if (!termo) return true;
      return `${emp.razaoSocial || ''} ${emp.cnpj || ''}`.toLowerCase().includes(termo);
    })
    .slice(0, 7);
  const empresaAtual = empresasDisponiveis.find((emp: any) => emp.id === empresaAtualId);

  return (
    <>
      <button
        onClick={abrirMenu}
        className="tour-menu-btn relative inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-700 shadow-sm transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700 dark:border-slate-700 dark:bg-slate-900 dark:text-gray-200"
        aria-label="Abrir menu"
      >
        <Menu size={20} />
        {notificacoes > 0 && <span className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full border-2 border-white bg-red-500 animate-pulse"></span>}
      </button>

      {isOpen && (
      <>
      <div className="fixed inset-0 z-[90] bg-slate-950/45 backdrop-blur-[2px] transition-opacity" onClick={() => setIsOpen(false)} />

      <div className="fixed right-0 top-0 z-[100] flex h-[100dvh] w-[340px] max-w-[92vw] flex-col overflow-hidden border-l border-slate-200 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.24)] animate-in slide-in-from-right duration-200 dark:border-slate-800 dark:bg-slate-900">
        
        <div className={`p-5 border-b flex justify-between items-center text-white shrink-0 border-gray-100 dark:border-slate-800 ${isSupportMode ? 'bg-orange-500' : 'bg-gradient-to-br from-blue-700 to-blue-600'}`}>
          <h2 className="font-bold text-lg flex items-center gap-2">
              {isSupportMode ? <><Shield size={20}/> Modo Suporte</> : 'Menu'}
          </h2>
          <button onClick={() => setIsOpen(false)} className={`p-1 rounded ${isSupportMode ? 'hover:bg-orange-600' : 'hover:bg-blue-700'}`}>
            <X size={24} />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto bg-slate-50/70 p-4 dark:bg-slate-950">
          
          <section className="tour-sidebar-perfil rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <h3 className="text-xs font-bold text-gray-400 uppercase mb-4 flex items-center gap-2">
              <User size={14} /> {t('menu', 'settings')}
            </h3>
            <div className="space-y-3 text-sm text-gray-700 dark:text-gray-300">
              <p><span className="font-medium">Nome:</span> {userData?.nome || '...'}</p>
              <p><span className="font-medium">Email:</span> {userData?.email || '...'}</p>
              
              {!isContador && (
                  <p><span className="font-medium">Plano:</span> <span className="text-green-600 font-bold">{userData?.plano?.tipo || 'Gratuito'}</span></p>
              )}
              
              <Link href="/configuracoes/minha-conta" onClick={() => setIsOpen(false)} className="text-blue-600 hover:underline text-xs block mt-2">
                Editar Dados Pessoais
              </Link>
            </div>
          </section>

          <section className="tour-sidebar-empresa rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <h3 className="text-xs font-bold text-gray-400 uppercase mb-4 flex items-center gap-2">
              <Briefcase size={14} /> Minha Empresa
            </h3>
            
            {/* === NOVO: SELETOR DE MÚLTIPLAS EMPRESAS === */}
            {empresasDisponiveis.length > 1 && (
                <div className="relative mb-4 rounded-2xl border border-blue-100 bg-blue-50 p-3 dark:border-slate-700 dark:bg-slate-800">
                    <label className="mb-1 flex items-center gap-1 text-xs font-bold text-blue-700 dark:text-blue-400">
                      <Building2 size={12}/> Alternar CNPJ:
                    </label>

                    {!empresaSwitcherOpen ? (
                      <button
                        type="button"
                        onClick={abrirSwitcherEmpresa}
                        className="flex w-full items-center justify-between gap-2 rounded-xl bg-white px-3 py-2.5 text-left text-sm font-bold text-slate-800 shadow-sm ring-1 ring-blue-100 transition hover:ring-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-slate-900 dark:text-white dark:ring-slate-700"
                      >
                        <span className="truncate">{empresaAtual?.razaoSocial || 'Empresa atual'}</span>
                        <ChevronDown size={16} className="shrink-0 text-slate-400" />
                      </button>
                    ) : (
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={15} />
                        <input
                          autoFocus
                          value={empresaSearch}
                          onChange={(e) => setEmpresaSearch(e.target.value)}
                          placeholder="Pesquisar empresa..."
                          className="w-full rounded-xl border border-blue-200 bg-white py-2.5 pl-9 pr-9 text-sm font-medium text-slate-700 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-blue-300 focus:ring-2 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-900 dark:text-white dark:focus:ring-slate-700"
                        />
                        <button
                          type="button"
                          onClick={() => setEmpresaSwitcherOpen(false)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-white"
                          aria-label="Fechar pesquisa de empresas"
                        >
                          <X size={15} />
                        </button>
                      </div>
                    )}

                    {empresaSwitcherOpen && (
                      <div className="absolute left-3 right-3 top-[calc(100%-12px)] z-50 max-h-[360px] space-y-1 overflow-y-auto rounded-2xl border border-blue-100 bg-white p-2 shadow-2xl shadow-slate-900/15 dark:border-slate-700 dark:bg-slate-900">
                        {empresasFiltradas.length > 0 ? (
                          empresasFiltradas.map((emp: any) => {
                            const selecionada = emp.id === empresaAtualId;
                            return (
                              <button
                                key={emp.id}
                                type="button"
                                onClick={() => handleEmpresaChange(emp.id)}
                                className={`w-full rounded-xl px-3 py-2 text-left text-sm transition ${
                                  selecionada
                                    ? 'bg-blue-600 font-bold text-white shadow-sm'
                                    : 'font-semibold text-slate-700 hover:bg-blue-50 hover:text-blue-800 dark:text-slate-200 dark:hover:bg-slate-800'
                                }`}
                              >
                                <span className="block truncate">{emp.razaoSocial}</span>
                                <span className={`block truncate text-[11px] ${selecionada ? 'text-blue-100' : 'text-slate-400'}`}>
                                  {emp.cnpj || 'CNPJ não informado'}
                                </span>
                              </button>
                            );
                          })
                        ) : (
                          <div className="rounded-xl px-3 py-3 text-sm font-medium text-slate-500 dark:text-slate-400">
                            Nenhuma empresa encontrada.
                          </div>
                        )}
                      </div>
                    )}
                </div>
            )}

            <div className="space-y-3 text-sm text-gray-700 dark:text-gray-300">
              <p>
                  <span className="font-medium block mb-1">Razão Social:</span> 
                  <span className="text-gray-500 leading-tight dark:text-gray-400">{userData?.razaoSocial || '...'}</span>
              </p>
              <p>
                  <span className="font-medium">CNPJ:</span> 
                  <span className="text-gray-500 ml-1 dark:text-gray-400">{userData?.documento || 'Não informado'}</span>
              </p>
              <p>
                  <span className="font-medium">Certificado:</span>{' '}
                  <span className={statusCert.classes}>{statusCert.label}</span>
              </p>
              <Link href="/configuracoes" onClick={() => setIsOpen(false)} className="text-blue-600 hover:underline text-xs block mt-2">
                Configurações da Empresa
              </Link>
            </div>
          </section>

          <section className="tour-sidebar-gestao rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <h3 className="text-xs font-bold text-gray-400 uppercase mb-4 flex items-center gap-2">
              <Settings size={14} /> Gestão
            </h3>
            <div className="flex flex-col gap-3">
                <Link href="/cliente" onClick={() => setIsOpen(false)} className="flex items-center gap-2 rounded-xl p-3 font-semibold text-gray-700 transition hover:bg-blue-50 hover:text-blue-700 dark:text-gray-300 dark:hover:bg-slate-800">
                    <FileText size={18} /> {t('menu', 'clients')}
                </Link>
                <Link href="/relatorios" onClick={() => setIsOpen(false)} className="flex items-center gap-2 rounded-xl p-3 font-semibold text-gray-700 transition hover:bg-blue-50 hover:text-blue-700 dark:text-gray-300 dark:hover:bg-slate-800">
                    <FileText size={18} /> Relatórios
                </Link>
                <Link href="/cliente/ajuda" onClick={() => setIsOpen(false)} className="flex items-center gap-2 rounded-xl p-3 font-semibold text-gray-700 transition hover:bg-blue-50 hover:text-blue-700 dark:text-gray-300 dark:hover:bg-slate-800">
                    <BadgeHelp size={18} /> Central de Ajuda
                </Link>
            </div>
          </section>

          {showAdminPanel && (
             <section>
                <hr className="mb-6 dark:border-slate-800"/>
                <h3 className="text-xs font-bold text-purple-600 uppercase mb-4 flex items-center gap-2">
                  <Shield size={14} /> Admin
                </h3>
                <Link href="/admin/dashboard" onClick={() => setIsOpen(false)} className="flex items-center gap-2 text-purple-700 bg-purple-50 hover:bg-purple-100 p-3 rounded border border-purple-200 font-bold transition">
                    <Shield size={18} /> Acessar Painel Admin
                </Link>
             </section>
          )}

        </div>

        <div className="bg-white p-4 border-t space-y-2 shrink-0 dark:bg-slate-950 dark:border-slate-800">
            <Link href={supportHref} onClick={() => setIsOpen(false)} className="tour-sidebar-suporte flex items-center justify-between text-gray-600 hover:text-blue-600 hover:bg-blue-50 w-full p-3 rounded-xl text-sm font-semibold transition dark:text-gray-400">
                <div className="flex items-center gap-2">
                    <Phone size={16} /> {t('menu', 'support')}
                </div>
                {notificacoes > 0 && (
                    <span className="bg-red-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full shadow-sm animate-pulse">
                        {notificacoes}
                    </span>
                )}
            </Link>
            
            <button 
                onClick={handleLogoutOrReturn} 
                className={`flex items-center gap-2 w-full p-3 rounded-xl text-sm font-bold transition ${isSupportMode ? 'text-orange-600 hover:text-orange-800 bg-orange-50' : 'text-red-500 hover:text-red-700 hover:bg-red-50'}`}
            >
                {isSupportMode ? <ArrowLeft size={16} /> : <LogOut size={16} />} 
                {isSupportMode ? 'Voltar para Admin' : t('menu', 'logout')}
            </button>
        </div>

      </div>
      </>
      )}
    </>
  );
}
