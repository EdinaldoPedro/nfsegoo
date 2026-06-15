'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Mail, ArrowLeft, CheckCircle, Loader2, AlertCircle } from 'lucide-react';

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
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-md p-8 rounded-2xl shadow-xl border border-slate-100">
        <Link href="/login" className="text-slate-400 hover:text-slate-600 flex items-center gap-2 text-sm font-bold mb-6 transition">
          <ArrowLeft size={16} /> Voltar para Login
        </Link>

        {sucesso ? (
          <div className="text-center py-8 animate-in fade-in zoom-in">
            <div className="bg-green-100 text-green-600 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
              <CheckCircle size={32} />
            </div>
            <h2 className="text-2xl font-bold text-slate-800 mb-2">E-mail enviado</h2>
            <p className="text-slate-500 mb-6">
              Enviamos um link para <strong>{email}</strong>. Abra seu e-mail e siga as instrucoes para redefinir sua senha.
            </p>
            <button onClick={resetarTentativa} className="text-blue-600 font-bold hover:underline">
              Tentar outro e-mail
            </button>
          </div>
        ) : (
          <>
            <div className="mb-6">
              <h1 className="text-2xl font-bold text-slate-800 mb-2">Recuperar senha</h1>
              <p className="text-slate-500 text-sm">Digite o e-mail cadastrado para receber o link de redefinicao.</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">E-mail cadastrado</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-3 text-slate-400" size={20} />
                  <input
                    type="email"
                    required
                    className="w-full pl-10 p-3 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none transition"
                    placeholder="ex: seu@email.com"
                    value={email}
                    onChange={e => {
                      setEmail(e.target.value);
                      if (erro) setErro('');
                    }}
                  />
                </div>
              </div>

              {erro && (
                <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  <AlertCircle size={18} className="mt-0.5 shrink-0" />
                  <span>{erro}</span>
                </div>
              )}

              <button
                disabled={loading}
                className="w-full bg-blue-600 text-white py-3 rounded-lg font-bold hover:bg-blue-700 transition flex items-center justify-center gap-2 shadow-lg disabled:opacity-70"
              >
                {loading ? <Loader2 className="animate-spin" /> : 'Enviar link de recuperacao'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
