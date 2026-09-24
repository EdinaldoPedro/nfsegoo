'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { CheckCircle2, KeyRound, Mail, RefreshCw, Save, UserRound } from 'lucide-react';
import { redirectToLogin } from '@/app/utils/client-session';

type Profile = { nome: string; email: string; cpf: string | null; telefone: string | null; cargo: string | null;
  configuracoes?: { darkMode?: boolean; idioma?: string; notificacoesEmail?: boolean } };

const field = 'mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-50';
const button = 'inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-sm font-bold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50';

async function readResult(response: Response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Não foi possível concluir a operação.');
  return data;
}

export default function AdminAccountDetailsPage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [emailStep, setEmailStep] = useState<'closed' | 'send' | 'confirm'>('closed');
  const [emailForm, setEmailForm] = useState({ newEmail: '', password: '', code: '' });
  const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });

  useEffect(() => {
    let active = true;
    fetch('/api/perfil?escopo=CONTA', { cache: 'no-store' }).then(readResult).then(data => {
      if (active) setProfile({ nome: data.nome || '', email: data.email || '', cpf: data.cpf || null,
        telefone: data.telefone || '', cargo: data.cargo || '', configuracoes: data.configuracoes });
    }).catch(cause => { if (active) setError(cause.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  async function saveProfile(event: FormEvent) {
    event.preventDefault(); if (!profile || busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await readResult(await fetch('/api/perfil', { method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ escopo: 'CONTA', nome: profile.nome, telefone: profile.telefone || '', cargo: profile.cargo || '' }) }));
      setNotice('Dados da conta salvos.');
    } catch (cause) { setError((cause as Error).message); } finally { setBusy(false); }
  }

  async function sendEmail(event: FormEvent) {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await readResult(await fetch('/api/auth/verify-email/send', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newEmail: emailForm.newEmail, password: emailForm.password }) }));
      setEmailForm(previous => ({ ...previous, password: '' })); setEmailStep('confirm');
      setNotice('Enviamos um código ao novo e-mail. Ele expira em 15 minutos.');
    } catch (cause) { setError((cause as Error).message); } finally { setBusy(false); }
  }

  async function confirmEmail(event: FormEvent) {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await readResult(await fetch('/api/auth/verify-email/confirm', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: emailForm.code }) }));
      redirectToLogin('logout');
    } catch (cause) { setError((cause as Error).message); setBusy(false); }
  }

  async function changePassword(event: FormEvent) {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await readResult(await fetch('/api/auth/change-password', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(passwordForm) }));
      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
      if (result.requiresLogin) { redirectToLogin('logout'); return; }
      setNotice(result.message || 'Senha alterada.');
    } catch (cause) { setError((cause as Error).message); } finally { setBusy(false); }
  }

  return <div className="mx-auto max-w-5xl space-y-6 text-slate-900">
    <div><p className="text-xs font-black uppercase tracking-[0.18em] text-blue-700">Dados e senha</p><h2 className="mt-1 text-2xl font-black">Seu perfil administrativo</h2><p className="mt-1 text-sm text-slate-500">Atualize seus dados de contato e as credenciais da sua própria conta.</p></div>
    {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-800">{error}</p>}
    {notice && <p role="status" className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-800"><CheckCircle2 size={18} />{notice}</p>}
    {loading ? <p role="status" className="rounded-2xl bg-white p-6 text-sm text-slate-500">Carregando dados da conta…</p> : profile ? <>
      <form onSubmit={saveProfile} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
        <div className="flex items-center gap-3"><span className="rounded-xl bg-blue-50 p-2.5 text-blue-700"><UserRound size={21} /></span><div><h3 className="text-lg font-black">Dados pessoais</h3><p className="text-sm text-slate-500">Informações da sua conta interna.</p></div></div>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-bold">Nome<input className={field} required minLength={2} maxLength={160} value={profile.nome} onChange={event => setProfile({ ...profile, nome: event.target.value })} /></label>
          <label className="text-sm font-bold">CPF<input className={field} disabled value={profile.cpf || ''} /></label>
          <label className="text-sm font-bold">Telefone<input className={field} type="tel" maxLength={30} value={profile.telefone || ''} onChange={event => setProfile({ ...profile, telefone: event.target.value })} /></label>
          <label className="text-sm font-bold">Cargo<input className={field} maxLength={100} value={profile.cargo || ''} onChange={event => setProfile({ ...profile, cargo: event.target.value })} /></label>
        </div>
        <button type="submit" disabled={busy} className={`${button} mt-6`}><Save size={17} />{busy ? 'Salvando…' : 'Salvar dados'}</button>
      </form>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
        <div className="flex items-center gap-3"><span className="rounded-xl bg-blue-50 p-2.5 text-blue-700"><Mail size={21} /></span><div><h3 className="text-lg font-black">E-mail de acesso</h3><p className="text-sm text-slate-500">Atual: {profile.email}</p></div></div>
        {emailStep === 'closed' ? <button type="button" onClick={() => { setEmailStep('send'); setError(''); }} className="mt-5 rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-bold hover:bg-slate-50">Alterar e-mail</button> :
          <form onSubmit={emailStep === 'send' ? sendEmail : confirmEmail} className="mt-5 space-y-4">
            {emailStep === 'send' ? <div className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-bold">Novo e-mail<input className={field} type="email" required maxLength={254} autoComplete="email" value={emailForm.newEmail} onChange={event => setEmailForm({ ...emailForm, newEmail: event.target.value })} /></label><label className="text-sm font-bold">Senha atual<input className={field} type="password" required autoComplete="current-password" value={emailForm.password} onChange={event => setEmailForm({ ...emailForm, password: event.target.value })} /></label></div> :
              <label className="block max-w-sm text-sm font-bold">Código enviado para {emailForm.newEmail}<input className={field} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={emailForm.code} onChange={event => setEmailForm({ ...emailForm, code: event.target.value.replace(/\D/g, '') })} /></label>}
            <div className="flex flex-wrap gap-2"><button type="submit" disabled={busy} className={button}>{emailStep === 'send' ? 'Enviar código' : 'Confirmar e-mail'}</button><button type="button" onClick={() => { setEmailStep('closed'); setEmailForm({ newEmail: '', password: '', code: '' }); setError(''); }} className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-bold hover:bg-slate-50">Cancelar</button>{emailStep === 'confirm' && <button type="button" onClick={() => setEmailStep('send')} className="inline-flex items-center gap-1 rounded-xl px-3 py-2 text-sm font-bold text-blue-700"><RefreshCw size={15} />Reenviar</button>}</div>
          </form>}
      </section>

      <form onSubmit={changePassword} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
        <div className="flex items-center gap-3"><span className="rounded-xl bg-blue-50 p-2.5 text-blue-700"><KeyRound size={21} /></span><div><h3 className="text-lg font-black">Senha de acesso</h3><p className="text-sm text-slate-500">Ao alterar a senha, todas as sessões serão encerradas.</p></div></div>
        <div className="mt-6 grid gap-4 sm:grid-cols-2"><label className="text-sm font-bold sm:col-span-2">Senha atual<input className={field} type="password" required autoComplete="current-password" value={passwordForm.currentPassword} onChange={event => setPasswordForm({ ...passwordForm, currentPassword: event.target.value })} /></label><label className="text-sm font-bold">Nova senha<input className={field} type="password" required autoComplete="new-password" value={passwordForm.newPassword} onChange={event => setPasswordForm({ ...passwordForm, newPassword: event.target.value })} /></label><label className="text-sm font-bold">Confirmar nova senha<input className={field} type="password" required autoComplete="new-password" value={passwordForm.confirmPassword} onChange={event => setPasswordForm({ ...passwordForm, confirmPassword: event.target.value })} /></label></div>
        <p className="mt-3 text-xs text-slate-500">Mínimo de 8 caracteres, incluindo uma letra maiúscula, um número e um caractere especial.</p>
        <button type="submit" disabled={busy || passwordForm.newPassword !== passwordForm.confirmPassword} className={`${button} mt-5`}><KeyRound size={17} />Alterar senha</button>
      </form>
    </> : null}
  </div>;
}
