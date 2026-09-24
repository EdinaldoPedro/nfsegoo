import Link from 'next/link';
import { ArrowUpRight, ExternalLink } from 'lucide-react';
import { adminAccountViews } from '@/app/utils/admin-sections';

export default function Page() {
  return <div className="grid gap-4 md:grid-cols-2">
    {adminAccountViews.map(view => { const Icon = view.icon; return <Link key={view.href} href={view.href} className="group rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:border-blue-300 hover:shadow-lg"><div className="flex items-start justify-between"><span className="rounded-xl bg-blue-50 p-3 text-blue-700"><Icon size={22} /></span><ArrowUpRight size={18} className="text-slate-400 group-hover:text-blue-700" /></div><h2 className="mt-6 text-lg font-black text-slate-950">{view.label}</h2><p className="mt-2 text-sm leading-6 text-slate-500">{view.description}</p></Link>; })}
    <Link href="/cliente/dashboard" className="inline-flex items-center gap-2 text-sm font-bold text-blue-700 hover:text-blue-900"><ExternalLink size={17} /> Abrir área do cliente</Link>
  </div>;
}
