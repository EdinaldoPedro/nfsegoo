'use client';

import { useCallback, useEffect, useState } from 'react';
import { Clock3, Loader2, LogOut, RefreshCw, ShieldCheck, Sparkles, Wrench } from 'lucide-react';
import { logoutAndRedirect } from '@/app/utils/client-session';

type MaintenanceStatus = {
  maintenance: {
    active: boolean;
    title: string;
    message: string;
    forecast: string | null;
    updatedAt: string | null;
  };
};

export default function MaintenancePage() {
  const [status, setStatus] = useState<MaintenanceStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const response = await fetch('/api/system/status', { cache: 'no-store' });
      if (!response.ok) throw new Error('Status indisponível');
      setStatus(await response.json());
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const maintenance = status?.maintenance;

  return (
    <main className="relative min-h-screen overflow-hidden bg-slate-950 px-5 py-10 text-white">
      <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.04)_1px,transparent_1px)] bg-[size:42px_42px]" />
      <div className="absolute -left-32 top-10 h-96 w-96 rounded-full bg-blue-600/25 blur-3xl" />
      <div className="absolute -right-28 bottom-0 h-96 w-96 rounded-full bg-emerald-500/20 blur-3xl" />

      <div className="relative mx-auto flex min-h-[calc(100vh-5rem)] max-w-5xl items-center justify-center">
        <section className="w-full overflow-hidden rounded-[2rem] border border-white/10 bg-white/[0.08] shadow-2xl shadow-black/30 backdrop-blur-xl">
          <div className="grid lg:grid-cols-[0.9fr_1.1fr]">
            <div className="relative flex min-h-72 flex-col justify-between overflow-hidden border-b border-white/10 bg-gradient-to-br from-blue-600 to-blue-900 p-8 lg:min-h-[520px] lg:border-b-0 lg:border-r">
              <div className="absolute -right-16 -top-16 h-64 w-64 rounded-full border-[42px] border-white/10" />
              <div className="relative flex items-center gap-3">
                <img src="/icons/G.png" alt="NFSeGoo" className="h-12 w-12 rounded-xl bg-white/10 object-contain p-1" />
                <div>
                  <p className="text-2xl font-black">NFSe<span className="font-light text-emerald-300">Goo</span></p>
                  <p className="text-xs font-bold uppercase tracking-[0.24em] text-blue-100">Central operacional</p>
                </div>
              </div>

              <div className="relative mt-14 lg:mt-0">
                <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-white/20">
                  <Wrench size={31} />
                </div>
                <p className="text-sm font-black uppercase tracking-[0.22em] text-emerald-200">Manutenção programada</p>
                <h2 className="mt-3 text-3xl font-black leading-tight">Tecnologia em movimento, operação protegida.</h2>
              </div>

              <div className="relative mt-10 flex items-center gap-2 text-xs font-semibold text-blue-100">
                <ShieldCheck size={16} className="text-emerald-300" /> Seus dados permanecem seguros durante a atualização.
              </div>
            </div>

            <div className="flex flex-col justify-center p-8 sm:p-12">
              {loading ? (
                <div className="flex min-h-72 items-center justify-center"><Loader2 className="animate-spin text-emerald-300" size={34} /></div>
              ) : error ? (
                <div className="text-center">
                  <RefreshCw className="mx-auto text-amber-300" size={36} />
                  <h1 className="mt-5 text-2xl font-black">Não foi possível consultar o andamento</h1>
                  <p className="mt-3 text-sm text-slate-300">Você pode tentar novamente ou encerrar a sessão com segurança.</p>
                </div>
              ) : (
                <>
                  <div className="inline-flex w-fit items-center gap-2 rounded-full border border-emerald-300/20 bg-emerald-300/10 px-4 py-2 text-xs font-black uppercase tracking-[0.16em] text-emerald-200">
                    <Sparkles size={15} /> Atualização em andamento
                  </div>
                  <h1 className="mt-6 text-4xl font-black leading-tight tracking-tight">{maintenance?.title}</h1>
                  <p className="mt-5 text-base leading-7 text-slate-300">{maintenance?.message}</p>
                  {maintenance?.forecast && (
                    <div className="mt-7 flex items-start gap-3 rounded-2xl border border-white/10 bg-white/5 p-4">
                      <Clock3 className="mt-0.5 shrink-0 text-blue-300" size={20} />
                      <div><p className="text-xs font-black uppercase tracking-wider text-slate-400">Previsão informada</p><p className="mt-1 font-bold text-white">{maintenance.forecast}</p></div>
                    </div>
                  )}
                </>
              )}

              <div className="mt-9 flex flex-col gap-3 sm:flex-row">
                <button onClick={() => void loadStatus()} disabled={loading} className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-white px-5 py-3.5 text-sm font-black text-slate-950 transition hover:bg-slate-100 disabled:opacity-60">
                  <RefreshCw size={17} /> Verificar novamente
                </button>
                <button onClick={() => void logoutAndRedirect()} className="flex items-center justify-center gap-2 rounded-xl border border-white/15 px-5 py-3.5 text-sm font-black text-slate-200 transition hover:bg-white/10">
                  <LogOut size={17} /> Sair
                </button>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
