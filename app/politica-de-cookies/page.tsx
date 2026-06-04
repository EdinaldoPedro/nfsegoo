import Link from "next/link";
import { ArrowLeft, Cookie } from "lucide-react";
import { legalNotice, legalUpdatedAt } from "@/app/legal-content";

export default function PoliticaDeCookies() {
  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto max-w-5xl px-5 py-10 sm:px-8">
        <Link href="/" className="mb-8 inline-flex items-center gap-2 text-sm font-black text-blue-700 hover:text-blue-900">
          <ArrowLeft size={16} />
          Voltar ao site
        </Link>

        <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm sm:p-10">
          <div className="mb-8 flex flex-col gap-4 border-b border-slate-200 pb-8 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-blue-600">Cookies e tecnologias locais</p>
              <h1 className="mt-3 text-3xl font-black tracking-tight text-slate-950 sm:text-5xl">Politica de Cookies</h1>
              <p className="mt-3 text-sm font-semibold text-slate-500">Ultima atualizacao: {legalUpdatedAt}</p>
            </div>
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-700">
              <Cookie size={28} />
            </div>
          </div>

          <div className="mb-8 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm font-semibold leading-6 text-amber-900">
            {legalNotice}
          </div>

          <div className="space-y-8 text-sm leading-7 text-slate-700">
            <section>
              <h2 className="text-xl font-black text-slate-950">1. O que usamos hoje</h2>
              <p className="mt-3">
                A plataforma usa cookies e armazenamento local essenciais para login, sessao segura, preferencias, papel do
                usuario, empresa ativa, modo suporte, configuracoes de interface e continuidade de fluxos. Esses recursos sao
                necessarios para o funcionamento do SaaS e nao devem ser usados para publicidade comportamental sem aviso e
                consentimento especificos.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-black text-slate-950">2. Tipos de tecnologias</h2>
              <ul className="mt-3 list-disc space-y-2 pl-5">
                <li>Cookies de autenticacao: mantem a sessao do usuario apos login.</li>
                <li>Armazenamento local: guarda identificadores operacionais, perfil, papel de acesso, contexto de empresa e preferencias.</li>
                <li>Registros tecnicos: IP, horario, navegador, eventos de seguranca e erros para auditoria e protecao da plataforma.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-black text-slate-950">3. Gestao pelo usuario</h2>
              <p className="mt-3">
                O usuario pode limpar cookies e armazenamento local pelo navegador. Isso pode encerrar a sessao, remover
                preferencias, exigir novo login ou prejudicar recursos que dependem de contexto da conta.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-black text-slate-950">4. Novas ferramentas</h2>
              <p className="mt-3">
                Caso sejam adicionadas ferramentas de analise, marketing, atendimento externo, pixels ou cookies nao essenciais,
                esta Politica deve ser atualizada e, quando exigido, a plataforma deve coletar consentimento especifico.
              </p>
            </section>
          </div>
        </section>
      </div>
    </main>
  );
}

