# Remediacao para prontidao comercial

## Regras de execucao

- Nao executar `npm run build`: a verificacao final de build sera feita pelo proprietario.
- Preservar alteracoes existentes; nao fazer commit, push ou deploy sem solicitacao.
- Cobrança segue manual; valores, elegibilidade, conciliacao e ativacao devem ser autoritativos no servidor.
- Nao declarar prontidao comercial apenas por lint/testes verdes. Exigir evidencia funcional, fiscal e operacional.
- Migrações destrutivas precisam de backup e aprovacao; priorizar migrações aditivas e backfill verificavel.

## Matriz de trabalho

| Area | Requisitos | Estado |
| --- | --- | --- |
| Autorizacao | RBAC, isolamento de empresas, suporte somente leitura, hierarquia de papeis, auditoria | Implementado e validado em QA; rollout das migracoes e bateria manual por perfil pendentes |
| Tickets | Mensagens internas privadas, contador sem privilegio de staff, anexos seguros | Guardas, papeis, anexos e privacidade implementados; bateria manual pendente |
| Autenticacao | Sessoes revogaveis, MFA interno, dispositivos, recuperacao sem enumeracao, rate limit atomico | Implementado e validado em QA; migracao/rollout do banco original pendente |
| Multitenancy | Cliente por empresa, migracao de vinculos e referencias historicas, testes cruzados | Isolamento e constraints validados em QA; backfill legado aguarda backup/restauracao e validacao |
| Fiscal | CNPJ alfanumerico, NT009 aplicavel, escopo de regimes, XSD e regressao, governanca de regras | XSD/assinatura/retorno, filas, cancelamento e documentos testados; homologacao externa e aprovacao fiscal pendentes |
| Comercial | Papel COMERCIAL, precos/ciclos/cupons no servidor, estados de pedido e ativacao atomica, cancelamento | Fluxo manual, cotacao, conciliacao, ledger e concessoes validados; configuracao final e bateria manual pendentes |
| Emissao | Worker duravel, lease seguro, idempotencia, retomada, falhas classificadas | Concorrencia/retomada validadas em PostgreSQL QA; migracao real, processo compilado e homologacao pendentes; ver WORKER-EMISSAO.md |
| Escala | Prisma compartilhado, paginacao limitada, arquivos sob demanda, exportacao limitada | Relatorio/historico leem metadados; ZIP limitado antes de carregar blobs; carga real e carteira contabil em escala pendentes |
| Seguranca HTTP | CSRF/origens confiaveis, CSP/HSTS, validacao de payload e anexos, segredos e rotacao | Guard transversal, limites, anexos, CSP base, headers e cache implementados; HSTS/proxy/rotacao exigem o ambiente final |
| Dependencias | Atualizacoes compativeis, audit sem criticas, regressao de PDF/XML/assinatura | Next 16/React 19 e regressao aprovados; audit offline zerado; audit online e build reservados ao proprietario |
| LGPD/juridico | Aceite versionado, direitos do titular, retencao, logs, documentos configuraveis e revisao juridica externa | Fluxos e retencao implementados em QA; textos, identidade e aprovacao juridica reais pendentes |
| UX | Acessibilidade, mobile, erros, promessas comerciais, contatos e fluxos completos | Ajustes tecnicos e lint sem avisos; execucao ampla por perfil permanece pendente |
| Operacao | Health checks, alertas, runbooks, CI, backups/restauracao, carga, RPO/RTO | Health/readiness, outbox, retencao e runbooks implementados; backup restaurado, carga, alertas e infraestrutura pendentes |
| Entrega | Bateria manual por COMUM, CONTADOR, SUPORTE, COMERCIAL, ADMIN e MASTER | Roteiro cumulativo em TESTES-MANUAIS.md; execucao integral e entrega final pendentes |

## Evidencias ja obtidas nesta remediacao

