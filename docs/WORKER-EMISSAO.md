# Fila durável de emissão — implantação e verificação

Para instalação supervisionada do processo emissor, monitor externo e teste de retomada, consulte [Operação do worker de emissões](OPERACAO-WORKER-EMISSAO.md). O modelo de serviço agora está em `deploy/systemd/nfsegoo-emission.service.example`.

Estado: código e migrações validados em PostgreSQL QA sintético (50 migrações, 146 testes integrados; 200 unitários na revisão de 16/09/2026). Backfill do histórico original, processo compilado e homologação externa ainda não validados. Não publicar este lote isoladamente. Nenhum worker real foi iniciado e nenhum build foi executado nesta etapa.

## Garantias e limites do desenho

1. A API registra venda, reserva de crédito e tarefa na mesma transação. Ela não transmite a DPS nem inicia processamento com `setTimeout`/`after`.
2. Um processo Node independente assume a tarefa com um token de posse válido por 120 segundos, renovado a cada 20 segundos. As gravações verificam token, estado e validade sob bloqueio transacional. A restrição parcial do PostgreSQL impede duas tarefas `PROCESSANDO` da mesma empresa.
3. A numeração é reservada de forma crescente por empresa, ambiente e série numérica canônica (900/0900/00900 são a mesma); o número de uma tentativa rejeitada não é reutilizado automaticamente. XML assinado, identificador e metadados são persistidos antes da fronteira de envio.
4. A fronteira de transmissão é gravada antes do POST. Depois dela, qualquer retomada é **somente consulta GET da DPS original e da NFS-e correspondente**. Não há segundo POST automático, troca de número, reassinatura ou mudança de ambiente para “tentar funcionar”.
5. Uma autorização só é aceita após conferir XSD versionado, assinatura XMLDSig SHA-256, chave, ambiente, identificador e conteúdo canônico da DPS preparada. Os dados são extraídos da referência efetivamente assinada; XML inválido, divergente, excessivo ou com DTD/entidades não liquida a operação. A origem governamental depende do cliente mTLS/TLS, não de confiar em qualquer certificado embutido. Cadeia ICP-Brasil/revogação e homologação real continuam pendentes. A adaptação pontual de regex do pacote XSD está documentada em `resources/fiscal/xsd/README.md`.
6. Autorização, crédito consumido, nota, venda, log, notificações e tarefa de DANFSe são gravados juntos. O DANFSe usa fila independente e não pode mudar o resultado fiscal ou consumir outro crédito. XML de homologação fica no job, sem virar receita/nota de produção.
7. Rejeição fiscal estruturada e comprovada encerra a tarefa e devolve a reserva. Timeout, resposta genérica, duplicidade e falha de infraestrutura não provam rejeição. O esgotamento vai a `RECONCILIACAO_MANUAL`, preservando crédito e bloqueando a sequência daquela empresa.

Não se promete “exatamente uma vez” entre banco e serviço remoto. Uma queda entre gravar a fronteira e efetivamente enviar pode deixar a DPS não localizada no portal. A escolha é conservadora: exigir conciliação em vez de arriscar outra emissão. Um 404 isolado não é autorização para reenviar ou devolver crédito.

A consulta por DPS e a recuperação do XML por chave seguem os serviços descritos no [manual oficial do Emissor Público Nacional](https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual/manual-contribuintes-emissor-publico-api-sistema-nacional-nfs-e-v1-2-out2025.pdf/view). O transporte novo usa mTLS, valida TLS, proíbe redirecionamentos, limita tempo/tamanho e não transmite a senha do PFX em Basic Authorization.

## Numeração: transição e limites

