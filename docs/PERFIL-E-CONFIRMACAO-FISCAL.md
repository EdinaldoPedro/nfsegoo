# Perfil, cadastro da empresa e confirmação fiscal

## Fronteiras implementadas

- `PUT /api/perfil` exige `escopo: CONTA` ou `escopo: EMPRESA`. O primeiro aceita somente nome, telefone, cargo e preferências; o segundo nunca altera usuário, papel, contrato, propriedade ou catálogo tributário global.
- Cadastro fiscal usa lista permitida de campos, limites, tipos estritos, CNPJ validado, CNAEs locais únicos e exatamente uma atividade principal. CNPJ de empresa existente é imutável nessa operação; empresa nova respeita titularidade, plano, cota e pendências.
- Acesso e versão da empresa são conferidos sob bloqueio. Empresa, CNAEs, sequência e auditoria confirmam ou revertem juntos. Uma aba antiga recebe conflito em vez de sobrescrever outra atualização.
- Certificado PFX/P12 é limitado a 1 MiB e base64 canônico antes do parser. Substituição/remoção e ativação de Produção exigem a senha atual da conta. Respostas e auditoria não contêm arquivo, senha ou cifra.
- O usuário não publica regras globais ao salvar seus CNAEs. Metadados locais legados de NBS/retenção só são preservados para o mesmo código; governança compartilhada continua administrativa.
- Toda nova emissão leva a empresa e o ambiente exibidos na revisão. O servidor compara ambos sob o mesmo bloqueio que cria venda/job/reserva. Mudança desde a revisão recusa a operação. Replay idempotente retorna somente o job original congelado.

## Evidência local de QA

- 142 testes unitários/regressivos e 75 testes PostgreSQL no banco sintético (65 subtestes e dez grupos), incluindo seis gravações concorrentes, rollback tardio, revogação, perfis internos, cotas e segredo em auditoria.
- Navegador autenticado com dados exclusivamente sintéticos: campos opcionais, complemento/e-mail comercial separado do login, salvamento pessoal com telefone vazio, confirmação por senha de Produção e conflito entre duas abas. Nenhum certificado ou documento real foi usado; nenhum worker/transmissão fiscal foi iniciado.
- Typecheck do app e do worker aprovado sem build/compilação; lint em 313 arquivos: zero erros e 41 avisos. Fixture visual removida pelo script e servidor de QA encerrado após a verificação.
- O CNPJ alfanumérico é preservado/validado na entrada, mas certificado alfanumérico é recusado explicitamente até sua homologação técnica. Não converter letras para dígitos.

## Limites e gates

Essa proteção não certifica cadeia ICP-Brasil, portal, regimes, incidência ou disponibilidade operacional. Validar PFX no SaaS comprova apenas que o contêiner abre, contém chave privada, está no período de validade e apresenta o CNPJ esperado; a aceitação fiscal depende do Portal Nacional. Permanecem obrigatórios ensaio com certificado autorizado em homologação, revisão fiscal externa e os gates gerais de `REMEDIACAO.md`.

A revisão das rotas administrativas alternativas de alteração/arquivamento de empresas e propriedade permanece pendente. Elas ainda precisam compartilhar os invariantes de identidade, sequência e transação; os testes deste lote não autorizam afirmar que todo o domínio administrativo está concluído. A seleção do certificado associado à chave, cadeia/revogação e limitação de custo do parser PKCS12 também exigem revisão específica.

Não executar testes destrutivos no banco original. A fixture visual pode ser criada/removida somente no banco isolado com `scripts/qa-report-ui.cjs`; ela é fictícia, não possui certificado e deve permanecer em Homologação ao final.