- Schema Prisma validado apos a criacao de `ImpersonationSession`.
- Migracao `20260901180000_add_secure_impersonation_sessions` aplicada no banco local.
- ESLint direcionado e `tsc --noEmit --incremental false` passaram no primeiro lote de RBAC.
- Nenhum build executado durante a remediacao.
- 155 testes unitarios/regressivos aprovados: JWT, MFA, hierarquia, CSRF, anexos, comprovantes, limites reais/chunked de requisicao, cobertura dos handlers, pool unico, criptografia/PFX sintetico, calculos fiscais, DANFSe, cotacoes, cupons, catalogo, ciclos de consumo, concessoes/suspensao, consentimento contabil, CNPJ, resultado fiscal, XML de retorno, identidade/ambiente confirmado da solicitacao, perfil estrito e transporte limitado/GET-only na conciliacao.
- `next typegen` e `tsc --noEmit --incremental false` aprovados apos a migracao para Next 16 e os guards de API.
- ESLint 10 com regras efetivas de JavaScript, Next e hooks: zero erros; 41 avisos de interface/hooks classificados para a etapa de UX (nao ignorados como evidencia de qualidade completa). A cobertura TypeScript foi ampliada para componentes fora de `app/`; a contagem anterior de 39 avisos nao incluia esses componentes.
- `npm audit --omit=dev --offline`: zero vulnerabilidades conhecidas no catalogo local apos atualizacoes e reducao da arvore de dependencias. Isso nao substitui uma consulta online atualizada nem equivale a ausencia de falhas na aplicacao.
- Navegador: login e recuperacao renderizaram; validacao de campo obrigatorio e rotulos conferidos. Banco indisponivel foi usado para testar o aviso de falha sem desmontar a tela/deslogar automaticamente.
- Chromium compativel com Playwright 1.62.1 instalado localmente; consulta real ao portal com certificado NAO executada nesta etapa.
- HTTP local: JSON malformado retorna 400, origem externa retorna 403 e payload de login acima do limite retorna 413. Aliases loopback no desenvolvimento so sao aceitos na mesma porta.
- Schema comercial validado e Prisma Client gerado; TypeScript e lint direcionado aprovados nas novas telas e servicos. Testes PostgreSQL de concorrencia comercial executados e aprovados em banco isolado; dados originais preservados.
- `tsc --noEmit --incremental false`, lint de todo o projeto (zero erros, 42 avisos) e `git diff --check` aprovados no lote de contratos/vinculos. Seletor de ofertas agora preserva o ciclo anual e usa catalogo real, sem preco fixo ou tentativa de contratar pela API administrativa.

## Pontos de atencao durante o trabalho

