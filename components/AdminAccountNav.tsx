import Link from 'next/link';
import { ChevronLeft, KeyRound, UserRound } from 'lucide-react';

export default function AdminAccountNav({ active }: { active: 'profile' | 'security' }) {
  return <nav aria-label="Minha conta administrativa" className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
    <Link href="/admin/minha-conta" className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100"><ChevronLeft size={16} /> Minha conta</Link>
    <Link href="/admin/minha-conta/dados" aria-current={active === 'profile' ? 'page' : undefined} className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-bold ${active === 'profile' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}><UserRound size={16} /> Dados e senha</Link>
    <Link href="/admin/minha-conta/seguranca" aria-current={active === 'security' ? 'page' : undefined} className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-bold ${active === 'security' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}><KeyRound size={16} /> Autenticação e sessões</Link>
  </nav>;
}