- Todas as reservas/configurações/confirmações usam a mesma linha canônica e inserção atômica no PostgreSQL. Máximos dos aliases e das tarefas históricas são conservados; tarefas rejeitadas não liberam o número. XML e linhas legadas não são reescritos.
- O contador antigo `Empresa.ultimoDPS`, sem identidade de série, permanece como piso conservador de produção. Pode causar saltos; nunca é motivo para diminuir/reiniciar a sequência. Não entra na sequência de homologação.
- Série é congelada no job e usada na preparação. Mudança posterior da configuração não altera a identidade reservada.
- Limite de armazenamento atual de nDPS: 2147483647. Ao esgotar, bloquear e revisar a capacidade/escopo; não truncar para caber nem reiniciar em 1. Esse limite não altera o número oficial textual da NFS-e.
- É obrigatório parar todas as versões antigas de web/worker antes de ativar a nova. Processo antigo pode ignorar o bloqueio canônico; teste verde não torna rollout misto seguro.
- HEAD continua sendo leitura externa sequencial, limitada em quantidade, sem garantir números depois da primeira lacuna. A API informa um candidato, não reserva; sua execução HTTP ainda precisa de revisão de duração/operabilidade.

## Identidade da solicitação na interface

- Duplo clique é protegido imediatamente. Repetir o mesmo formulário reutiliza a chave; campos alterados exigem resolver a solicitação anterior.
- O navegador guarda somente chave e hash em `sessionStorage`, não descrição, documentos, valores ou certificado.
- Há uma solicitação não conferida por operador/empresa no servidor. Ela reaparece após novo login, mesmo que o armazenamento local tenha sido limpo. Resultado terminal é conferido por um PUT explícito; GET permanece sem efeitos de escrita.
- Descartar uma solicitação não registrada grava um bloqueio da chave sob o mesmo bloqueio de empresa usado no enfileiramento. Uma requisição antiga atrasada não pode ressuscitá-la. Se o job já existir, ele é devolvido para acompanhamento: o descarte não cancela nota nem apaga tarefa.
- O painel do cliente distingue conciliação de falha definitiva e oferece suporte sem botão de reenvio. Reenvio de uma venda abre o formulário para revisão. A bancada interna registra proposta de correção, sem emitir em nome do cliente ou alterar o valor fiscal da venda.

## Implantação planejada (ainda não executada)

1. Seguir `MIGRACAO-CONSUMO.md`: backup restaurado e conferido, alvo confirmado, relógios sincronizados e PostgreSQL configurado em UTC. Interromper servidores/workers antigos e conciliar todas as emissões legadas em voo antes das migrações.
2. Aplicar no clone a sequência completa, incluindo `20260902120000_durable_emission_worker` e `20260902130000_durable_note_operations`. Não usar `db push`: as restrições/índices parciais são parte obrigatória do SQL. Não remover o preflight para “destravar” a migração.
3. Gerar Prisma Client; executar `npm run typecheck`, `npm run worker:typecheck`, `npm run test:unit`, `npm run lint` e os testes de integração com opt-in somente no clone local. SKIP não aprova o gate.
4. O proprietário executará `npm run build`. O worker tem compilação separada, também reservada ao proprietário: `npm run worker:compile`. Esse comando gera `dist/worker`; o runtime não depende do carregador de testes nem do compilador TypeScript.
5. Empacotar `dist/worker`, `scripts/register-worker.cjs`, dependências de produção/Prisma Client e os recursos de `public` utilizados pelo DANFSe, `resources/fiscal/xsd`, `resources/fiscal/icp-brasil-roots-20260826.pem` e os assets de `libxml2-wasm`. Manter diretório de trabalho na raiz da aplicação. Validar a instalação limpa e o carregamento dos módulos compilados antes de implantar.
6. Iniciar aplicação web e worker como serviços supervisionados independentes. Worker: `npm run worker:start`; desenvolvimento com arquivo local: `npm run worker:local`. O script de produção espera variáveis injetadas pelo ambiente e não lê `.env` automaticamente.
7. `EMISSION_WORKER_CONCURRENCY` aceita inteiros de 1 a 8, padrão 2. Dimensionar conexões PostgreSQL somando todos os processos web/workers. Começar com baixa concorrência e medir latência, memória, pool e filas.
8. Por padrão, o worker NÃO faz novos POSTs de produção. `FISCAL_WORKER_ALLOW_PRODUCTION=true` só deve ser definido pelo operador após os gates fiscais/operacionais. Consultas de tarefas já transmitidas continuam permitidas para não impedir conciliação. Não habilitar essa opção para testes sintéticos.
9. SIGINT/SIGTERM param novas capturas e aguardam tarefas em andamento. Configurar janela de encerramento suficiente para o timeout remoto e finalização no banco (ao menos 120 segundos). Morte forçada exige recuperação pelo lease e, se necessário, conciliação.