- `AuthSession` e `RateLimitBucket` precisam estar migrados antes de iniciar o app atualizado.
- Tokens legados sem sessao no banco serao rejeitados; todos os usuarios precisarao entrar novamente.
- Rotas legadas de manutencao ficam desabilitadas por padrao e exigem MASTER, senha, justificativa e confirmacao textual.
- Nenhum dado juridico, SLA, provedor de pagamento ou credencial de producao sera inventado. Os campos operacionais serao configuraveis e documentados.
- PostgreSQL local voltou a responder (16.15/UTC). As 35 migracoes foram aplicadas em banco isolado vazio, sem copiar dados reais. As nove migracoes posteriores a impersonacao continuam pendentes no banco original. Fazer backup/restauracao e validar backfill legado antes de migra-lo; ver BANCO-TESTES.md.
- Chamadas POST de navegador precisam enviar `Origin` igual a origem publica configurada. A retomada fiscal nao depende mais de HTTP/segredo de cron: processo separado consulta a fila no PostgreSQL. Administracao reautenticada so pode reagendar consultas de uma DPS ja transmitida.
- O projeto usa Node 24 do ambiente (referencia em `.node-version`); o pacote que instalava Node dentro de `node_modules` foi removido. Em instalacoes limpas, executar explicitamente a geracao do Prisma e a instalacao do Chromium conforme o runbook a entregar.
- Migracao `20260902100000_secure_commercial_orders` e aditiva e ainda NAO aplicada no banco original. Congela limites legados conforme o catalogo no momento da migracao; nao reconstroi condicoes historicas que nunca foram armazenadas. Contratos existentes precisam de conciliacao antes da producao.
- Novos pedidos sao processados em `/admin/contratacoes`. Pedidos legados sem cotacao verificavel precisam ser cancelados/recusados e recriados. A concessao administrativa em contas nao quita pedidos nem registra recebimento ficticio.
- A nova ativacao agenda renovacoes apos o periodo ja contratado. Consumo usa snapshots e aniversario mensal; planos futuros nao liberam cota antecipadamente. Reserva, venda e job sao atomicos; autorizacao consome a reserva na mesma transacao da nota. Falha posterior ao inicio da transmissao nao gera devolucao cega de credito. A fila/conciliacao duravel foi implementada no codigo, validada em PostgreSQL isolado, mas NAO em processo compilado/portal real; NAO publicar o lote isoladamente.
- A migracao `20260902110000_emission_credit_ledger` ainda NAO foi aplicada no banco original. Ela interrompe a migracao se existirem jobs legados em voo. Conciliar cada emissao com o portal antes de migrar; nunca apagar jobs para contornar a trava.
- Editar/promover papel nao concede assinatura nem transfere propriedade. Contadores recebem beneficios em acao separada, com UUID, reautenticacao, justificativa e prazo de 1 ou 12 meses. O antigo prolongamento automatico por 10 anos foi retirado do codigo; prazos legados nao foram encurtados silenciosamente.
- Suspensao operacional preserva contratos, datas, consumo e consulta historica. Reativacao nao renova prazo ou cota. Concessao e checkout nao reativam conta suspensa implicitamente.
- Cadastro adicional aplica cota dentro da transacao e nao reivindica empresas existentes/orfas. Solicitar vinculo nao altera cadastro, CNAEs ou segredos de outra empresa. Pendente nao recebe resumo fiscal. Aprovacao/revogacao/transferencia usa estado atual, titular/custodiante principal ou admin reautenticado e auditoria atomica. Restam revisar os demais caminhos de propriedade/perfil administrativo.
- CNPJ: utilitario de DV numerico/alfanumerico validado com exemplos da Receita/Serpro; aplicado ao cadastro adicional e solicitacao contabil. Demais mascaras, certificados, schemas e emissao ainda NAO foram adequados integralmente. Nao anunciar suporte fiscal alfanumerico completo nesta fase.
- Quatorze baterias de integracao PostgreSQL passaram em QA: 111 testes (96 subtestes e quatorze grupos), zero falhas/SKIP, resultado reproduzido. Agora exigem opt-in e banco local com nome isolado; nao podem executar em nfse_db. Sem opt-in continuam SKIP, o que nao conta como aprovacao.
- Migracao `20260902120000_durable_emission_worker` ainda NAO aplicada no banco original. Adiciona XML preparado, lease, fila de documentos, heartbeat, reserva sequencial, bloqueio de solicitacao descartada e conferência de resultado por operador/empresa. Indices parciais do SQL sao obrigatorios; nao usar `db push` como substituto.
- Typecheck do app e do worker aprovado sem compilar artefatos. Transporte sintetico confirma ausencia de segundo POST, TLS validado, timeout/limite/sem redirect e ausencia de senha de PFX no Basic Auth. PostgreSQL QA aprovado; faltam processo compilado, queda real e portal com certificado.
- Polling da tela nao carrega o XML do job. Cliente acompanha conciliacao separada de rejeicao; reenvio abre revisao no formulario. Sugestao de suporte nao altera valor/descricao da venda nem dispara emissao. Cancelamento/consulta/arquivos e pos-processamento agora usam a fila duravel; ainda exigem homologacao externa e inspecao autenticada das telas.

## Lote de XML/assinatura e verificacao de banco

