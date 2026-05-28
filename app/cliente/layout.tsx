'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, LifeBuoy, ShieldAlert } from 'lucide-react';
import AppTour from '@/components/AppTour';

export const dynamic = 'force-dynamic';

export default function ClienteLayout({ children }: { children: React.ReactNode }) {
  const [isSupport, setIsSupport] = useState(false);
  const [isContadorContext, setIsContadorContext] = useState(false);
  const router = useRouter();

  useEffect(() => {
    setIsSupport(localStorage.getItem('isSupportMode') === 'true');
    setIsContadorContext(!!localStorage.getItem('empresaContextId'));
  }, []);

  const sairDoSuporte = () => {
    const adminId = localStorage.getItem('adminBackUpId');

    if (adminId) {
      localStorage.setItem('userId', adminId);
      localStorage.removeItem('adminBackUpId');
      localStorage.removeItem('isSupportMode');
      localStorage.removeItem('empresaContextId');
      window.location.href = '/admin/usuarios';
    } else {
      router.push('/login');
    }
  };

  const sairDoContextoContador = () => {
    localStorage.removeItem('empresaContextId');
    router.push('/contador');
  };

  return (
    <div className={`min-h-screen ${isSupport ? 'bg-amber-50' : ''}`}>
      <AppTour />

      {isSupport && (
        <div className="sticky top-0 z-50 border-b border-amber-200 bg-amber-50/95 px-4 py-2 shadow-sm backdrop-blur md:px-8">
          <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-4">
            <span className="flex items-center gap-2 text-sm font-black text-amber-800">
              <LifeBuoy size={17} /> Modo suporte ativo
              <span className="hidden font-semibold text-amber-700 md:inline">visualizando como cliente</span>
            </span>
            <button
              onClick={sairDoSuporte}
              className="rounded-xl bg-white px-4 py-2 text-xs font-black text-amber-700 shadow-sm ring-1 ring-amber-200 transition hover:bg-amber-100"
            >
              Voltar ao admin
            </button>
          </div>
        </div>
      )}

      {isContadorContext && (
        <div className="sticky top-0 z-50 border-b border-violet-200 bg-violet-600/95 px-4 py-2 text-white shadow-sm backdrop-blur animate-in slide-in-from-top md:px-8">
          <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/15">
                <ShieldAlert size={17} className="text-violet-100" />
              </span>
              <span className="text-sm font-black">Acesso contador</span>
              <span className="hidden text-xs font-semibold text-violet-100 md:inline">Você está visualizando os dados do seu cliente.</span>
            </div>
            <button
              onClick={sairDoContextoContador}
              className="flex items-center gap-2 rounded-xl bg-white px-4 py-2 text-xs font-black text-violet-700 shadow-sm transition hover:bg-violet-50"
            >
              <ArrowLeft size={14} /> Sair / trocar empresa
            </button>
          </div>
        </div>
      )}

      {children}
    </div>
  );
}
