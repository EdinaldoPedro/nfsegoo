'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowRight,
  Eye,
  EyeOff,
  FileCheck2,
  LockKeyhole,
  Mail,
  ShieldCheck,
  Sparkles,
  UserRoundCheck,
} from 'lucide-react';

export default function Login() {
  const router = useRouter();
  const [form, setForm] = useState({ login: '', senha: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = async (e: any) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const resposta = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });

      const dados = await resposta.json();

      if (!resposta.ok) {
        setError(dados.error || 'Erro ao fazer login');
        setLoading(false);
        return;
      }

      localStorage.clear();
      localStorage.setItem('userId', dados.user.id);
      localStorage.setItem('userRole', dados.user.role);

      if (dados.user.email.startsWith('reset_')) {
        router.push('/verificar-email');
        return;
      }

      if (['ADMIN', 'MASTER', 'SUPORTE', 'SUPORTE_TI'].includes(dados.user.role)) {
        router.push('/admin/dashboard');
      } else if (dados.user.role === 'CONTADOR') {
        router.push('/contador');
      } else {
        router.push('/cliente/dashboard');
      }
    } catch (err) {
      setError('Ocorreu um erro inesperado.');
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-950 text-slate-900 selection:bg-blue-200 selection:text-blue-950">
      <div className="grid min-h-screen lg:grid-cols-[1.08fr_0.92fr]">
        <section className="relative hidden overflow-hidden bg-slate-950 px-10 py-10 text-white lg:flex lg:flex-col lg:justify-between">
          <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.055)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.055)_1px,transparent_1px)] bg-[size:42px_42px]" />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_15%,rgba(37,99,235,0.38),transparent_32%),radial-gradient(circle_at_86%_76%,rgba(16,185,129,0.24),transparent_30%)]" />

          <div className="relative z-10 flex items-center gap-3">
            <img src="/icons/G.png" alt="NFSeGoo" className="h-11 w-11 object-contain" />
            <div>
              <p className="text-2xl font-black tracking-tight">
                NFSe<span className="font-light text-emerald-300">Goo</span>
              </p>
              <p className="text-xs font-bold uppercase tracking-[0.28em] text-blue-200">Portal de emissão</p>
            </div>
          </div>

          <div className="relative z-10 max-w-2xl py-12">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm font-bold text-blue-50 backdrop-blur">
              <Sparkles size={16} className="text-emerald-300" />
              NFS-e nacional, clientes e certificados no mesmo painel
            </div>

            <h1 className="text-5xl font-black leading-[1.02] tracking-tight xl:text-6xl">
              Rotina fiscal com cara de produto moderno.
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-8 text-slate-300">
              Acesse sua operação para emitir notas, acompanhar limites, manter cadastros sincronizados e gerenciar empresas com segurança.
            </p>

            <div className="mt-10 grid max-w-xl grid-cols-3 gap-3">
              <div className="rounded-lg border border-white/10 bg-white/10 p-4 backdrop-blur">
                <FileCheck2 className="mb-5 text-emerald-300" size={24} />
                <p className="text-2xl font-black">NFS-e</p>
                <p className="mt-1 text-xs font-medium text-slate-300">Emissão integrada</p>
              </div>
              <div className="rounded-lg border border-white/10 bg-white/10 p-4 backdrop-blur">
                <ShieldCheck className="mb-5 text-blue-300" size={24} />
                <p className="text-2xl font-black">A1</p>
                <p className="mt-1 text-xs font-medium text-slate-300">Certificado seguro</p>
              </div>
              <div className="rounded-lg border border-white/10 bg-white/10 p-4 backdrop-blur">
                <UserRoundCheck className="mb-5 text-amber-300" size={24} />
                <p className="text-2xl font-black">BPO</p>
                <p className="mt-1 text-xs font-medium text-slate-300">Visão contador</p>
              </div>
            </div>
          </div>

          <div className="relative z-10 flex items-center justify-between border-t border-white/10 pt-6 text-sm text-slate-300">
            <span>Ambiente protegido por sessão segura</span>
            <Link href="/" className="font-bold text-white transition hover:text-emerald-300">
              Voltar ao site
            </Link>
          </div>
        </section>

        <section className="flex min-h-screen items-center justify-center bg-slate-50 px-5 py-8 sm:px-8">
          <div className="w-full max-w-md">
            <div className="mb-8 flex items-center justify-between lg:hidden">
              <Link href="/" className="flex items-center gap-3">
                <img src="/icons/G.png" alt="NFSeGoo" className="h-10 w-10 object-contain" />
                <span className="text-2xl font-black tracking-tight text-blue-700">
                  NFSe<span className="font-light text-emerald-500">Goo</span>
                </span>
              </Link>
              <Link href="/" className="text-sm font-bold text-slate-500 hover:text-blue-700">
                Site
              </Link>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-xl shadow-slate-200/70 sm:p-8">
              <div className="mb-8">
                <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                  <LockKeyhole size={24} />
                </div>
                <h2 className="text-3xl font-black tracking-tight text-slate-900">Acessar sistema</h2>
                <p className="mt-2 text-sm leading-6 text-slate-500">
                  Entre para continuar sua emissão de notas e gestão fiscal.
                </p>
              </div>

              {error && (
                <div className="mb-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
                  {error}
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-5">
                <div>
                  <label className="mb-2 block text-sm font-bold text-slate-700">Email ou CPF</label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                    <input
                      type="text"
                      required
                      placeholder="seu@email.com ou 000.000.000-00"
                      className="w-full rounded-lg border border-slate-300 bg-white py-3 pl-10 pr-3 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                      value={form.login}
                      onChange={(e) => setForm({ ...form, login: e.target.value })}
                    />
                  </div>
                </div>

                <div>
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <label className="block text-sm font-bold text-slate-700">Senha</label>
                    <button
                      type="button"
                      onClick={() => router.push('/recuperar-senha')}
                      className="text-xs font-bold text-blue-600 transition hover:text-blue-800"
                    >
                      Esqueceu a senha?
                    </button>
                  </div>
                  <div className="relative">
                    <LockKeyhole className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                    <input
                      type={showPassword ? 'text' : 'password'}
                      required
                      className="w-full rounded-lg border border-slate-300 bg-white py-3 pl-10 pr-12 text-slate-900 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                      value={form.senha}
                      onChange={(e) => setForm({ ...form, senha: e.target.value })}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((value) => !value)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                      aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                    >
                      {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="group flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-5 py-3.5 font-black text-white shadow-lg shadow-blue-200 transition hover:bg-blue-700 hover:shadow-blue-300 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loading ? 'Entrando...' : 'Entrar'}
                  {!loading && <ArrowRight size={18} className="transition group-hover:translate-x-0.5" />}
                </button>
              </form>

              <div className="mt-7 rounded-lg border border-slate-200 bg-slate-50 p-4 text-center text-sm text-slate-600">
                Não tem conta?{' '}
                <Link href="/cadastro" className="font-black text-blue-600 transition hover:text-blue-800">
                  Cadastre-se
                </Link>
              </div>
            </div>

            <p className="mt-6 text-center text-xs font-medium text-slate-400">
              Acesso para clientes, contadores e equipe administrativa.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