- Assinatura da DPS passou a usar XMLDSig com canonicalizacao real e verificacao da referencia assinada. Removido o hash manual dessa trilha; o cancelamento legado tambem foi substituido por preparacao assinada e fila duravel.
- NFSe usa o identificador oficial `NFS` + chave de 50 digitos (corrigido), numero de ate 13 digitos no XML e protocolo `nDFSe`. Persistencia usa numeroOficial textual para ate 13 digitos, com Int32 legado opcional. Historico, busca e download ajustados; relatorios/exportacoes revisados no lote documentado abaixo; backfill legado ainda pendente.
- XSDs do pacote oficial de 09/02/2026 versionados com hashes, sem downloads em runtime. Adaptação pontual do padrao de serie descrita em `resources/fiscal/xsd/README.md`; nao e errata oficial nem homologacao do portal.
- Novos testes usam documentos completos e assinaturas sinteticas; assinatura adulterada, wrapping, referencias remotas, IDs ambiguos, campo fora de ordem, UTF-8 invalido e bomba gzip sao rejeitados. O worker verifica disponibilidade dos esquemas antes de assumir tarefas.
- Local da prestacao separado do municipio emissor: informar outra cidade nao altera a identidade da DPS. A determinacao de incidencia/aliquotas e a classificacao automatica de exportacao continuam na revisao fiscal.
- Preparacao e validacao estritas de cancelamento implementadas como base: motivos 1/2/9, justificativa 15..255 sem preenchimento ficticio, escaping XML, evento assinado vinculado a chave/ambiente/pedido. Eco do pedido, E0840, solicitacao de analise e indeferimento nao comprovam cancelamento. Ligado as rotas/telas por fila duravel, com persistencia atomica, conservacao do XML e regeneracao de PDF sem sobrescrita concorrente. A confirmacao fiscal real ainda precisa de homologacao.
- Sequencias tambem precisam de revisao adicional: aliases numericos e entradas invalidas foram corrigidos no lote abaixo; permanece obrigatoria a verificacao de historico legado e parada de processos antigos antes do rollout.
- QA isolado: `nfsegoo_qa_20260902_07d19000ca26`, criado vazio, 35 migracoes e 111 testes de integracao aprovados. Conta da aplicacao permanece sem superusuario/CREATEDB no servidor. Banco original `nfse_db` nao alterado. Detalhes/reproducao em `BANCO-TESTES.md`.

## Lote de cancelamento, consulta e documentos

