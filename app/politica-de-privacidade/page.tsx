import Link from "next/link";
import { ArrowLeft, Mail, ShieldCheck } from "lucide-react";
import { companyLegalName, legalNotice, legalUpdatedAt, privacyContactEmail } from "@/app/legal-content";

const dataCategories = [
  "Dados de cadastro e autenticacao: nome, e-mail, CPF, telefone, senha criptografada, codigo de verificacao, IP de origem e registros de acesso.",
  "Dados empresariais e fiscais: CNPJ, razao social, nome fantasia, inscricoes, endereco, regime tributario, CNAEs, codigos de servico e parametros de tributacao.",
  "Dados de clientes/tomadores: nome, CPF/CNPJ, e-mail, telefone, endereco, inscricoes e demais informacoes necessarias para emissao de NFS-e.",
  "Dados de emissao: descricoes de servicos, valores, XMLs, PDFs, chaves de acesso, protocolos, status de notas, rascunhos, cancelamentos e logs tecnicos.",
  "Certificado digital A1: arquivo, senha, validade e dados tecnicos necessarios para assinatura e transmissao de documentos fiscais.",
  "Dados comerciais e suporte: planos, pedidos, faturas, cupons, tickets, mensagens, anexos e historico de atendimento.",
];

const purposes = [
  "Criar e proteger contas, autenticar usuarios e prevenir fraude.",
  "Emitir, consultar, cancelar, armazenar e disponibilizar NFS-e, XMLs e PDFs.",
  "Gerenciar empresas, tomadores, contadores, vinculos, planos, creditos e suporte.",
  "Cumprir obrigacoes legais, fiscais, regulatorias e ordens de autoridades competentes.",
  "Melhorar seguranca, disponibilidade, auditoria, diagnostico de erros e qualidade do produto.",
  "Enviar mensagens transacionais, avisos de conta, verificacao de e-mail, suporte e comunicacoes indispensaveis ao servico.",
];

const rights = [
  "Confirmacao da existencia de tratamento e acesso aos dados.",
  "Correcao de dados incompletos, inexatos ou desatualizados.",
  "Anonimizacao, bloqueio ou eliminacao quando aplicavel.",
  "Portabilidade, informacao sobre compartilhamentos e revisao de decisoes automatizadas, quando houver.",
  "Revogacao de consentimento e oposicao a tratamentos realizados de forma irregular.",
  "Peticionamento perante a Autoridade Nacional de Protecao de Dados, apos tentativa de contato pelo canal do controlador.",
];

