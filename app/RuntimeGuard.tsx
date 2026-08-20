'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { AlertTriangle, LogIn, RefreshCw } from 'lucide-react';
import { redirectToLogin } from '@/app/utils/client-session';

type RuntimeStatus = {
  authenticated: boolean;
  role: string | null;
  staffBypass: boolean;
  maintenance: { active: boolean };
};

const PROTECTED_PREFIXES = [
  '/admin',
  '/cliente',
  '/contador',
  '/emitir',
  '/configuracoes',
  '/relatorios',
  '/dashboard',
  '/emissores',
  '/verificar-email',
];

function isProtectedPath(pathname: string) {
  return PROTECTED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function homeForRole(role: string | null) {
  if (['ADMIN', 'MASTER', 'SUPORTE', 'SUPORTE_TI'].includes(role || '')) return '/admin/dashboard';
  if (role === 'CONTADOR') return '/contador';
  return '/cliente/dashboard';
}

function isSameOriginApi(input: RequestInfo | URL) {
  try {
    const raw = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
    const url = new URL(raw, window.location.origin);
    return url.origin === window.location.origin && url.pathname.startsWith('/api/');
  } catch {
    return false;
  }
}

export default function RuntimeGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const protectedPath = isProtectedPath(pathname);
  const [runtimeError, setRuntimeError] = useState(false);

  useEffect(() => {
    const nativeFetch = window.fetch.bind(window);
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await nativeFetch(input, init);
      if (response.status === 401 && isSameOriginApi(input) && isProtectedPath(window.location.pathname)) {
        redirectToLogin('expired');
      }
      return response;
    };

    return () => {
      window.fetch = nativeFetch;
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    let checking = false;

    const checkRuntime = async (showErrorOnFailure = false) => {
      if (checking) return;
      checking = true;

      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 8000);

      try {
        const response = await fetch('/api/system/status', {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!response.ok) throw new Error('Status indisponivel');
        const status = await response.json() as RuntimeStatus;
        if (!mounted) return;

        const previewMode = pathname === '/manutencao'
          && new URLSearchParams(window.location.search).get('preview') === '1';
        if (previewMode && (process.env.NODE_ENV === 'development' || status.staffBypass)) {
          setRuntimeError(false);
          return;
        }

        if (pathname === '/manutencao' && !status.authenticated) {
          redirectToLogin('expired');
          return;
        }

        if (protectedPath && !status.authenticated) {
          redirectToLogin('expired');
          return;
        }

        if (status.maintenance.active && status.authenticated && !status.staffBypass) {
          if (pathname !== '/manutencao') window.location.replace('/manutencao');
          else setRuntimeError(false);
          return;
        }

        if (pathname === '/manutencao' && (!status.maintenance.active || status.staffBypass)) {
          window.location.replace(status.authenticated ? homeForRole(status.role) : '/login');
          return;
        }

        setRuntimeError(false);
      } catch {
        if (mounted && showErrorOnFailure && (protectedPath || pathname === '/manutencao')) {
          setRuntimeError(true);
        }
      } finally {
        window.clearTimeout(timeout);
        checking = false;
      }
    };

    void checkRuntime(true);
    const interval = window.setInterval(() => void checkRuntime(false), 30000);
    const onFocus = () => void checkRuntime(false);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void checkRuntime(false);
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      mounted = false;
      window.clearInterval(interval);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [pathname, protectedPath]);

  if (runtimeError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 px-5 text-white">
        <div className="w-full max-w-md rounded-3xl border border-white/10 bg-white/10 p-8 text-center shadow-2xl backdrop-blur">
          <AlertTriangle className="mx-auto text-amber-300" size={38} />
          <h1 className="mt-5 text-2xl font-black">Não foi possível validar sua sessão</h1>
          <p className="mt-3 text-sm leading-6 text-slate-300">A verificação foi encerrada para evitar que a tela fique carregando indefinidamente.</p>
          <div className="mt-7 grid gap-3 sm:grid-cols-2">
            <button onClick={() => window.location.reload()} className="flex items-center justify-center gap-2 rounded-xl bg-white px-4 py-3 text-sm font-black text-slate-900">
              <RefreshCw size={17} /> Tentar novamente
            </button>
            <button onClick={() => redirectToLogin('expired')} className="flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-sm font-black text-white">
              <LogIn size={17} /> Voltar ao login
            </button>
          </div>
        </div>
      </div>
    );
  }

  return children;
}
