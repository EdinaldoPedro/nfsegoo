'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Lock, CheckCircle, Loader2, AlertTriangle, ArrowLeft, KeyRound } from 'lucide-react';
import Link from 'next/link';
import AuthRecoveryShell from '@/components/AuthRecoveryShell';

function ResetForm() {
  const router = useRouter();
  const [token, setToken] = useState<string | null | undefined>(undefined);

  const [senha1, setSenha1] = useState('');
  const [senha2, setSenha2] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    const candidate = new URLSearchParams(window.location.hash.slice(1)).get('token');
    setToken(candidate && /^[a-f0-9]{64}$/.test(candidate) ? candidate : null);
    // Fragments are not sent to the server or Referrer header. Remove it from
    // visible history once captured so screenshots/copying the URL do not leak it.
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
  }, []);

  if (token === undefined) return <div role="status" className="flex items-center justify-center gap-2 py-10 text-sm font-bold text-slate-500"><Loader2 size={18} className="animate-spin" /> Validando link...</div>;

  if (!token) {
    return (
      <div className="py-3 text-center">
        <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-red-100 text-red-600 ring-8 ring-red-50"><AlertTriangle size={32} /></div>
        <h2 className="text-2xl font-black text-slate-950">Link inválido ou incompleto</h2>
        <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-slate-500">Solicite uma nova recuperação para receber um link válido e individual.</p>
        <Link href="/recuperar-senha" className="mt-6 flex w-full items-center justify-center rounded-xl bg-blue-600 px-5 py-3.5 text-sm font-black text-white shadow-lg shadow-blue-200 transition hover:bg-blue-700">Solicitar novo link</Link>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');

    const isSenhaForte = senha1.length >= 8 && /[A-Z]/.test(senha1) && /[0-9]/.test(senha1) && /[^A-Za-z0-9]/.test(senha1);
    if (senha1 !== senha2) {
      setStatus('error');
      setErrorMessage('As senhas nao coincidem.');
      return;
    }
    if (!isSenhaForte) {
      setStatus('error');
      setErrorMessage('A senha deve ter pelo menos 8 caracteres, 1 letra maiuscula, 1 numero e 1 caractere especial.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, senha: senha1 }),
      });

      const data = await res.json().catch(() => ({}));
      if (res.ok) setStatus('success');
      else {
        setStatus('error');
        setErrorMessage(data.error || 'O token expirou ou e invalido. Solicite uma nova recuperacao.');
      }
    } catch {
      setStatus('error');
      setErrorMessage('Erro de conexao. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  if (status === 'success') {
    return (
      <div className="animate-in fade-in zoom-in py-3 text-center">
        <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-600 ring-8 ring-emerald-50">
          <CheckCircle size={32} />
        </div>
        <p className="text-xs font-black uppercase tracking-[0.2em] text-emerald-600">Acesso protegido</p>
        <h2 className="mt-2 text-3xl font-black tracking-tight text-slate-950">Senha alterada</h2>
        <p className="mt-3 text-sm leading-6 text-slate-500">Sua senha foi atualizada e os acessos anteriores foram encerrados. Entre novamente para continuar.</p>
        <button onClick={() => router.push('/login')} className="mt-6 w-full rounded-xl bg-blue-600 px-5 py-3.5 text-sm font-black text-white shadow-lg shadow-blue-200 transition hover:bg-blue-700">
          Fazer login agora
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <label htmlFor="new-password" className="mb-2 block text-sm font-bold text-slate-700">Nova senha</label>
        <div className="relative">
          <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={19} />
          <input
            id="new-password"
            type="password"
            autoComplete="new-password"
            maxLength={72}
            required
            className="w-full rounded-xl border border-slate-300 bg-white py-3.5 pl-11 pr-4 text-slate-900 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
            placeholder="Mínimo de 8 caracteres"
            value={senha1}
            onChange={(e) => setSenha1(e.target.value)}
          />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs font-bold text-slate-400">
          <span className={senha1.length >= 8 ? 'text-emerald-600' : ''}>• 8+ caracteres</span>
          <span className={/[A-Z]/.test(senha1) ? 'text-emerald-600' : ''}>• 1 maiúscula</span>
          <span className={/[0-9]/.test(senha1) ? 'text-emerald-600' : ''}>• 1 número</span>
          <span className={/[^A-Za-z0-9]/.test(senha1) ? 'text-emerald-600' : ''}>• 1 caractere especial</span>
        </div>
      </div>
      <div>
        <label htmlFor="confirm-password" className="mb-2 block text-sm font-bold text-slate-700">Confirmar nova senha</label>
        <div className="relative">
          <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={19} />
          <input
            id="confirm-password"
            type="password"
            autoComplete="new-password"
            maxLength={72}
            required
            className="w-full rounded-xl border border-slate-300 bg-white py-3.5 pl-11 pr-4 text-slate-900 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
            placeholder="Repita a senha"
            value={senha2}
            onChange={(e) => setSenha2(e.target.value)}
          />
        </div>
      </div>

      {status === 'error' && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">
          {errorMessage || 'O token expirou ou e invalido. Solicite uma nova recuperacao.'}
        </div>
      )}

      <button
        disabled={loading}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-3.5 text-sm font-black text-white shadow-lg shadow-blue-200 transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-70"
      >
        {loading ? <Loader2 className="animate-spin" /> : 'Salvar nova senha'}
      </button>
    </form>
  );
}

export default function RedefinirSenhaPage() {
  return (
    <AuthRecoveryShell>
        <Link href="/login" className="mb-7 flex w-fit items-center gap-2 text-sm font-bold text-slate-500 transition hover:text-blue-700"><ArrowLeft size={16} /> Voltar ao login</Link>
        <div className="mb-8">
          <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-blue-50 text-blue-600 ring-1 ring-blue-100"><KeyRound size={24} /></div>
          <p className="text-xs font-black uppercase tracking-[0.2em] text-blue-600">Segurança da conta</p>
          <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-950">Criar nova senha</h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">Escolha uma senha forte e diferente da anterior.</p>
        </div>
        <ResetForm />
    </AuthRecoveryShell>
  );
}
