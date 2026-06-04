import Link from "next/link";
import { ArrowLeft, FileText, Mail } from "lucide-react";
import { companyLegalName, legalNotice, legalUpdatedAt, supportContactEmail } from "@/app/legal-content";

const userDuties = [
  "Informar dados verdadeiros, completos e atualizados de usuario, empresa, tomadores e servicos.",
  "Usar a plataforma apenas para emissoes autorizadas e compativeis com a legislacao fiscal aplicavel.",
  "Conferir valores, CNAEs, codigos de servico, aliquotas, retencoes, descricoes e dados da nota antes da emissao.",
  "Manter sigilo de login, senha, dispositivos, certificado digital A1 e credenciais vinculadas.",
  "Obter autorizacao para cadastrar dados de terceiros, clientes, empresas vinculadas e certificados digitais.",
  "Nao tentar burlar limites, acessar contas de terceiros, explorar falhas, inserir conteudo ilegal ou comprometer a seguranca do sistema.",
];

export default function TermosDeUso() {
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
              <p className="text-xs font-black uppercase tracking-[0.18em] text-blue-600">Contratacao e uso</p>
              <h1 className="mt-3 text-3xl font-black tracking-tight text-slate-950 sm:text-5xl">Termos de Uso</h1>
              <p className="mt-3 text-sm font-semibold text-slate-500">Ultima atualizacao: {legalUpdatedAt}</p>
            </div>
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-700">
              <FileText size={28} />
            </div>
          </div>

          <div className="mb-8 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm font-semibold leading-6 text-amber-900">
            {legalNotice}
          </div>

          <div className="space-y-8 text-sm leading-7 text-slate-700">
            <section>
              <h2 className="text-xl font-black text-slate-950">1. Aceite</h2>
              <p className="mt-3">
                Estes Termos regulam o acesso e uso da plataforma {companyLegalName}. Ao criar conta, acessar, contratar,
                emitir notas ou utilizar recursos do sistema, o usuario declara que leu, compreendeu e concorda com estes
                Termos e com a Politica de Privacidade.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-black text-slate-950">2. O servico</h2>
              <p className="mt-3">
                A plataforma oferece recursos para cadastro de empresas e tomadores, emissao e gestao de NFS-e, armazenamento
                de XML/PDF, rascunhos, suporte, planos, creditos, pacotes, vinculos com contadores e acompanhamento operacional.
                Algumas funcionalidades podem depender de homologacao municipal, Portal Nacional da NFS-e, prefeituras,
                Receita Federal, provedores de e-mail, banco de dados, meios de pagamento e outros terceiros.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-black text-slate-950">3. Responsabilidades do usuario</h2>
              <ul className="mt-3 list-disc space-y-2 pl-5">
                {userDuties.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-black text-slate-950">4. Emissao fiscal</h2>
              <p className="mt-3">
                O usuario e responsavel pelo enquadramento tributario, autorizacao para emissao, exatidao dos dados fiscais e
                revisao das informacoes antes de transmitir notas. A plataforma pode automatizar validacoes e preenchimentos,
                mas nao substitui contador, consultoria tributaria ou revisao profissional. Falhas em dados enviados pelo
                usuario, indisponibilidade de orgaos publicos, rejeicoes fiscais e alteracoes normativas podem impedir ou
                atrasar emissoes.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-black text-slate-950">5. Certificado digital</h2>
              <p className="mt-3">
                Ao cadastrar certificado digital A1, o usuario declara ter poderes para utiliza-lo e autoriza seu uso para
                assinatura, transmissao, consulta e operacoes fiscais relacionadas a sua conta. O usuario deve solicitar
                remocao do certificado quando encerrar a relacao, trocar de contador ou identificar suspeita de uso indevido.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-black text-slate-950">6. Planos, creditos e pagamentos</h2>
              <p className="mt-3">
                Planos, limites, creditos, pacotes, cupons, prazos de teste e precos podem variar conforme oferta vigente.
                O checkout automatico pode estar em desenvolvimento ou depender de ativacao manual. A liberacao de planos pode
                exigir confirmacao interna, pagamento, analise antifraude ou validacao cadastral. Valores promocionais e
                cupons podem ser alterados ou encerrados conforme regras comerciais.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-black text-slate-950">7. Suspensao e encerramento</h2>
              <p className="mt-3">
                A conta pode ser suspensa ou limitada em caso de inadimplencia, uso irregular, risco de seguranca, suspeita de
                fraude, violacao destes Termos, ordem legal ou necessidade tecnica. O encerramento da conta nao elimina
                automaticamente documentos fiscais, logs e registros que precisem ser mantidos por obrigacao legal, auditoria,
                seguranca ou exercicio regular de direitos.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-black text-slate-950">8. Disponibilidade e limites</h2>
              <p className="mt-3">
                Empregamos esforcos razoaveis para manter a plataforma disponivel, mas podem ocorrer manutencoes, instabilidades,
                falhas de terceiros, indisponibilidade de orgaos publicos, bloqueios de rede ou incidentes. Recursos beta,
                cidades em integracao e funcionalidades em desenvolvimento podem mudar, falhar ou ser removidos.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-black text-slate-950">9. Propriedade intelectual</h2>
              <p className="mt-3">
                Software, marca, interfaces, textos, componentes, bancos de dados e materiais da plataforma pertencem a
                {companyLegalName} ou seus licenciantes. O usuario recebe apenas uma licenca limitada, revogavel, nao exclusiva
                e intransferivel para usar a plataforma conforme estes Termos.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-black text-slate-950">10. Privacidade</h2>
              <p className="mt-3">
                O tratamento de dados pessoais e descrito na{" "}
                <Link href="/politica-de-privacidade" className="font-black text-blue-700 hover:text-blue-900">
                  Politica de Privacidade
                </Link>
                , que integra estes Termos.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-black text-slate-950">11. Lei aplicavel e foro</h2>
              <p className="mt-3">
                Estes Termos devem ser regidos pelas leis brasileiras. O foro competente e eventuais regras especificas para
                consumidores, empresas e contratacoes B2B devem ser confirmados apos validacao juridica.
              </p>
            </section>
          </div>

          <div className="mt-10 flex flex-col gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600 sm:flex-row sm:items-center sm:justify-between">
            <span className="font-semibold">Canal de suporte</span>
            <a className="inline-flex items-center gap-2 font-black text-blue-700 hover:text-blue-900" href={`mailto:${supportContactEmail}`}>
              <Mail size={16} />
              {supportContactEmail}
            </a>
          </div>
        </section>
      </div>
    </main>
  );
}