O `docker-compose.yml` atual provisiona apenas PostgreSQL. Ainda não existe imagem/manifesto completo de produção validado para web, worker, cofre, backups e monitoramento.

## Operação e incidentes

- `GET /api/admin/emissoes/retomar`, com sessão de suporte/admin, informa heartbeat, presença de worker habilitado para produção, estados das filas de emissão, operações de nota e DANFSe. “Online” indica atividade do processo, não prova autorização fiscal nem sucesso das tarefas.
- O mesmo GET inclui `documentHealth`: heartbeat recente do processador de documentos (ou worker completo), quantidade por estado, atraso de tarefas, posse expirada e revisão manual. Monitore `needsAttention` externamente; o navegador não é supervisor de processos.
- Heartbeats são gravados a cada 15 segundos. Registros operacionais dessa tabela com mais de sete dias são removidos; isso não remove logs de auditoria, notas ou jobs. Configurar alerta de ausência por 60 segundos, crescimento/idade de filas, conciliações manuais, falhas de DANFSe e erros do banco.
- `POST` nessa rota não executa envio: apenas ADMIN/MASTER reautenticado pode solicitar novas consultas de um job em conciliação com XML original e fronteira já registrados. Exige `jobId`, `adminPassword` e `justification`; gera auditoria. O segredo antigo de cron não concede acesso.
- Nunca alterar payload, `signedXml`, DPS, ambiente, reserva ou status para forçar reenvio de um resultado incerto. Preservar evidência, consultar o portal com o certificado apropriado e registrar análise. Resultado remoto conflitante exige revisão fiscal; não há botão de “ignorar e devolver crédito”.
- Falhas definitivas de preparação são corrigidas pelo cliente/contador em nova solicitação. Falhas operacionais esgotadas antes do envio ainda precisam de fluxo administrativo dedicado de recuperação; não usar SQL informal como solução operacional.
- Reprocessamento de PDF não implica cancelamento/reemissão. Rotas de consulta/cancelamento agora apenas enfileiram operações; PDF também usa o worker e não é renderizado nas requisições HTTP. Downloads validam acesso, possuem limite de descompressão e não carregam blobs na listagem.

## Casos técnicos a executar no clone/homologação

| Caso | Resultado exigido |
| --- | --- |
| Oito capturas simultâneas na mesma empresa | Uma posse; outras empresas progridem independentemente |
| Morte do worker e lease vencido | Outra posse com token diferente; gravação do token antigo recusada |
| Queda depois do POST, antes do commit local | Só GET na recuperação, XML original e mesmo ambiente, um crédito consumido |
| Resposta com outra chave/DPS/valor ou XML inválido | Nenhuma nota falsa; reserva preservada e conciliação |
| Portal responde 404/timeout repetidamente | Sem novo POST; esgotamento manual e empresa bloqueada |
| Rejeição fiscal confirmada na primeira transmissão | Erro definitivo e uma devolução no ciclo original |
| Revogação de vínculo/alteração de ambiente antes do envio | Nenhum POST e rejeição local; depois da transmissão, ainda conciliar o ambiente original |
| Falha entre criar nota e consumir crédito | Rollback integral; recuperação não duplica a nota |
| PDF falha ou situação muda durante a geração | Autorização/crédito preservados; PDF não sobrescreve cancelamento concorrente |
| Resposta do registro perdida; recarregar/sair e entrar | Solicitação anterior reaparece; nova chave não cria outra venda sem conferência |
| Descarte corre contra POST atrasado | Ou job existente acompanhado, ou chave bloqueada sem criação tardia |

Há quatorze suítes de integração PostgreSQL, incluindo emissão/operações de nota com transporte simulado e escopo restrito às empresas das fixtures. Foram aprovados 111 testes no banco sintético isolado. O banco original não foi migrado. Transporte simulado, testes unitários e typecheck não substituem ensaio real de migração, processo compilado, teste de carga e homologação externa.

## Operações de nota: cancelamento e consulta