- Operacao registra ator, nota/empresa, chave, ambiente original, motivo/justificativa, hash do XML e identidade da solicitacao. Nunca deduz destino pelo ambiente atual da empresa. Unicidade parcial por nota e por ambiente/chave impede duas operacoes ativas, inclusive em duplicatas legadas.
- Cliente/contador autorizado podem solicitar cancelamento sem depender de plano/cota. Suporte/admin apenas consultam e solicitam PDF; comercial nao ganha acesso fiscal. Vínculo/identidade são revalidados antes do envio.
- Fronteira gravada antes de um unico POST; depois disso, recuperacao e retomada administrativa fazem somente GET. Resultado incerto preserva nota/credito e bloqueia outro pedido ate conciliacao. Administracao nao transforma pedido ainda nao transmitido em envio.
- Evento assinado e conclusivo confirma cancelamento. Consultar novamente nao descancela. Evento externo diferente pode confirmar a situacao real sem atribuir ao usuario o pedido externo.
- Documento e evento originais preservados; PDF passa por fila separada, revisao e compare-and-swap sob ordem consistente de bloqueios. PDF antigo em renderizacao nao vence cancelamento concorrente. Download legado sem tarefa validada solicita regeneracao antes de oferecer o PDF.
- Resposta 202 nas telas significa solicitacao registrada, nao sucesso fiscal. Removido progresso ficticio; polling nao reenvia pedidos. Downloads XML sao sob demanda, com acesso validado e descompressao limitada. Listagem nao devolve blobs nem detalhes internos de logs; agora usa metadados de classificacao, sem carregar XML/PDF na listagem.
- Arquivamento compartilhado exige ausencia de nota valida/chave, tarefa nao resolvida ou reserva pendente. ADMIN/MASTER reautenticados nao podem ocultar nota autorizada/cancelada; SUPORTE nao arquiva vendas.
- Removido Basic com senha de PFX tambem da consulta HEAD de numeracao. Transporte nunca propaga erro Axios contendo configuracao TLS.
- Recriptografia tardia de certificado legado usa compare-and-swap sobre o par certificado/senha original; nao sobrescreve uma rotacao concorrente. Certificado ausente/corrompido na preparacao do cancelamento gera rejeicao local antes da fronteira de envio. Erros de XML preservado orientam suporte sem expor diagnostico interno.
- Migracao adicional: `20260902130000_durable_note_operations`, aplicada apenas em QA; original continua com oito pendentes. Rechecagem somente leitura manteve 8 usuarios, 35 empresas, 114 notas, 157 vendas e 117 jobs no original.
- Evidencia daquele lote: 125 unitarios/regressivos, 41 testes integrados; typecheck web/worker sem emitir artefatos, lint 0 erros/42 avisos, diff sem erros de espacos. Nenhum build, processo fiscal real ou certificado real usado. Os cenarios de cancelamento usam assinatura/retorno sinteticos. Roteiro cumulativo com 91 casos em TESTES-MANUAIS.md, ainda nao executado integralmente.
- Lacuna identificada para o proximo lote: emissoes novas em homologacao ainda guardam XML apenas no job; o ciclo de consulta/cancelamento pelo historico precisa ser disponibilizado tambem nesse ambiente sem contaminar receita/relatorios. Os casos manuais correspondentes permanecem bloqueados ate esse ajuste e o QA autenticado.
- Governanca fiscal atual, perfis/propriedade, LGPD/outbox, operacao e backfill legado permanecem na matriz. Nao executar a bateria em producao para contornar lacunas de homologacao.

## Lote de identidade e concorrencia da DPS

- Serie estritamente numerica, de 1 a 5 digitos, normalizada antes de criar tarefa, gerar XML, configurar ou consultar. `900`, `0900` e `00900` compartilham uma unica linha de bloqueio. Letras, ambientes desconhecidos, notacao cientifica, fracionarios e overflow nao sao convertidos silenciosamente.
- Reservas consolidadas pelo maior numero entre aliases e tarefas historicas, inclusive rejeitadas; linhas legadas e XMLs preparados nao sao reescritos. O contador antigo da empresa e conservado como piso de producao, sem contaminar homologacao.
- Teste de oito transacoes revelou que o upsert vazio do ORM fazia SELECT/INSERT e podia falhar na primeira criacao concorrente. Corrigido com INSERT ON CONFLICT DO NOTHING nativo e bloqueio da linha canonica. Reexecucao aprovada.
- Serie congelada no job orienta a preparacao, mesmo apos editar cadastro. Autorizacao e configuracao respeitam a mesma ordem empresa -> sequencia, evitando inversao de bloqueios. Atualizacao de empresa/numeração foi reunida em transacao; a revisao completa de propriedade/perfil ainda esta pendente.
- Configuracao mostra numero reservado e proximo candidato local; nao promete disponibilidade fiscal. Respostas antigas nao sobrescrevem consulta nova. Consulta HEAD verifica apenas numeros consecutivos ate a primeira lacuna, nao descobre todos os numeros usados externamente.
- Sincronizacao de numeração restrita ao cliente/contador autorizado e limitada por empresa; API nao devolve token de posse. Consulta de uma nota por suporte continua separada. A sincronizacao HEAD ainda depende da requisicao HTTP e precisa de revisao operacional/limite de duracao.
- O armazenamento atual limita nDPS a 2147483647; esgotamento bloqueia sem truncar/reiniciar. Numero oficial de NFS-e e outro campo (textual, ate 13 digitos), nao alterado por essa restricao.
- Evidencia atual: 129 testes unitarios/regressivos e 51 testes PostgreSQL (44 subtestes + sete grupos), zero falhas/SKIP; typecheck web/worker e lint sem erros. Nenhuma migracao adicional, build ou transmissao fiscal. Roteiro manual ampliado para 99 casos, ainda nao executado integralmente.
- Antes de ativar: parar TODOS os servidores/workers antigos. Versoes antigas nao participam do bloqueio canonico; nao misturar processos durante a transicao. Fazer a verificacao de backfill no clone protegido.
- O ciclo de novas homologacoes e a separacao de relatorios foram implementados no lote seguinte. Homologacoes legadas sem NotaFiscal ainda exigem recuperacao verificavel; nao habilitar producao para testar essa lacuna.

