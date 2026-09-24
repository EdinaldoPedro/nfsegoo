# Relatórios e ciclo de homologação

Estado: implementado e validado com dados sintéticos em QA. Não autoriza lançamento comercial, migração do histórico original ou envio fiscal real. Build web e compilação do worker continuam com o proprietário.

## Ambiente e preservação

- Novas autorizações em HOMOLOGACAO também geram NotaFiscal, XML preservado e tarefa documental. Consulta, cancelamento e PDF usam o ambiente congelado da nota, não a configuração atual da empresa.
- Homologação não reserva/consome crédito de produção e não incrementa Empresa.ultimoDPS de produção. Exige elegibilidade operacional conforme a política de planos vigente; não é um bypass de acesso.
- Tomador, documento, serviço, descrição e valor da nota vêm da referência XML assinada validada, não do cadastro alterado depois. Campos novos: tomadorNome e metadadosVerificadosEm.
- Reaproveitar uma homologação exige criar **nova solicitação/venda**, revisar os campos e reservar outra DPS. A origem fica registrada no payload/auditoria. A mesma chave de idempotência não cria cópias extras. Reenviar/editar a venda já autorizada permanece bloqueado.
- Homologações antigas que ficaram somente no job não foram convertidas em massa. Precisam de recuperação verificável do XML e conciliação no clone protegido; não inventar documentos nem inferir o ambiente pela empresa atual.

## Relatórios e exportação

- Três conjuntos separados: PRODUCAO, HOMOLOGACAO e LEGADO (ambiente nulo/desconhecido). Não existe total misturando ambientes. Indicadores fiscais do cliente, contador e administração excluem homologação e legado sem ambiente confirmado.
- Total autorizado exclui canceladas e arquivadas. Não equivale à receita do SaaS nem substitui apuração contábil/fiscal. Datas civis no fuso America/Sao_Paulo, inclusive transições históricas do horário de verão; início inclusivo e fim exclusivo do dia seguinte.
- Na falta de data oficial, usa data de cadastro, identificada explicitamente. Nome sem extração verificada é indicado como cadastro atual. Registros sem ambiente confirmado ficam fora dos indicadores de produção até conciliação.
- Consultar o próprio histórico não exige plano vigente/créditos. A autorização da empresa continua obrigatória, inclusive após revogação de vínculo contábil. Suporte direto/comercial não recebem acesso indiscriminado a relatórios de clientes.
- Consultas de relatório usam snapshot transacional consistente e apenas metadados. Página limitada a 100 linhas; interface usa 20. Período máximo de 366 dias. Relatório PDF exige snapshot completo, com até 1.000 linhas; exceder o limite pede redução dos filtros, não truncamento silencioso.
- ZIP: 1 a 50 IDs distintos, mesma empresa/ambiente. Limite de entrada armazenada de 32 MiB conferido no banco antes de carregar blobs e limite de saída descompactada de 20 MiB. XML/evento separados; empresa, ambiente e ID entram no caminho para evitar colisões de números.
- PDF de nota exige tarefa documental concluída; arquivos faltantes/corrompidos, evento de cancelamento ausente e lotes cruzados recusam o lote inteiro. Resposta é ZIP binário, não base64 em JSON. A tela orienta preparar documentos pelo histórico.
- Histórico de vendas deixou de ler XML/PDF para compor a listagem. Recuperação do formulário retorna dados necessários, não logs, certificados, XMLs, PDFs ou payload bruto. O carregamento não depende mais de atraso fixo.

## Evidências obtidas

- 137 testes unitários/regressivos e 64 de integração PostgreSQL (55 subtestes + nove grupos), zero falhas/SKIP. Incluem isolamento, paginação completa, centavos, ambientes, datas/DST, limite antes de carregar blob, 1.002 notas, bombeamento gzip e cópia concorrente de homologação.
- Novo ciclo de homologação exercitado com assinatura/retorno sintéticos, geração real do DANFSe, cancelamento simulado e preservação do crédito de uma nova solicitação de produção. Nenhum envio ao portal.
- Sete páginas de três PDFs sintéticos renderizadas e inspecionadas: produção multipágina, homologação e relatório vazio/legado. Sem sobreposição de tabela/rodapé; identificação e avisos de ambiente preservados. Reprodução: `node scripts/render-report-samples.cjs` (saída ignorada pelo Git em tmp/pdfs/fiscal-report).
- Navegador autenticado na instância QA: acesso sem plano, produção com 22 autorizadas e uma cancelada, paginação 20+2, filtros editados separados dos aplicados, homologação/legado fora da produção, mensagem de PDF indisponível e abertura da cópia para revisão sem envio. PDF solicitado na página 2 gerou confirmação de 22 linhas. A captura automatizada do evento de download expirou; gravação pelo gerenciador de downloads ainda deve ser conferida no aceite manual.
- Inspeção responsiva do relatório em 390 x 844: página sem transbordamento horizontal; tabela com rolagem interna. Carrossel ajustado para navegação manual e apenas um cartão acessível/renderizado por vez.

## Migração e limites restantes

- Migração aditiva `20260902140000_fiscal_report_metadata` aplicada somente no QA, que agora tem 34 migrações. Original conserva oito migrações pendentes após a primeira de impersonação. Não houve backfill automático dos novos campos/ambiente.
- A fonte padrão do relatório PDF cobre o alfabeto latino usado nos casos validados. Caracteres sem glifo suportado fazem a geração falhar com mensagem explícita, sem trocar nomes por caracteres corrompidos. Cobertura Unicode internacional completa exige fonte incorporada/licenciada e nova inspeção; a tela e o XML conservam os dados.
- Ainda faltam ensaio de restauração/backfill, homologação com certificado autorizado, fluxo completo de todos os perfis e carga/observabilidade. A listagem de carteira do contador ainda faz consultas por empresa e requer revisão para carteiras grandes.
- Revisão fiscal mais ampla (incluindo NT009, CNPJ alfanumérico de ponta a ponta e governança de enquadramento) continua separada deste lote. Não vender suporte não homologado.

## QA de interface reproduzível

Somente no banco sintético **sem contas**; o seed recusa sobrescrever contas existentes. Nunca usar o certificado fictício/XML de testes no portal.

```powershell
node --env-file=.env scripts/qa-report-ui.cjs seed nfsegoo_qa_20260902_07d19000ca26
node --env-file=.env scripts/qa-report-ui.cjs serve nfsegoo_qa_20260902_07d19000ca26
# Depois de encerrar o servidor de QA:
node --env-file=.env scripts/qa-report-ui.cjs clean nfsegoo_qa_20260902_07d19000ca26
```

Seed informa senha aleatória apenas da conta sintética. Serve inicia desenvolvimento em loopback:3105, com DATABASE_URL substituída apenas no subprocesso e produção fiscal desabilitada; não executa build ou worker. Clean verifica conta/empresa exatas e remove somente essa fixture de QA. O banco continua disponível.