- `FiscalNoteOperation` congela nota/empresa, ator, ambiente, chave, documento do prestador, hash do XML original e justificativa. Uma operação ativa por nota e por ambiente/chave inclui estados de conciliação manual.
- `POST /api/notas/gerenciar` com CANCELAR exige `idempotencyKey`, `reasonCode` (1/2/9) e `justification` real de 15..255 caracteres. Somente COMUM/CONTADOR com vínculo atual. Não verifica saldo nem devolve crédito de emissão.
- `POST /api/notas/consultar` e sincronização administrativa agendam consulta. Resposta 202 não significa nota cancelada ou consulta concluída. `GET /api/notas/operacoes/[id]` consulta estado local, sem transmitir ou alterar dados.
- Worker prepara/assina antes de persistir a fronteira; após a fronteira, só consulta eventos pela chave/ambiente originais. Motivo, pedido ecoado e E0840 não substituem evento autorizado.
- Conciliação manual de nota: `POST /api/admin/emissoes/retomar` aceita `operationId` em vez de `jobId`, além de senha/justificativa. ADMIN/MASTER pode reabrir consultas, nunca limpar marcador/reassinar/reenviar.
- Evento conclusivo é validado por XSD/assinatura, chave, ambiente, tipo e sequência. Dados oficiais só são persistidos sob posse válida. Consulta não restaura AUTORIZADA sobre cancelamento já comprovado.
- Cancelamento invalida o PDF anterior e agenda revisão da tarefa documental. Worker antigo não pode salvar depois de perder token/revisão ou depois de mudar estado/XML/evento. Nota é bloqueada antes da tarefa documental nas transações que envolvem ambas.
- Falha de PDF vai a `REVISAO_MANUAL` após oito tentativas. Suporte solicita regeneração após verificar origem; download do cliente não reinicia indefinidamente uma falha manual.
- `GET /api/notas/[id]/arquivos` oferece XML ou ZIP XML+evento sob demanda; não altera status. O XML continua preservado separadamente do evento.
- Falta disponibilizar integralmente o ciclo de documentos/operações para novas emissões de homologação: hoje seu XML permanece no job. Não testar cancelamento em produção para contornar essa limitação. Ver roteiro cumulativo `TESTES-MANUAIS.md`.

Os caminhos de eventos seguem o [manual oficial, seção 1.5](https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual/manual-contribuintes-emissor-publico-api-sistema-nacional-nfs-e-v1-2-out2025.pdf/@@download/file). Swagger não acessível nesta verificação; formato de resposta, endpoint do ambiente restrito e comportamento real exigem homologação com credencial autorizada. Não afirmar compatibilidade externa só pelos mocks.

## Consultas fiscais: processamento e alerta