## Lote de homologacao, relatorios e exportacao

- Novas homologacoes persistem nota/arquivos, consultam/cancelam no ambiente original e nao consomem producao. Copia cria nova venda, preserva origem e exige revisao; nao ha conversao ou sobrescrita automatica.
- Relatorios separam PRODUCAO/HOMOLOGACAO/LEGADO, excluem canceladas dos valores e usam datas brasileiras com avisos de legado. PDF usa snapshot completo (ate 1.000 notas), ZIP valida todos os documentos/ambiente/empresa e tamanho antes de carregar blobs. Historico acessivel sem plano vigente.
- 137 testes unitarios/regressivos e 64 testes PostgreSQL passaram; typecheck app/worker e lint sem erros (41 avisos em 308 arquivos). Nova migracao 20260902140000 aplicada somente em QA: 34 aplicadas, oito pendentes no original.
- Navegador autenticado de QA: filtros, paginacao, acesso sem plano, homologacao/legado, copia para revisao sem envio e erro controlado de PDF indisponivel. Inspecao mobile em 390 x 844 e sete paginas de PDF sintetico. Nao equivale a execucao integral por perfil; captura do evento de download ainda requer aceite manual.
- Roteiro ampliado para 127 casos. Detalhes, limites de fonte Unicode e reproducao segura em RELATORIOS-E-HOMOLOGACAO.md; perfil e confirmação do ambiente em PERFIL-E-CONFIRMACAO-FISCAL.md. Backfill, worker compilado, portal real, carga e demais frentes permanecem pendentes.

## Lote de perfil, empresa e confirmação de emissão

- Dados pessoais e fiscais têm escopos separados e listas permitidas. Perfil não altera empresa; empresa não altera papel, contrato, propriedade ou usuário. O cadastro deixou de publicar regras tributárias compartilhadas ao salvar CNAEs.
- Atualização revalida acesso e versão sob bloqueio, grava empresa/CNAEs/sequência/auditoria atomicamente e rejeita abas antigas. CNPJ existente é imutável; cadastro inicial respeita CNPJ, titularidade, plano, cota e pendências.
- PFX/P12 tem base64/tamanho limitados antes do parser. Certificado e ativação de Produção exigem senha atual da conta; segredo não volta na API/auditoria. Certificado para CNPJ alfanumérico permanece explicitamente bloqueado até homologação, sem remover letras.
- Nova emissão exige a empresa e o ambiente vistos na revisão. Mudança antes do envio não cria venda/job/reserva; replay idempotente devolve somente o job originalmente congelado.
- Evidência: 142 testes unitários/regressivos e 75 PostgreSQL, typecheck app/worker e lint sem erros. QA visual conferiu campos vazios, contato separado, senha para Produção, duas abas e perfil pessoal. Roteiro cumulativo: 127 casos, ainda não executado integralmente.

## Lote de manutenção administrativa — 03/09/2026

