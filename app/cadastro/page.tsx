'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { validarCPF } from '@/app/utils/cpf';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Building2,
  CheckCircle,
  Eye,
  EyeOff,
  FileText,
  KeyRound,
  Loader2,
  Lock,
  Mail,
  ShieldCheck,
  Sparkles,
  User,
} from 'lucide-react';

export default function Cadastro() {
  const router = useRouter();

  const [step, setStep] = useState(1); // 1 = Form, 2 = Validação

  const [form, setForm] = useState({
    nome: '',
    email: '',
    confirmEmail: '',
    senha: '',
    confirmSenha: '',
    cpf: '',
  });
  const [code, setCode] = useState('');

  const [errors, setErrors] = useState<any>({});
  const [loading, setLoading] = useState(false);
  const [serverError, setServerError] = useState('');
  const [showSenha, setShowSenha] = useState(false);
  const [showConfirmSenha, setShowConfirmSenha] = useState(false);

  const inputBase = 'w-full rounded-2xl border bg-white px-4 py-3.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:ring-4';
  const inputDefault = 'border-slate-200 focus:border-blue-500 focus:ring-blue-100';
  const inputError = 'border-red-400 focus:border-red-500 focus:ring-red-100';
  const iconClass = 'absolute left-4 top-1/2 -translate-y-1/2 text-slate-400';

  const validateField = (name: string, value: string, currentForm: any) => {
    let error = '';

    if (name === 'nome') {
      const regexNome = /^[a-zA-ZÀ-ÿ\s^~]+$/;
      if (value.length > 0 && value.trim().length < 15) error = 'Mínimo 15 caracteres.';
      else if (value.length > 0 && !regexNome.test(value)) error = 'Apenas letras e acentos permitidos.';
    }

    if (name === 'senha') {
      const isSenhaForte = value.length >= 8 && /[A-Z]/.test(value) && /[0-9]/.test(value) && /[^A-Za-z0-9]/.test(value);
      if (value.length > 0 && !isSenhaForte) {
        error = 'Mín. 8 caracteres, 1 maiúscula, 1 número e 1 especial.';
      }
    }

    setErrors((prev: any) => ({ ...prev, [name]: error }));

    if (name === 'email' || name === 'confirmEmail') {
      const emailToCompare = name === 'email' ? value : currentForm.email;
      const confirmToCompare = name === 'confirmEmail' ? value : currentForm.confirmEmail;

      if (confirmToCompare.length > 0 && emailToCompare !== confirmToCompare) {
        setErrors((prev: any) => ({ ...prev, confirmEmail: 'Os e-mails não coincidem.' }));
      } else {
        setErrors((prev: any) => ({ ...prev, confirmEmail: '' }));
      }
    }

    if (name === 'senha' || name === 'confirmSenha') {
      const senhaToCompare = name === 'senha' ? value : currentForm.senha;
      const confirmToCompare = name === 'confirmSenha' ? value : currentForm.confirmSenha;

      if (confirmToCompare.length > 0 && senhaToCompare !== confirmToCompare) {
        setErrors((prev: any) => ({ ...prev, confirmSenha: 'As senhas não coincidem.' }));
      } else {
        setErrors((prev: any) => ({ ...prev, confirmSenha: '' }));
      }
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    const updatedForm = { ...form, [name]: value };
    setForm(updatedForm);
    validateField(name, value, updatedForm);
    setServerError('');
  };

  const handleCpfChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let value = e.target.value.replace(/\D/g, '');
    if (value.length > 11) value = value.slice(0, 11);
    value = value.replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2');

    setForm({ ...form, cpf: value });
    setErrors((prev: any) => ({ ...prev, cpf: '' }));
  };

  const checkCpfExist = async () => {
    if (!form.cpf) return;
    if (!validarCPF(form.cpf)) {
      setErrors((prev: any) => ({ ...prev, cpf: 'CPF inválido.' }));
      return;
    }

    try {
      const res = await fetch('/api/auth/check', {
        method: 'POST',
        body: JSON.stringify({ cpf: form.cpf }),
      });
      const data = await res.json();
      if (data.errors?.cpf) setErrors((prev: any) => ({ ...prev, cpf: data.errors.cpf }));
    } catch (e) {}
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (errors.nome || errors.senha || errors.cpf || errors.confirmEmail || errors.confirmSenha) return;
    if (form.nome.length < 15) {
      setErrors((p: any) => ({ ...p, nome: 'Mínimo 15 caracteres.' }));
      return;
    }

    if (form.email !== form.confirmEmail) {
      setErrors((p: any) => ({ ...p, confirmEmail: 'Os e-mails não coincidem.' }));
      return;
    }
    if (form.senha !== form.confirmSenha) {
      setErrors((p: any) => ({ ...p, confirmSenha: 'As senhas não coincidem.' }));
      return;
    }

    setLoading(true);
    setServerError('');

    const { confirmEmail, confirmSenha, ...dadosParaEnviar } = form;

    try {
      const res = await fetch('/api/auth/cadastro', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dadosParaEnviar),
      });

      const data = await res.json();

      if (res.ok) {
        setStep(2);
      } else {
        setServerError(data.error || 'Erro ao cadastrar.');
      }
    } catch (err) {
      setServerError('Erro de conexão com o servidor.');
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch('/api/auth/confirm-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: form.email, code }),
      });
      const data = await res.json();

      if (res.ok) {
        localStorage.setItem('userId', data.user.id);
        localStorage.setItem('userRole', data.user.role);
        router.push('/cliente/dashboard');
      } else {
        setServerError(data.error || 'Código inválido');
      }
    } catch (e) {
      setServerError('Erro de conexão.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#f5f8fc] text-slate-950">
      <div className="grid min-h-screen lg:grid-cols-[minmax(360px,0.9fr)_minmax(620px,1.1fr)]">
        <aside className="relative hidden overflow-hidden bg-[#071831] px-10 py-9 text-white lg:flex lg:flex-col lg:justify-between">
          <div className="absolute inset-0 bg-[linear-gradient(145deg,rgba(37,99,235,0.32),transparent_42%),radial-gradient(circle_at_82%_16%,rgba(14,165,233,0.22),transparent_34%)]" />
          <div className="absolute inset-0 opacity-[0.08] [background-image:linear-gradient(rgba(255,255,255,.8)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.8)_1px,transparent_1px)] [background-size:44px_44px]" />

          <div className="relative z-10">
            <Link href="/login" className="inline-flex items-center gap-3">
              <img src="/icons/G.png" alt="NFSe Goo" className="h-11 w-11 rounded-2xl bg-white p-1.5 shadow-lg" />
              <div>
                <p className="text-lg font-black leading-none">NFSe Goo</p>
                <p className="mt-1 text-xs font-semibold uppercase tracking-[0.24em] text-blue-200">Emissão simples</p>
              </div>
            </Link>

            <div className="mt-20 max-w-md">
              <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-bold text-blue-100">
                <Sparkles size={14} />
                Cadastro seguro para empresas e profissionais
              </div>
              <h1 className="text-4xl font-black leading-tight">
                Comece a emitir NFS-e com uma conta protegida.
              </h1>
              <p className="mt-5 text-base leading-7 text-slate-300">
                Organize clientes, serviços, certificados e notas em uma rotina fiscal mais clara, pronta para o uso diário.
              </p>
            </div>
          </div>

          <div className="relative z-10 grid gap-3">
            <div className="rounded-2xl border border-white/10 bg-white/10 p-4 backdrop-blur">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/20 text-blue-100">
                  <ShieldCheck size={20} />
                </span>
                <div>
                  <p className="text-sm font-bold">Verificação por e-mail</p>
                  <p className="text-xs text-slate-300">Mais segurança antes do primeiro acesso.</p>
                </div>
              </div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/10 p-4 backdrop-blur">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-400/15 text-emerald-100">
                  <Building2 size={20} />
                </span>
                <div>
                  <p className="text-sm font-bold">Pronto para PF e PJ</p>
                  <p className="text-xs text-slate-300">Cadastro preparado para o fluxo do SaaS.</p>
                </div>
              </div>
            </div>
          </div>
        </aside>

        <section className="flex min-h-screen items-center justify-center px-4 py-8 sm:px-6 lg:px-10">
          <div className="w-full max-w-3xl">
            <div className="mb-7 flex items-center justify-between gap-4 lg:hidden">
              <Link href="/login" className="inline-flex items-center gap-3">
                <img src="/icons/G.png" alt="NFSe Goo" className="h-10 w-10 rounded-2xl bg-white p-1.5 shadow-sm" />
                <span className="font-black">NFSe Goo</span>
              </Link>
              <Link href="/login" className="text-sm font-bold text-blue-700 hover:text-blue-800">
                Entrar
              </Link>
            </div>

            <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
              <div>
                <Link href="/" className="mb-4 inline-flex items-center gap-2 text-sm font-bold text-slate-500 transition hover:text-blue-700">
                  <ArrowLeft size={16} />
                  Voltar ao site
                </Link>
                <p className="text-sm font-bold uppercase tracking-[0.22em] text-blue-600">Criar acesso</p>
                <h2 className="mt-2 text-3xl font-black tracking-tight text-slate-950 sm:text-4xl">
                  {step === 1 ? 'Cadastro da conta' : 'Verificação de segurança'}
                </h2>
                <p className="mt-2 text-sm text-slate-600">
                  {step === 1 ? 'Preencha seus dados para liberar o acesso ao sistema.' : `Enviamos um código para ${form.email}.`}
                </p>
              </div>

              <div className="hidden rounded-full border border-slate-200 bg-white p-1 shadow-sm sm:flex">
                <span className={`rounded-full px-4 py-2 text-xs font-black ${step === 1 ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-500'}`}>
                  1. Dados
                </span>
                <span className={`rounded-full px-4 py-2 text-xs font-black ${step === 2 ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-500'}`}>
                  2. Código
                </span>
              </div>
            </div>

            <div className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_24px_70px_rgba(15,23,42,0.12)]">
              <div className="border-b border-slate-100 bg-slate-50/70 px-5 py-4 sm:px-8">
                <div className="flex items-center gap-3">
                  <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-600 text-white shadow-lg shadow-blue-600/20">
                    {step === 1 ? <User size={21} /> : <KeyRound size={21} />}
                  </span>
                  <div>
                    <p className="text-sm font-black text-slate-900">
                      {step === 1 ? 'Dados de acesso' : 'Confirme seu e-mail'}
                    </p>
                    <p className="text-xs text-slate-500">
                      {step === 1 ? 'Essas informações serão usadas para identificar seu usuário.' : 'Digite o código recebido para concluir o cadastro.'}
                    </p>
                  </div>
                </div>
              </div>

              <div className="p-5 sm:p-8">
                {serverError && (
                  <div className="mb-6 flex items-center gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">
                    <AlertTriangle size={16} /> {serverError}
                  </div>
                )}

                {step === 1 ? (
                  <form onSubmit={handleSubmit} className="space-y-6">
                    <div className="grid gap-5 md:grid-cols-2">
                      <div className="md:col-span-2">
                        <label className="mb-2 block text-xs font-black uppercase tracking-[0.14em] text-slate-500">Nome completo</label>
                        <div className="relative">
                          <User className={iconClass} size={19} />
                          <input
                            type="text"
                            name="nome"
                            required
                            className={`${inputBase} pl-12 ${errors.nome ? inputError : inputDefault}`}
                            placeholder="Seu nome completo"
                            value={form.nome}
                            onChange={handleChange}
                          />
                        </div>
                        {errors.nome && <p className="mt-1 text-xs text-red-500">{errors.nome}</p>}
                      </div>

                      <div className="md:col-span-2">
                        <label className="mb-2 block text-xs font-black uppercase tracking-[0.14em] text-slate-500">CPF</label>
                        <div className="relative">
                          <FileText className={iconClass} size={19} />
                          <input
                            type="text"
                            name="cpf"
                            required
                            className={`${inputBase} pl-12 ${errors.cpf ? inputError : inputDefault}`}
                            placeholder="000.000.000-00"
                            value={form.cpf}
                            onChange={handleCpfChange}
                            onBlur={checkCpfExist}
                          />
                        </div>
                        {errors.cpf && <p className="mt-1 text-xs text-red-500">{errors.cpf}</p>}
                      </div>

                      <div>
                        <label className="mb-2 block text-xs font-black uppercase tracking-[0.14em] text-slate-500">E-mail</label>
                        <div className="relative">
                          <Mail className={iconClass} size={19} />
                          <input
                            type="email"
                            name="email"
                            required
                            className={`${inputBase} pl-12 ${inputDefault}`}
                            placeholder="seu@email.com"
                            value={form.email}
                            onChange={handleChange}
                          />
                        </div>
                      </div>

                      <div>
                        <label className="mb-2 block text-xs font-black uppercase tracking-[0.14em] text-slate-500">Confirme seu e-mail</label>
                        <div className="relative">
                          <Mail className={iconClass} size={19} />
                          <input
                            type="email"
                            name="confirmEmail"
                            required
                            className={`${inputBase} pl-12 ${errors.confirmEmail ? inputError : inputDefault}`}
                            placeholder="Repita seu e-mail"
                            value={form.confirmEmail}
                            onChange={handleChange}
                          />
                        </div>
                        {errors.confirmEmail && <p className="mt-1 text-xs text-red-500">{errors.confirmEmail}</p>}
                      </div>

                      <div>
                        <label className="mb-2 block text-xs font-black uppercase tracking-[0.14em] text-slate-500">Senha</label>
                        <div className="relative">
                          <Lock className={iconClass} size={19} />
                          <input
                            type={showSenha ? 'text' : 'password'}
                            name="senha"
                            required
                            className={`${inputBase} pl-12 pr-12 ${errors.senha ? inputError : inputDefault}`}
                            placeholder="••••••••"
                            value={form.senha}
                            onChange={handleChange}
                          />
                          <button
                            type="button"
                            onClick={() => setShowSenha(!showSenha)}
                            className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 transition hover:text-blue-600"
                            aria-label={showSenha ? 'Ocultar senha' : 'Mostrar senha'}
                          >
                            {showSenha ? <EyeOff size={20} /> : <Eye size={20} />}
                          </button>
                        </div>
                        {errors.senha && <p className="mt-1 text-xs text-red-500">{errors.senha}</p>}
                        <p className="mt-1 text-xs text-slate-400">Mín. 8 caracteres, 1 maiúscula, 1 número e 1 símbolo.</p>
                      </div>

                      <div>
                        <label className="mb-2 block text-xs font-black uppercase tracking-[0.14em] text-slate-500">Confirme sua senha</label>
                        <div className="relative">
                          <Lock className={iconClass} size={19} />
                          <input
                            type={showConfirmSenha ? 'text' : 'password'}
                            name="confirmSenha"
                            required
                            className={`${inputBase} pl-12 pr-12 ${errors.confirmSenha ? inputError : inputDefault}`}
                            placeholder="Repita sua senha"
                            value={form.confirmSenha}
                            onChange={handleChange}
                          />
                          <button
                            type="button"
                            onClick={() => setShowConfirmSenha(!showConfirmSenha)}
                            className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 transition hover:text-blue-600"
                            aria-label={showConfirmSenha ? 'Ocultar confirmação de senha' : 'Mostrar confirmação de senha'}
                          >
                            {showConfirmSenha ? <EyeOff size={20} /> : <Eye size={20} />}
                          </button>
                        </div>
                        {errors.confirmSenha && <p className="mt-1 text-xs text-red-500">{errors.confirmSenha}</p>}
                      </div>
                    </div>

                    <button
                      disabled={loading}
                      className="flex w-full items-center justify-center gap-2 rounded-2xl bg-blue-600 px-5 py-4 text-sm font-black text-white shadow-xl shadow-blue-600/20 transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-70"
                    >
                      {loading ? <Loader2 className="animate-spin" /> : 'Continuar'} <ArrowRight size={20} />
                    </button>
                  </form>
                ) : (
                  <form onSubmit={handleConfirmCode} className="mx-auto max-w-md space-y-6 text-center animate-in fade-in slide-in-from-right-8">
                    <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-3xl bg-blue-50 text-blue-600 shadow-inner">
                      <KeyRound size={34} />
                    </div>

                    <div>
                      <label className="mb-2 block text-sm font-black text-slate-800">Digite o código de 6 dígitos</label>
                      <input
                        className="w-full rounded-3xl border border-slate-200 bg-slate-50 p-5 text-center font-mono text-3xl font-black tracking-[0.35em] text-slate-950 outline-none transition focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-100"
                        maxLength={6}
                        value={code}
                        onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                        placeholder="000000"
                      />
                    </div>

                    <button
                      disabled={loading || code.length < 6}
                      className="flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-5 py-4 text-sm font-black text-white shadow-xl shadow-emerald-600/20 transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {loading ? <Loader2 className="animate-spin" /> : <><CheckCircle size={20} /> Confirmar cadastro</>}
                    </button>

                    <button type="button" onClick={() => setStep(1)} className="inline-flex items-center justify-center gap-2 text-sm font-bold text-slate-500 transition hover:text-blue-700">
                      <ArrowLeft size={16} />
                      Corrigir meus dados
                    </button>
                  </form>
                )}

                {step === 1 && (
                  <div className="mt-8 border-t border-slate-100 pt-5 text-center">
                    <p className="text-sm text-slate-500">
                      Já tem uma conta? <Link href="/login" className="font-black text-blue-600 hover:text-blue-700">Fazer login</Link>
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