export default function PoliticaDePrivacidade() {
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
              <p className="text-xs font-black uppercase tracking-[0.18em] text-blue-600">Privacidade e LGPD</p>
              <h1 className="mt-3 text-3xl font-black tracking-tight text-slate-950 sm:text-5xl">
                Politica de Privacidade
              </h1>
              <p className="mt-3 text-sm font-semibold text-slate-500">Ultima atualizacao: {legalUpdatedAt}</p>
            </div>
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-700">
              <ShieldCheck size={28} />
            </div>
          </div>

          <div className="mb-8 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm font-semibold leading-6 text-amber-900">
            {legalNotice}
          </div>

          <div className="space-y-8 text-sm leading-7 text-slate-700">
            <section>
              <h2 className="text-xl font-black text-slate-950">1. Quem somos</h2>
              <p className="mt-3">
                Esta Politica explica como {companyLegalName} trata dados pessoais na plataforma de emissao e gestao de NFS-e.
                Para a LGPD, a empresa contratante normalmente atua como controladora dos dados de seus usuarios, empresas e
                tomadores cadastrados, enquanto {companyLegalName} pode atuar como operadora quando processa dados em nome da
                contratante e como controladora em atividades proprias, como cadastro, seguranca, cobranca e suporte.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-black text-slate-950">2. Dados que podemos tratar</h2>
              <ul className="mt-3 list-disc space-y-2 pl-5">
                {dataCategories.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-black text-slate-950">3. Finalidades</h2>
              <ul className="mt-3 list-disc space-y-2 pl-5">
                {purposes.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-black text-slate-950">4. Bases legais</h2>
              <p className="mt-3">
                O tratamento pode se apoiar em execucao de contrato, cumprimento de obrigacao legal ou regulatoria, exercicio
                regular de direitos, legitimo interesse para seguranca e melhoria do servico, protecao do credito quando
                aplicavel, prevencao a fraude e consentimento nos casos em que a lei exigir.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-black text-slate-950">5. Compartilhamento</h2>
              <p className="mt-3">
                Podemos compartilhar dados com provedores de hospedagem, banco de dados, e-mail, suporte, meios de pagamento,
                emissores fiscais, prefeituras, Portal Nacional da NFS-e, Receita Federal, integracoes de CEP/CNPJ, contadores
                vinculados pela conta e autoridades competentes. O compartilhamento deve ocorrer na medida necessaria para
                prestar o servico, cumprir lei, proteger direitos ou atender solicitacoes autorizadas pelo usuario.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-black text-slate-950">6. Certificado digital A1</h2>
              <p className="mt-3">
                Quando o usuario envia certificado A1 e senha, esses dados sao usados para assinar e transmitir documentos
                fiscais. O acesso deve ser restrito a processos autorizados e equipe habilitada, com controles tecnicos e
                administrativos compatíveis com a sensibilidade do ativo. O usuario deve manter a titularidade e autorizacao
                de uso do certificado, comunicar suspeitas de comprometimento e solicitar remocao quando deixar de usar a
                plataforma.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-black text-slate-950">7. Retencao e eliminacao</h2>
              <p className="mt-3">
                Mantemos dados pelo tempo necessario para prestar o servico, cumprir prazos legais, fiscais, contabeis,
                regulatórios, auditorias, seguranca e exercicio regular de direitos. Notas fiscais, XMLs, PDFs, logs e
                registros de pedidos podem precisar ser preservados mesmo apos cancelamento da conta. Quando a retencao nao
                for mais necessaria, os dados poderao ser eliminados, anonimizados ou bloqueados.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-black text-slate-950">8. Direitos do titular</h2>
              <ul className="mt-3 list-disc space-y-2 pl-5">
                {rights.map((item) => <li key={item}>{item}</li>)}
              </ul>
              <p className="mt-3">
                Para exercer direitos, envie uma solicitacao para{" "}
                <a className="font-black text-blue-700 hover:text-blue-900" href={`mailto:${privacyContactEmail}`}>
                  {privacyContactEmail}
                </a>
                . Poderemos solicitar informacoes adicionais para confirmar sua identidade e proteger terceiros.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-black text-slate-950">9. Seguranca e incidentes</h2>
              <p className="mt-3">
                Adotamos medidas tecnicas e administrativas para reduzir riscos, como autenticacao, validacoes de origem,
                limitacao de tentativas, criptografia de senhas, controles de acesso e registros de auditoria. Nenhum sistema
                e infalivel. Em caso de incidente relevante envolvendo dados pessoais, avaliaremos impactos e comunicaremos
                titulares e autoridades quando exigido pela lei.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-black text-slate-950">10. Alteracoes</h2>
              <p className="mt-3">
                Esta Politica pode ser atualizada para refletir mudancas legais, tecnicas ou de produto. A versao vigente sera
                publicada nesta pagina, com a data de atualizacao.
              </p>
            </section>
          </div>

          <div className="mt-10 flex flex-col gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600 sm:flex-row sm:items-center sm:justify-between">
            <span className="font-semibold">Canal de privacidade</span>
            <a className="inline-flex items-center gap-2 font-black text-blue-700 hover:text-blue-900" href={`mailto:${privacyContactEmail}`}>
              <Mail size={16} />
              {privacyContactEmail}
            </a>
          </div>
        </section>
      </div>
    </main>
  );
}