- API e UI administrativas de empresas/tomadores agora exigem senha, justificativa, versão e escopo. Dados mínimos e paginação substituem leitura de certificados e carteiras completas; edição não altera identidade, propriedade, ambiente ou sequência.
- Arquivar não exclui nem cancela. Empresa com notas/jobs/vendas/rascunhos não pode ser ocultada. Tomador com pendência fiscal não pode sair da carteira. Restauração preserva vínculos e confere capacidade atual, sem benefícios ou propriedade novos.
- Papel/senha/versão são revalidados sob bloqueio; alterações e auditoria são atômicas. Emissão reconfere o tomador depois de esperar o mesmo bloqueio, evitando criar tarefa com cadastro arquivado/alterado. Helper do tomador participa da transação fornecida.
- Evidência naquele lote: 146 unitários, 88 PostgreSQL (77 subtestes e onze grupos), typecheck app/worker e lint sem erros (41 avisos em 317 arquivos). Navegador: MFA, senha incorreta, edição válida de empresa/tomador e duas abas. Dezesseis verificações HTTP locais de limites, papéis, histórico e arquivo/restauração passaram.
- Original inspecionado somente para leitura e preservado: 8 usuários, 35 empresas, 114 notas, 157 vendas, 117 jobs; nove migrações pendentes. Servidor e fixtures temporários de UI encerrados/limpos. Nenhum build ou worker real executado.
- Roteiro cumulativo: 141 casos, ainda não executado integralmente. Detalhes em MANUTENCAO-ADMINISTRATIVA.md. Naquele momento, os atalhos de propriedade ainda aguardavam revisão; o lote abaixo os substitui. Cadastro comum de clientes e transferência/recuperação continuam pendentes.

## Lote de empresas da conta — 03/09/2026

- Fechados os atalhos administrativos de trocar CNPJ, assumir cadastro por documento público, remover proprietário e abandonar principal legado. Rotina não utilizada de atribuição automática em lote removida; nenhum dado original foi apagado.
- Novo cadastro em homologação reutiliza a cota transacional do cliente; não cria contrato, vínculo contábil ou custódia. Preferência principal é uma operação separada, versionada, entre empresas já pertencentes à conta.
- Papel e senha atuais, bloqueios, idempotência/repetição própria e auditoria na mesma transação; listagem paginada/minimalista e painel compartilhado. Seleção contratual inicia vazia, sem suspensão implícita na tela.
- Evidência atual: 151 unitários e 101 PostgreSQL (89 subtestes/12 grupos), sem falhas na execução final. HTTP local: 32 verificações aprovadas; navegador: revisão/campos, erro de CNPJ/senha, foco e opção contratual explícita. Troca positiva e criação foram exercitadas por HTTP, não declaradas como aceite integral do navegador.
- Banco original preservado, nove migrações pendentes, build e compilação do worker reservados ao proprietário. Roteiro cumulativo: 173 casos. Ver EMPRESAS-DA-CONTA.md.
- Transferência/recuperação com prova e consentimentos, listagens restantes de usuários/CRM e recuperação de e-mail permanecem pendentes. Bloquear atalhos não equivale a concluir esses fluxos.

## Fechamento técnico de segurança, LGPD e operação — 09/09/2026

