'use client';

import { useState, useEffect } from 'react';
import { Menu, X, User, Briefcase, FileText, Settings, LogOut, Phone, Shield, ArrowLeft, Building2 } from 'lucide-react';
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
  const showAdminPanel = checkIsStaff(userRole) && userRole !== 'CONTADOR' && !isSupportMode;
  const supportHref =
    !isSupportMode && ['MASTER', 'ADMIN', 'SUPORTE', 'SUPORTE_TI'].includes(userRole)
      ? '/admin/suporte'
      : '/cliente/suporte';

  return (
    <>
      <button onClick={abrirMenu} className="tour-menu-btn p-2 hover:bg-gray-100 rounded-lg transition relative dark:hover:bg-slate-800">
        <Menu size={28} className="text-gray-700 dark:text-gray-200" />
        {notificacoes > 0 && <span className="absolute top-1 right-1 w-3 h-3 bg-red-500 rounded-full border-2 border-white animate-pulse"></span>}
      </button>

      {isOpen && <div className="fixed inset-0 bg-black/50 z-40 transition-opacity" onClick={() => setIsOpen(false)} />}

      <div className={`fixed top-0 right-0 h-full w-80 bg-white shadow-2xl z-50 transform transition-transform duration-300 ease-in-out ${isOpen ? 'translate-x-0' : 'translate-x-full'} flex flex-col dark:bg-slate-900`}>
        
        <div className={`p-6 border-b flex justify-between items-center text-white shrink-0 border-gray-100 dark:border-slate-800 ${isSupportMode ? 'bg-orange-500' : 'bg-blue-600'}`}>
          <h2 className="font-bold text-lg flex items-center gap-2">
              {isSupportMode ? <><Shield size={20}/> Modo Suporte</> : 'Menu'}
          </h2>
          <button onClick={() => setIsOpen(false)} className={`p-1 rounded ${isSupportMode ? 'hover:bg-orange-600' : 'hover:bg-blue-700'}`}>
            <X size={24} />
          </button>
        </div>

        <div className="p-6 space-y-8 flex-1 overflow-y-auto">
          
          <section className="tour-sidebar-perfil">
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

          <hr className="dark:border-slate-800" />

          <section className="tour-sidebar-empresa">
            <h3 className="text-xs font-bold text-gray-400 uppercase mb-4 flex items-center gap-2">
              <Briefcase size={14} /> Minha Empresa
            </h3>
            
            {/* === NOVO: SELETOR DE MÚLTIPLAS EMPRESAS === */}
            {userData?.listaEmpresas && userData.listaEmpresas.length > 1 && (
                <div className="mb-4 bg-blue-50 p-3 rounded-lg border border-blue-100 dark:bg-slate-800 dark:border-slate-700">
                    <label className="text-xs font-bold text-blue-700 dark:text-blue-400 mb-1 flex items-center gap-1"><Building2 size={12}/> Alternar CNPJ:</label>
                    <select 
                        className="w-full p-2 text-sm font-bold border-none rounded bg-white text-slate-700 shadow-sm cursor-pointer outline-none focus:ring-2 focus:ring-blue-500 dark:bg-slate-900 dark:text-white"
                        value={localStorage.getItem('empresaContextId') || userData.empresaPrimariaId}
                        onChange={(e) => handleEmpresaChange(e.target.value)}
                    >
                        {userData.listaEmpresas.map((emp: any) => (
                            <option key={emp.id} value={emp.id}>
                                {emp.razaoSocial.length > 20 ? emp.razaoSocial.substring(0,20)+'...' : emp.razaoSocial}
                            </option>
                        ))}
                    </select>
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

          <hr className="dark:border-slate-800" />

          <section className="tour-sidebar-gestao">
            <h3 className="text-xs font-bold text-gray-400 uppercase mb-4 flex items-center gap-2">
              <Settings size={14} /> Gestão
            </h3>
            <div className="flex flex-col gap-3">
                <Link href="/cliente" onClick={() => setIsOpen(false)} className="flex items-center gap-2 text-gray-700 hover:bg-gray-50 p-2 rounded dark:text-gray-300 dark:hover:bg-slate-800">
                    <FileText size={18} /> {t('menu', 'clients')}
                </Link>
                <Link href="/relatorios" onClick={() => setIsOpen(false)} className="flex items-center gap-2 text-gray-700 hover:bg-gray-50 p-2 rounded dark:text-gray-300 dark:hover:bg-slate-800">
                    <FileText size={18} /> Relatórios
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

        <div className="bg-gray-50 p-4 border-t space-y-2 shrink-0 dark:bg-slate-950 dark:border-slate-800">
            <Link href={supportHref} onClick={() => setIsOpen(false)} className="tour-sidebar-suporte flex items-center justify-between text-gray-600 hover:text-blue-600 w-full p-2 text-sm transition dark:text-gray-400">
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
                className={`flex items-center gap-2 w-full p-2 text-sm font-medium transition ${isSupportMode ? 'text-orange-600 hover:text-orange-800 bg-orange-50 rounded font-bold' : 'text-red-500 hover:text-red-700'}`}
            >
                {isSupportMode ? <ArrowLeft size={16} /> : <LogOut size={16} />} 
                {isSupportMode ? 'Voltar para Admin' : t('menu', 'logout')}
            </button>
        </div>

      </div>
    </>
  );
}