- Uma consulta `CONSULTAR` é uma operação durável de leitura do portal, não uma nova emissão. O worker completo processa essas operações. Há também o processo independente `npm run worker:consultations:start` (`npm run worker:consultations:local` em desenvolvimento), que captura **somente** `CONSULTAR`. O comando local compila automaticamente o worker antes de iniciá-lo; não executa o build do site. O processo reinicia o filho com backoff em caso de queda. Ele não captura emissão, cancelamento, DANFSe nem e-mail e não depende de `FISCAL_WORKER_ALLOW_PRODUCTION`. Pode coexistir com o worker completo: a captura usa posse exclusiva no PostgreSQL. Não inicie o worker local apenas para limpar uma tela sem confirmar o certificado, o portal e o ambiente de destino.
- Em produção, web e worker(s) são serviços separados. Compilar o worker na etapa de release com `npm run worker:compile`, empacotar `dist/worker` e iniciar `npm run worker:consultations:start` sob o supervisor do host. Há um modelo para systemd em `deploy/systemd/nfsegoo-consultations.service.example`; substitua usuário, caminhos e arquivo de variáveis pela configuração real da hospedagem. O supervisor externo reinicia o processo principal, enquanto o supervisor Node reinicia o filho; configure também limite de memória, política de logs, parada graciosa (mínimo 120 segundos) e alerta externo para processo parado. O repositório não instala sozinho serviços no host; essa ativação faz parte do rollout.
- `GET /api/admin/emissoes/retomar` agora inclui `consultations`, visível apenas à equipe autorizada: `workerOnline`, `lastHeartbeatAt`, totais por estado, `waitingTooLong`, `retryOverdue`, `processingExpired`, `manual`, `needsAttention` e até 25 operações antigas com nota/empresa. O heartbeat é considerado recente por 45 segundos; o atraso de fila por 5 minutos. A página `/admin/consultas-fiscais` atualiza esses sinais a cada 15 segundos enquanto está aberta. O indicador ao cliente distingue “aguardando”, “consultando”, “atrasada” e “revisão manual”.
- A página interna **não substitui** alerta fora do navegador. Em produção, monitorar o processo e a resposta autenticada da rota acima, ou exportar essas métricas para o monitor corporativo. Disparar incidente quando `workerOnline=false`, qualquer contador de atraso for positivo ou `manual>0`. A ausência de heartbeat indica processo indisponível, não nota rejeitada. A página do cliente não deve ser usada como monitor operacional.
- O PDF tem um processo independente: compilar no release com `npm run worker:compile`, distribuir `dist/worker`, `scripts/register-worker.cjs` e dependências, e iniciar `npm run worker:documents:start` como serviço permanente. Um modelo para host Linux com systemd está em `deploy/systemd/nfsegoo-documents.service.example`; configure usuário, caminhos, ambiente e habilite o serviço no host durante o rollout. Em Docker/PaaS, configure um serviço/worker separado com o mesmo comando, política de reinício e shutdown de pelo menos 120 segundos. **Não** execute o worker como requisição HTTP, cron periódico nem pelo navegador. O worker completo também processa documentos; se ambos estiverem ativos, a fila usa posse exclusiva no PostgreSQL. Não precisa de `FISCAL_WORKER_ALLOW_PRODUCTION`: esse processo apenas gera PDFs locais, sem transmitir notas.
- Após restaurar um backup antigo, PDFs armazenados sem `EmissionDocumentTask` não são servidos como verificados. Com o worker compilado e o banco correto selecionado, execute `node --env-file=.env scripts/recover-restored-pdfs.cjs` para a prévia; revise o total e só então execute com `--apply`. O script valida XML, assinatura/chave/ambiente antes de enfileirar e não apaga PDFs nem altera autorização/cancelamento. Documentos incompatíveis com o esquema atual ficam fora da fila para revisão manual. O worker gera novos PDFs e marca a tarefa concluída; não marque tarefas como concluídas diretamente no banco para desbloquear downloads.
- Monitore `documentHealth.workerOnline`, `waitingTooLong`, `retryOverdue`, `processingExpired` e `manual` no endpoint administrativo (ou no monitor interno conectado a essas métricas). Heartbeat acima de 45 segundos é considerado ausente; atraso acima de 5 minutos merece investigação. Verifique logs do serviço, conexão com banco, schemas fiscais e fonte XML antes de retentar. Tarefa em `REVISAO_MANUAL` exige análise do suporte. Reiniciar o serviço não reemite nota e não resolve por si só documentos historicamente sem tarefa; esses documentos precisam de reconciliação controlada.
- Procedimento diário: verificar último heartbeat e backlog, consultar o log do worker e o estado do banco/portal; se o worker parou, corrigir a causa e reiniciá-lo pelo supervisor. Se a consulta está em retentativa, conferir `nextAttemptAt`, mensagem e número de tentativas. Se chegou a conciliação manual, confirmar a nota/chave/ambiente diretamente no portal com acesso autorizado e registrar evidência/justificativa antes de qualquer retomada administrativa. Nunca reenviar DPS ou cancelamento, alterar status com SQL ou marcar a nota como rejeitada por timeout/404. Ao resolver, confirmar que a operação ficou `CONCLUIDA`, que a situação da nota continua coerente e que o alerta cessou.
- O cliente pode solicitar ajuda em consulta atrasada. O ticket não executa operação fiscal nem reinicia a tarefa. Status/heartbeat não devem expor dados fiscais em uma rota pública. A saúde HTTP geral da aplicação não deve cair só por um backlog fiscal: a plataforma precisa continuar disponível para que a equipe diagnostique e o usuário acompanhe a nota.