- Autenticação passou a usar sessões revogáveis, MFA obrigatório para equipe, proteção CSRF transversal, reautenticação nas ações críticas, hierarquia de papéis e impersonação somente leitura com prazo. Alteração/recuperação de senha e troca de e-mail revogam acessos antigos e usam provas de uso único sem token em claro.
- Isolamento por empresa, propriedade/custódia, manutenção, transferência, relatórios, arquivos e filas foi aplicado no servidor e reforçado no PostgreSQL. Operações financeiras, fiscais e de titularidade usam locks, versão/idempotência e auditoria atômica; suporte e comercial não recebem privilégios fiscais ou administrativos implícitos.
- Emissão/cancelamento usam filas duráveis, posse com expiração, conciliação sem segundo POST, crédito transacional, documento fiscal original e XSDs oficiais versionados. Certificado A1 tem limite, validação de chave/cadeia/uso/CNPJ e armazenamento autenticado; Produção permanece fechada sem configuração e validação operacional.
- Direitos LGPD ganharam central do titular, exportação mínima, protocolos/prazos, fila administrativa, bloqueios de retenção e anonimização segura. Aceites jurídicos vigentes são obrigatórios, autenticados, idempotentes e guardam somente hashes técnicos de evidência.
- Registro de incidentes ganhou protocolo, prazo preliminar, avaliação de risco, contenção, comunicações, versão concorrente, progressão de estado, imutabilidade após encerramento e retenção. Health/readiness, diagnóstico sanitizado, headers de segurança e cache privado foram adicionados.
- Falhas de SMTP passam para outbox durável com conteúdo cifrado, deduplicação, lease, expiração e backoff. Limpeza automática é seletiva e exclui registros fiscais, comerciais, jurídicos, incidentes e auditoria.
- Enquanto não existir provedor de cobrança, somente `BILLING_MODE=MANUAL` é aceito em produção. Comprovante nunca ativa plano: análise, valor exato, referência única, segregação de funções e auditoria continuam obrigatórios.
- Evidência automatizada deste fechamento: **195 testes unitários/regressivos** e **145 testes PostgreSQL isolados**, zero falhas ou skips; typecheck web/worker, lint completo e validação das migrações aprovados. O QA inclui identidade fiscal única por CNPJ, isolamento de e-mail/telefone/I.M. entre carteiras, concorrência e snapshot imutável, além do benefício administrativo ilimitado sem ampliar autorização. As **50 migrações** estão aplicadas no banco sintético de QA e no `nfse_db`. A migração mais recente consolidou 28 relações PJ em 23 identidades, preservando 8 usuários, 35 empresas, 48 relações, 114 notas, 157 vendas e 117 jobs. Nenhum build, compilação de worker ou transmissão fiscal foi executado.
- O login MFA usa desafio opaco de dez minutos e prova de uso único. Aplicativo pode confiar no navegador por sete dias; e-mail por 24 horas; recuperação nunca cria confiança. Contador passou a exigir MFA, enquanto cliente comum pode optar por ativá-lo. Troca de senha, e-mail, autenticador ou códigos de recuperação revoga dispositivos confiáveis.
- A conta interna que também é titular de PJ volta a enxergar somente sua própria empresa na área do cliente, sem herdar acesso a empresas por causa do papel administrativo. A sessão HttpOnly corrige a identidade local de compatibilidade fora da impersonação auditada.
- Roteiro manual consolidado em `TESTES-MANUAIS.md`: **225 casos** para cliente, contador, suporte, comercial, ADMIN/MASTER e operação técnica. A execução humana permanece pendente.

## Gates finais de lançamento

1. **CONCLUÍDO NO CÓDIGO/QA:** testes automatizados de autenticação, RBAC, multitenancy, identidade fiscal global, cobrança manual, filas e concorrência (195 unitários + 145 PostgreSQL).
2. **CONCLUÍDO COM FIXTURES:** schemas oficiais versionados, assinatura, retorno, emissão, cancelamento e documentos fiscais no escopo implementado. **PENDENTE:** homologação externa real.
3. **PENDENTE:** executar e documentar os 209 casos manuais por perfil.
4. **PENDENTE E RESERVADO AO PROPRIETÁRIO:** `npm run build`, compilação do worker e revisão dos resultados.
5. **PENDENTE:** homologação externa com certificados/credenciais autorizados e escopo municipal/nacional definido.
6. **PENDENTE:** restaurar backup real em clone, medir RPO/RTO, configurar monitoramento/alertas e ensaiar resposta a incidente.
7. **PENDENTE EXTERNO:** aprovação jurídica/fiscal, identidade/canais reais nos documentos, responsável financeiro/incidentes e infraestrutura de produção.
8. **PENDENTE NO AMBIENTE FINAL:** executar `npm run readiness:production` até não haver `BLOCK` e triar todo `WARN`.

Estado do objetivo: ativo. Esta lista nao representa conclusao ou certificacao de conformidade.
