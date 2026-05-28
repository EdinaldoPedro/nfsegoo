'use client';

import Link from 'next/link';
import { ArrowLeft, Building2 } from 'lucide-react';
import Sidebar from '@/components/Sidebar';

type AppHeaderProps = {
  title: string;
  subtitle?: string;
  backHref?: string;
  eyebrow?: string;
  action?: React.ReactNode;
  showLogo?: boolean;
};

export default function AppHeader({ title, subtitle, backHref, eyebrow, action, showLogo = true }: AppHeaderProps) {
  return (
    <header className="saas-page-header sticky top-0 z-30 border-x-0 border-t-0 rounded-none">
      <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-4 px-4 py-4 md:px-8">
        <div className="flex min-w-0 items-center gap-4">
          {backHref ? (
            <Link href={backHref} className="saas-btn-secondary h-11 w-11 shrink-0 p-0" aria-label="Voltar">
              <ArrowLeft size={18} />
            </Link>
          ) : showLogo ? (
            <div className="flex shrink-0 items-center gap-3">
              <img src="/icons/G.png" alt="NFSeGoo" className="h-10 w-10 rounded-2xl bg-white p-1.5 shadow-sm ring-1 ring-slate-200" />
            </div>
          ) : (
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-blue-600 ring-1 ring-blue-100">
              <Building2 size={20} />
            </span>
          )}

          <div className="min-w-0">
            {eyebrow && <p className="text-xs font-black uppercase tracking-[0.18em] text-blue-600">{eyebrow}</p>}
            <h1 className="truncate text-xl font-black tracking-tight text-slate-950 md:text-2xl">{title}</h1>
            {subtitle && <p className="mt-0.5 hidden text-sm text-slate-500 sm:block">{subtitle}</p>}
          </div>
        </div>

        <div className="flex items-center gap-3">
          {action}
          <Sidebar />
        </div>
      </div>
    </header>
  );
}
