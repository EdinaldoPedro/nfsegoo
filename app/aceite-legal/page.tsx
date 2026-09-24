'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { FileCheck2, LogOut, ShieldCheck } from 'lucide-react';
import { privacyVersion, termsVersion } from '@/app/legal-content';
import { logoutAndRedirect } from '@/app/utils/client-session';

function homeFor(role: string | null) {
  if (role === 'COMERCIAL') return '/admin/contratacoes';
  if (['MASTER', 'ADMIN', 'SUPORTE', 'SUPORTE_TI'].includes(role || '')) return '/admin/dashboard';
  if (role === 'CONTADOR') return '/contador';
  return '/cliente/dashboard';
}

async function errorMessage(response: Response, fallback: string) { try { return (await response.json()).error || fallback; } catch { return fallback; } }

export default function LegalAcceptancePage() {
  const [accepted, setAccepted] = useState(false); const [password, setPassword] = useState('');
  const [role, setRole] = useState<string | null>(null); const [busy, setBusy] = useState(false); const [error, setError] = useState('');

  useEffect(() => { void fetch('/api/system/status', { cache: 'no-store' }).then(async response => {
    if (!response.ok) throw new Error('Serviço temporariamente indisponível.'); const data = await response.json();
    if (!data.authenticated) { window.location.replace('/login'); return; } setRole(data.role);
    if (!data.legalAcceptanceRequired) window.location.replace(homeFor(data.role));
  }).catch(cause => setError(cause.message)); }, []);

  const submit = async () => { setBusy(true); setError(''); try {
    const response = await fetch('/api/legal/acceptance', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accepted, termsVersion, privacyVersion, password }) });
    if (!response.ok) throw new Error(await errorMessage(response, 'Não foi possível registrar o aceite.'));
    window.location.replace(homeFor(role));
  } catch (cause) { setError(cause instanceof Error ? cause.message : 'Falha de conexão.'); setBusy(false); } };

  return <main className="min-h-screen bg-slate-950 px-4 py-10 text-slate-900"><div className="mx-auto max-w-2xl rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl sm:p-9">
    <header className="border-b border-slate-200 pb-6"><p className="text-sm font-black text-blue-700">NFSe Goo</p><h1 className="mt-2 flex items-center gap-2 text-2xl font-black sm:text-3xl"><FileCheck2 /> Atualização dos documentos legais</h1><p className="mt-3 text-sm leading-6 text-slate-600">Para continuar, leia as versões vigentes e registre sua concordância. O aceite fica vinculado à sua conta, data e versões apresentadas.</p></header>
    {error && <p role="alert" className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-800">{error}</p>}
    <section className="mt-6 grid gap-4 sm:grid-cols-2"><Link target="_blank" href="/termos-de-uso" className="rounded-xl border border-blue-200 bg-blue-50 p-5 text-blue-950"><ShieldCheck className="text-blue-700" /><p className="mt-3 font-black">Ler Termos de Uso</p><p className="mt-1 break-all text-xs">Versão {termsVersion}</p></Link><Link target="_blank" href="/politica-de-privacidade" className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-950"><ShieldCheck className="text-emerald-700" /><p className="mt-3 font-black">Ler Política de Privacidade</p><p className="mt-1 break-all text-xs">Versão {privacyVersion}</p></Link></section>
    <label className="mt-6 flex items-start gap-3 rounded-xl border border-slate-300 p-4 text-sm leading-6"><input type="checkbox" checked={accepted} onChange={event => setAccepted(event.target.checked)} className="mt-1 h-5 w-5 shrink-0" /><span>Li e concordo com os Termos de Uso e a Política de Privacidade nas versões identificadas acima.</span></label>
    <label htmlFor="legal-password" className="mt-5 block text-sm font-bold">Confirme sua senha atual<input id="legal-password" type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-300 p-3 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" /></label>
    <button disabled={busy || !accepted || !password} onClick={() => void submit()} className="mt-5 w-full rounded-xl bg-blue-700 px-5 py-3 font-black text-white disabled:opacity-40">Registrar aceite e continuar</button>
    <button onClick={() => void logoutAndRedirect()} className="mx-auto mt-5 flex items-center gap-2 text-sm font-bold text-slate-500"><LogOut size={16} /> Sair sem aceitar</button>
  </div></main>;
}
