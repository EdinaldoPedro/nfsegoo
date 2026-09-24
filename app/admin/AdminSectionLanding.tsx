'use client';

import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { canAccessAdminPage } from '@/app/utils/admin-navigation';
import { adminSections } from '@/app/utils/admin-sections';
import { useEffect, useState } from 'react';

export default function AdminSectionLanding({ sectionId }: { sectionId: string }) {
  const [role, setRole] = useState<string | null>(null);
  useEffect(() => { setRole(localStorage.getItem('userRole')); }, []);
  const section = adminSections.find(item => item.id === sectionId);
  if (!section) return null;
  const views = section.views.filter(view => canAccessAdminPage(role, view.href));

  return <div className="space-y-5">
    <div className="flex items-end justify-between gap-4"><div><p className="text-xs font-black uppercase tracking-[0.18em] text-blue-700">Visualizações</p><h2 className="mt-1 text-xl font-black tracking-tight text-slate-950">Escolha o que precisa acompanhar</h2></div><span className="hidden text-sm font-medium text-slate-500 sm:block">{views.length} {views.length === 1 ? 'visualização' : 'visualizações'}</span></div>
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {views.map(view => { const Icon = view.icon; return <Link key={view.href} href={view.href} className="group flex min-h-44 flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_8px_24px_rgba(15,23,42,0.04)] transition hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-[0_16px_32px_rgba(37,99,235,0.11)]"><div className="flex items-start justify-between"><span className="rounded-xl bg-blue-50 p-3 text-blue-700 group-hover:bg-blue-600 group-hover:text-white"><Icon size={21} /></span><ArrowUpRight size={18} className="text-slate-400 group-hover:text-blue-700" /></div><h3 className="mt-5 text-base font-black text-slate-950">{view.label}</h3><p className="mt-1 text-sm leading-6 text-slate-500">{view.description}</p></Link>; })}
    </div>
  </div>;
}
