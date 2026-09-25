import type { ReactNode } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Clock3, KeyRound, ShieldCheck } from 'lucide-react';

export default function AuthRecoveryShell({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-900 selection:bg-blue-200 selection:text-blue-950">
      <div className="grid min-h-screen lg:grid-cols-[1.02fr_0.98fr]">
        <section className="relative hidden overflow-hidden bg-slate-950 px-10 py-10 text-white lg:flex lg:flex-col lg:justify-between">
          <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.055)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.055)_1px,transparent_1px)] bg-[size:42px_42px]" />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_18%,rgba(37,99,235,0.42),transparent_34%),radial-gradient(circle_at_84%_78%,rgba(16,185,129,0.24),transparent_30%)]" />

          <Link href="/" className="relative z-10 flex w-fit items-center gap-3">
            <Image src="/icons/G.png" alt="NFSeGoo" width={44} height={44} className="h-11 w-11 object-contain" />
            <div>
              <p className="text-2xl font-black tracking-tight">NFSe<span className="font-light text-emerald-300">Goo</span></p>
              <p className="text-xs font-bold uppercase tracking-[0.28em] text-blue-200">Portal de emissão</p>
            </div>
          </Link>

          <div className="relative z-10 max-w-xl py-12">
            <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm font-bold text-blue-50 backdrop-blur">
              <ShieldCheck size={16} className="text-emerald-300" /> Recuperação protegida
            </span>
            <h1 className="mt-6 text-5xl font-black leading-[1.03] tracking-tight xl:text-6xl">Retome o acesso com segurança.</h1>
            <p className="mt-6 max-w-lg text-lg leading-8 text-slate-300">
              O processo protege sua conta sem expor cadastros e encerra os acessos anteriores quando a senha é redefinida.
            </p>

            <div className="mt-10 grid max-w-xl gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-white/10 bg-white/10 p-4 backdrop-blur">
                <Clock3 className="mb-5 text-blue-300" size={23} />
                <p className="font-black">Link temporário</p>
                <p className="mt-1 text-xs leading-5 text-slate-300">Uso único e prazo limitado.</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/10 p-4 backdrop-blur">
                <KeyRound className="mb-5 text-amber-300" size={23} />
                <p className="font-black">Senha forte</p>
                <p className="mt-1 text-xs leading-5 text-slate-300">Validação antes de salvar.</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/10 p-4 backdrop-blur">
                <ShieldCheck className="mb-5 text-emerald-300" size={23} />
                <p className="font-black">Acessos revogados</p>
                <p className="mt-1 text-xs leading-5 text-slate-300">Novo login após a troca.</p>
              </div>
            </div>
          </div>

          <div className="relative z-10 flex items-center justify-between border-t border-white/10 pt-6 text-sm text-slate-300">
            <span>Ambiente protegido por sessão segura</span>
            <Link href="/login" className="font-bold text-white transition hover:text-emerald-300">Voltar ao login</Link>
          </div>
        </section>

        <section className="relative flex min-h-screen items-center justify-center overflow-hidden bg-slate-50 px-5 py-8 sm:px-8">
          <div className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-blue-100/70 blur-3xl" />
          <div className="absolute -bottom-28 -left-24 h-72 w-72 rounded-full bg-emerald-100/60 blur-3xl" />
          <div className="relative z-10 w-full max-w-md">
            <div className="mb-8 flex items-center justify-between lg:hidden">
              <Link href="/" className="flex items-center gap-3">
                <Image src="/icons/G.png" alt="NFSeGoo" width={40} height={40} className="h-10 w-10 object-contain" />
                <span className="text-2xl font-black tracking-tight text-blue-700">NFSe<span className="font-light text-emerald-500">Goo</span></span>
              </Link>
              <Link href="/login" className="text-sm font-bold text-slate-500 transition hover:text-blue-700">Entrar</Link>
            </div>
            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-2xl shadow-slate-300/60 sm:p-8">
              {children}
            </div>
            <p className="mt-5 text-center text-xs leading-5 text-slate-500">
              A NFSe Goo nunca solicita sua senha, código do autenticador ou certificado por e-mail.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
