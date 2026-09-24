'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { ShieldCheck, KeyRound, LogOut, Monitor, RefreshCw } from 'lucide-react';
import { checkIsStaff } from '@/app/utils/permissions';
import { logoutAndRedirect, redirectToLogin } from '@/app/utils/client-session';
import AdminAccountNav from '@/components/AdminAccountNav';

type MfaStatus = { enabled: boolean; required: boolean; recoveryCodesRemaining: number };
type Session = { id: string; userAgent: string | null; ipAddress: string | null; createdAt: string; expiresAt: string; current: boolean };
type TrustedDevice = { id: string; method: 'TOTP' | 'EMAIL'; createdAt: string; lastUsedAt: string; expiresAt: string };

export default function SegurancaPage({ adminMode = false }: { adminMode?: boolean }) {
  const [status, setStatus] = useState<MfaStatus | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [trustedDevices, setTrustedDevices] = useState<TrustedDevice[]>([]);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [setup, setSetup] = useState<{ secret: string; qrCode: string } | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [backHref, setBackHref] = useState('/cliente/dashboard');
  const [staff, setStaff] = useState(false);

  const load = async () => {
    const [mfaResponse, sessionsResponse, devicesResponse] = await Promise.all([
      fetch('/api/auth/mfa', { cache: 'no-store' }), fetch('/api/auth/sessions', { cache: 'no-store' }),
      fetch('/api/auth/trusted-devices', { cache: 'no-store' }),
    ]);
    if (!mfaResponse.ok || !sessionsResponse.ok || !devicesResponse.ok) throw new Error('Nao foi possivel carregar as configuracoes.');
    setStatus(await mfaResponse.json());
    setSessions(await sessionsResponse.json());
    setTrustedDevices(await devicesResponse.json());
  };

  const revokeTrusted = async (deviceId?: string) => {
    setBusy(true); setError(''); setMessage('');
    try {
      const response = await fetch('/api/auth/trusted-devices', { method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(deviceId ? { deviceId } : { all: true, password }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Não foi possível remover o dispositivo.');
      await load(); setMessage(deviceId ? 'Dispositivo removido.' : 'Todos os dispositivos confiáveis foram removidos.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Erro de conexão.'); }
    finally { setBusy(false); }
  };

  useEffect(() => {
    const role = localStorage.getItem('userRole');
    setStaff(checkIsStaff(role));
    setBackHref(adminMode ? '/admin/minha-conta' : checkIsStaff(role) ? '/admin/dashboard' : role === 'CONTADOR' ? '/contador' : '/cliente/dashboard');
    void load().catch((cause) => setError(cause.message));
  }, [adminMode]);

  const execute = async (action: string) => {
    setBusy(true); setError(''); setMessage('');
    try {
      const response = await fetch('/api/auth/mfa', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, password, code }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Operacao nao concluida.');
      if (action === 'setup') {
        setSetup({ secret: data.secret, qrCode: data.qrCode });
        setCode('');
        setMessage('Leia o QR code no autenticador e informe o novo codigo. Esta configuracao expira em 10 minutos.');
      } else {
        setSetup(null); setPassword(''); setCode('');
        if (data.recoveryCodes) setRecoveryCodes(data.recoveryCodes);
        setMessage(action === 'disable' ? 'MFA desativado. As outras sessoes foram encerradas.' : 'Configuracao de seguranca atualizada.');
        await load();
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Erro de conexao.'); }
    finally { setBusy(false); }
  };

  const revoke = async (sessionId?: string) => {
    setBusy(true); setError(''); setMessage('');
    try {
      const response = await fetch('/api/auth/sessions', {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sessionId ? { sessionId } : { all: true, password }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Nao foi possivel encerrar a sessao.');
      if (data.requiresLogin) { redirectToLogin('logout'); return; }
      await load(); setMessage('Sessao encerrada.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Erro de conexao.'); }
    finally { setBusy(false); }
  };

  const inputClass = 'mt-2 w-full rounded-xl border border-slate-300 bg-white p-3 text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200';
  const buttonClass = 'rounded-xl bg-blue-700 px-4 py-3 text-sm font-bold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50';

  return (
    <main className={adminMode ? 'text-slate-900' : 'min-h-screen bg-slate-50 px-4 py-8 text-slate-900'}>
      <div className="mx-auto max-w-4xl space-y-6">
        {staff && !adminMode && <AdminAccountNav active="security" />}
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div><p className="text-sm font-bold text-blue-700">{adminMode ? 'Minha conta administrativa' : 'NFSe Goo'}</p><h1 className="mt-1 flex items-center gap-2 text-2xl font-black"><ShieldCheck /> Segurança da conta</h1></div>
          <div className="flex gap-4 text-sm font-bold">
            {(!status?.required || status.enabled) && <Link href={backHref} className="text-blue-700">Voltar ao painel</Link>}
            <button onClick={() => void logoutAndRedirect()} className="flex items-center gap-1 text-slate-600"><LogOut size={16} /> Sair</button>
          </div>
        </header>

        {status?.required && !status.enabled && <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">O autenticador é obrigatório para equipe interna e contadores. Configure-o abaixo antes de acessar dados de clientes.</div>}
        {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</p>}
        {message && <p role="status" className="rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-800">{message}</p>}

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
          <h2 className="flex items-center gap-2 text-xl font-bold"><KeyRound size={22} /> Autenticacao em duas etapas</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">Use um aplicativo autenticador compativel com TOTP. Cada codigo dura 30 segundos e so pode ser usado uma vez. Mantenha o relogio do dispositivo sincronizado.</p>
          <p className="mt-3 text-sm font-bold">Estado: {status ? status.enabled ? 'Ativo' : 'Nao configurado' : 'Carregando...'}{status?.enabled ? ` · ${status.recoveryCodesRemaining} codigos de recuperacao disponiveis` : ''}</p>

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <label htmlFor="security-password" className="text-sm font-bold">Senha atual
              <input id="security-password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} className={inputClass} />
            </label>
            <label htmlFor="security-code" className="text-sm font-bold">{setup ? 'Codigo do novo autenticador' : 'Codigo do autenticador ou de recuperacao'}
              <input id="security-code" autoComplete="one-time-code" maxLength={48} value={code} onChange={(event) => setCode(event.target.value)} className={inputClass} />
            </label>
          </div>

          {setup && <div className="mt-6 rounded-xl border border-blue-200 bg-blue-50 p-4">
            <Image unoptimized src={setup.qrCode} alt="QR code para configurar o autenticador desta conta" width={220} height={220} className="mx-auto rounded-lg bg-white" />
            <p className="mt-3 text-center text-sm">Se nao puder ler o QR code, digite esta chave no aplicativo:</p>
            <p className="mt-2 break-all text-center font-mono text-sm font-bold select-all">{setup.secret}</p>
            <p className="mt-3 text-center text-xs text-blue-900">Nao compartilhe esta chave nem uma captura desta tela.</p>
          </div>}

          <div className="mt-5 flex flex-wrap gap-3">
            {setup ? <button disabled={busy || !password || !code} onClick={() => void execute('enable')} className={buttonClass}>Confirmar novo autenticador</button>
              : <button disabled={busy || !status || !password || (status.enabled && !code)} onClick={() => void execute('setup')} className={buttonClass}>{status?.enabled ? 'Trocar autenticador' : 'Configurar autenticador'}</button>}
            {status?.enabled && !setup && <>
              <button disabled={busy || !password || !code} onClick={() => void execute('recovery-codes')} className={buttonClass}>Renovar codigos de recuperacao</button>
              {!status.required && <button disabled={busy || !password || !code} onClick={() => void execute('disable')} className="rounded-xl border border-red-300 px-4 py-3 text-sm font-bold text-red-700 disabled:opacity-50">Desativar MFA</button>}
            </>}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
          <h2 className="flex items-center gap-2 text-xl font-bold"><ShieldCheck size={22} /> Dispositivos confiáveis</h2>
          <p className="mt-2 text-sm text-slate-600">A validação pelo aplicativo vale 7 dias; pelo e-mail, 24 horas. O prazo é fixo e não é renovado a cada acesso.</p>
          {trustedDevices.length === 0 ? <p className="mt-4 text-sm text-slate-500">Nenhum dispositivo confiável ativo.</p> : (
            <ul className="mt-4 divide-y divide-slate-200">{trustedDevices.map(device => <li key={device.id} className="flex items-center justify-between gap-4 py-4">
              <div><p className="text-sm font-bold">Validado por {device.method === 'EMAIL' ? 'e-mail' : 'aplicativo autenticador'}</p>
                <p className="mt-1 text-xs text-slate-500">Último uso: {new Date(device.lastUsedAt).toLocaleString('pt-BR')} · Expira: {new Date(device.expiresAt).toLocaleString('pt-BR')}</p></div>
              <button disabled={busy} onClick={() => void revokeTrusted(device.id)} className="rounded-lg border border-red-200 px-3 py-2 text-sm font-bold text-red-700 disabled:opacity-50">Remover</button>
            </li>)}</ul>
          )}
          {trustedDevices.length > 0 && <button disabled={busy || !password} onClick={() => void revokeTrusted()} className="mt-4 rounded-xl border border-red-300 px-4 py-3 text-sm font-bold text-red-700 disabled:opacity-50">Remover todos (confirme a senha acima)</button>}
        </section>

        {recoveryCodes.length > 0 && <section className="rounded-2xl border border-amber-300 bg-amber-50 p-5">
          <h2 className="text-lg font-bold">Guarde seus codigos de recuperacao</h2>
          <p className="mt-2 text-sm leading-6">Eles aparecem somente agora. Guarde-os em um gerenciador de senhas ou local seguro, separado do autenticador. Cada codigo funciona uma unica vez. Os codigos anteriores deixaram de funcionar.</p>
          <ul className="mt-4 grid gap-2 font-mono text-xs sm:grid-cols-2">{recoveryCodes.map((value) => <li key={value} className="break-all rounded bg-white p-2 select-all">{value}</li>)}</ul>
          <button onClick={() => setRecoveryCodes([])} className="mt-4 rounded-xl bg-amber-900 px-4 py-2 text-sm font-bold text-white">Ja guardei os codigos</button>
        </section>}

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
          <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="flex items-center gap-2 text-xl font-bold"><Monitor size={22} /> Sessoes ativas</h2><button onClick={() => void load().catch((cause) => setError(cause.message))} className="flex items-center gap-1 text-sm font-bold text-blue-700"><RefreshCw size={16} /> Atualizar</button></div>
          <p className="mt-2 text-sm text-slate-600">Encerre dispositivos que nao reconhece. O acesso expira automaticamente em ate oito horas.</p>
          <ul className="mt-4 divide-y divide-slate-200">{sessions.map((session) => <li key={session.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0"><p className="break-words text-sm font-bold">{session.current ? 'Este dispositivo' : 'Outro dispositivo'}</p><p className="mt-1 break-all text-xs text-slate-500">{session.userAgent || 'Navegador nao informado'}</p><p className="mt-1 text-xs text-slate-500">IP: {session.ipAddress || 'Nao informado'} · Inicio: {new Date(session.createdAt).toLocaleString('pt-BR')}</p></div>
            <button disabled={busy} onClick={() => void revoke(session.id)} className="shrink-0 rounded-lg border border-red-200 px-3 py-2 text-sm font-bold text-red-700 disabled:opacity-50">Encerrar sessao</button>
          </li>)}</ul>
          <button disabled={busy || !password} onClick={() => void revoke()} className="mt-4 rounded-xl border border-red-300 px-4 py-3 text-sm font-bold text-red-700 disabled:opacity-50">Encerrar todas as sessoes (confirme a senha acima)</button>
        </section>
      </div>
    </main>
  );
}
