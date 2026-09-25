'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Mail, ArrowLeft, CheckCircle, Loader2, AlertCircle, KeyRound, Send } from 'lucide-react';
import AuthRecoveryShell from '@/components/AuthRecoveryShell';

export default function RecuperarSenha() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sucesso, setSucesso] = useState(false);
  const [erro, setErro] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErro('');

    try {
      const response = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setErro(data.error || 'Nao foi possivel enviar o e-mail agora. Tente novamente.');
        return;
      }

      setSucesso(true);
    } catch (e) {
      setErro('Erro ao conectar. Verifique sua internet e tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  const resetarTentativa = () => {
    setSucesso(false);
    setErro('');
  };

  return (
    <AuthRecoveryShell>
        <Link href="/login" className="mb-7 flex w-fit items-center gap-2 text-sm font-bold text-slate-500 transition hover:text-blue-700">
          <ArrowLeft size={16} /> Voltar ao login
        </Link>

        {sucesso ? (
          <div className="animate-in fade-in zoom-in py-3 text-center">
            <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-600 ring-8 ring-emerald-50">
              <CheckCircle size={32} />
            </div>
            <p className="text-xs font-black uppercase tracking-[0.2em] text-emerald-600">Solicitação protegida</p>
            <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-950">Confira seu e-mail</h1>
            <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-slate-500">
              Se houver uma conta elegível para <strong>{email}</strong>, você receberá as instruções de recuperação. Confira também a pasta de spam.
            </p>
            <div className="mt-6 rounded-2xl border border-blue-100 bg-blue-50 p-4 text-left text-xs leading-5 text-blue-900">
              Por segurança, não informamos se o endereço está cadastrado. O link enviado é individual e possui prazo de validade.
            </div>
            <Link href="/login" className="mt-6 inline-flex w-full items-center justify-center rounded-xl bg-blue-600 px-5 py-3.5 text-sm font-black text-white shadow-lg shadow-blue-200 transition hover:bg-blue-700">
              Voltar ao login
            </Link>
            <button onClick={resetarTentativa} className="mt-4 text-sm font-bold text-blue-600 transition hover:text-blue-800">
              Tentar outro e-mail
            </button>
          </div>
        ) : (
          <>
            <div className="mb-8">
              <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-blue-50 text-blue-600 ring-1 ring-blue-100">
                <KeyRound size={24} />
              </div>
              <p className="text-xs font-black uppercase tracking-[0.2em] text-blue-600">Acesso à conta</p>
              <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-950">Recuperar senha</h1>
              <p className="mt-2 text-sm leading-6 text-slate-500">Informe o e-mail da sua conta. Enviaremos um link seguro para você criar uma nova senha.</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label htmlFor="recovery-email" className="mb-2 block text-sm font-bold text-slate-700">E-mail cadastrado</label>
                <div className="relative">
                  <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={19} />
                  <input
                    id="recovery-email"
                    autoComplete="email"
                    maxLength={254}
                    type="email"
                    required
                    className="w-full rounded-xl border border-slate-300 bg-white py-3.5 pl-11 pr-4 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                    placeholder="seu@email.com"
                    value={email}
                    onChange={e => {
                      setEmail(e.target.value);
                      if (erro) setErro('');
                    }}
                  />
                </div>
              </div>

              {erro && (
                <div role="alert" className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">
                  <AlertCircle size={18} className="mt-0.5 shrink-0" />
                  <span>{erro}</span>
                </div>
              )}

              <button
                disabled={loading}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-3.5 text-sm font-black text-white shadow-lg shadow-blue-200 transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {loading ? <><Loader2 className="animate-spin" size={19} /> Enviando...</> : <><Send size={18} /> Enviar link de recuperação</>}
              </button>
            </form>
          </>
        )}
    </AuthRecoveryShell>
  );
}
