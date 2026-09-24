'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { redirectToLogin } from '@/app/utils/client-session';

type RuntimeStatus = {
  authenticated: boolean;
  userId: string | null;
  role: string | null;
  customerPortalAllowed: boolean;
  staffBypass: boolean;
  mfaRequired: boolean;
  legalAcceptanceRequired: boolean;
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
  '/seguranca',
  '/privacidade',
  '/aceite-legal',
];

function isProtectedPath(pathname: string) {
  return PROTECTED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function isCustomerPortalPath(pathname: string) {
  if (pathname === '/configuracoes/minha-conta' || pathname.startsWith('/configuracoes/minha-conta/')) return false;
  return ['/cliente', '/emitir', '/configuracoes', '/relatorios', '/dashboard', '/emissores']
    .some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function homeForRole(role: string | null) {
  if (role === 'COMERCIAL') return '/admin/contratacoes';
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
        const status = await nativeFetch('/api/system/status', { cache: 'no-store', signal: AbortSignal.timeout(8000) })
          .then((r) => r.ok ? r.json() : null).catch(() => null);
        if (!status || status.available === false) {
          setRuntimeError(true);
          // A falha do banco nao prova expiracao. Preserva sessao e rascunhos locais.
          return Response.json({ error: 'Servico temporariamente indisponivel.' }, { status: 503 });
        }
        if (status.authenticated) {
          if (status.mfaRequired && window.location.pathname !== '/seguranca') {
            window.location.replace('/seguranca');
          } else if (status.legalAcceptanceRequired && window.location.pathname !== '/aceite-legal') {
            window.location.replace('/aceite-legal');
          }
          // A sessão continua válida. O 401 pertence ao gate da rota (MFA,
          // aceite jurídico ou autorização), portanto não apaga a sessão.
        } else {
          redirectToLogin('expired');
        }
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

    const checkRuntime = async () => {
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

        // A identidade real sempre vem da sessão HttpOnly. O armazenamento
        // local é apenas compatibilidade de UI e não pode conservar outra
        // conta, exceto durante uma impersonação ativa e auditada.
        if (status.authenticated && status.userId && localStorage.getItem('isSupportMode') !== 'true') {
          localStorage.setItem('userId', status.userId);
          if (status.role) localStorage.setItem('userRole', status.role);
        }

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

        if (protectedPath && status.mfaRequired && pathname !== '/seguranca') {
          window.location.replace('/seguranca');
          return;
        }

        if (protectedPath && status.legalAcceptanceRequired && pathname !== '/aceite-legal' && !status.mfaRequired) {
          window.location.replace('/aceite-legal');
          return;
        }

        if (isCustomerPortalPath(pathname) && !status.customerPortalAllowed && localStorage.getItem('isSupportMode') !== 'true') {
          window.location.replace(homeForRole(status.role));
          return;
        }

        if (pathname === '/aceite-legal' && !status.legalAcceptanceRequired) {
          window.location.replace(homeForRole(status.role));
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
        if (mounted) {
          setRuntimeError(true);
        }
      } finally {
        window.clearTimeout(timeout);
        checking = false;
      }
    };

    void checkRuntime();
    const interval = window.setInterval(() => void checkRuntime(), 30000);
    const onFocus = () => void checkRuntime();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void checkRuntime();
    };
    window.addEventListener('focus', onFocus);
    window.addEventListener('nfsegoo:retry-status', onFocus);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      mounted = false;
      window.clearInterval(interval);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('nfsegoo:retry-status', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [pathname, protectedPath]);

  return <>
    {children}
    {runtimeError && <aside role="alert" className="fixed bottom-4 left-4 right-4 z-[10000] mx-auto flex max-w-2xl flex-wrap items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950 shadow-xl">
      <AlertTriangle size={22} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="font-bold">Conexão com o serviço indisponível</p>
        <p className="text-sm">Sua tela foi preservada. Aguarde a reconexão e confira o resultado antes de repetir um envio.</p>
      </div>
      <button type="button" onClick={() => window.dispatchEvent(new Event('nfsegoo:retry-status'))} className="flex items-center gap-2 rounded-lg border border-amber-700 px-3 py-2 text-sm font-semibold">
        <RefreshCw size={16} aria-hidden="true" /> Tentar novamente
      </button>
    </aside>}
  </>;
}
