# Worker de emissões: implantação e continuidade

O Next.js somente registra a solicitação. A DPS é transmitida pelo processo independente `workers/emission-worker.ts`.
Sem esse serviço, a venda pode ficar em `PROCESSANDO` e a tarefa em `PENDENTE`, com zero tentativas; isso **não** significa rejeição fiscal.

## Desenvolvimento local (Windows)

 Para desenvolvimento local, pare qualquer servidor antigo e execute `npm run dev` (ou `npm run dev:full`, equivalente). O comando compila o worker e inicia Next e worker juntos. Se qualquer um terminar, encerra o outro para não deixar o site aceitando solicitações com o processador parado. Uma tarefa de homologação já pendente será retomada ao iniciar o worker; confira a venda original antes de tentar emitir novamente. `npm run dev:web` inicia apenas o Next e deve ser usado somente quando nenhuma emissão será testada.

 Como alternativa manual, após alterar o código do worker, execute `npm run worker:compile`. Em outro terminal, mantenha `npm run worker:local` aberto junto do `npm run dev`.
O worker local lê `.env`. Sem `FISCAL_WORKER_ALLOW_PRODUCTION=true`, ele processa homologação, mas não inicia novos envios de produção.
Não altere essa variável para resolver uma fila sem autorização fiscal e operacional.
 `dev:full` força `FISCAL_WORKER_ALLOW_PRODUCTION=false`, mesmo se `.env` tiver outro valor. O worker também executa outras tarefas internas; mantenha este comando somente em um ambiente de desenvolvimento controlado.

 Uma nova solicitação de emissão é recusada com mensagem explícita quando não há heartbeat recente do worker de emissões (e, em produção, quando o worker não está habilitado para produção). Nenhuma venda ou tarefa nova é gravada nessa recusa. Isso evita o bloqueio silencioso, mas não elimina a possibilidade de o worker parar logo após aceitar uma tarefa; por isso o supervisor e o monitor externo continuam obrigatórios.

## Produção (exemplo systemd)

1. Na etapa de release, execute os testes e `npm run worker:compile`. Distribua `dist/worker`, `scripts/register-worker.cjs`, Prisma Client, `node_modules` de produção, recursos fiscais versionados e os assets do DANFSe. Confirme o diretório de trabalho e a versão de Node.
2. Crie `/etc/nfsegoo/emission.env` com acesso restrito ao usuário do serviço. Configure `DATABASE_URL` e os segredos/variáveis necessários à aplicação. Defina `NODE_ENV=production`. Mantenha `FISCAL_WORKER_ALLOW_PRODUCTION=false` até concluir os gates fiscais, de certificado, confiança e homologação real descritos em `HOMOLOGACAO-FISCAL.md`. Em produção, a opção `true` só inicia com manifesto aprovado, vigente e compatível com o código fiscal; ausência ou divergência encerra o worker antes do heartbeat e de qualquer captura de tarefa.
3. Adapte `deploy/systemd/nfsegoo-emission.service.example` ao usuário e caminhos reais, instale como `nfsegoo-emission.service`, execute `systemctl daemon-reload` e `systemctl enable --now nfsegoo-emission.service`. Confirme `systemctl status nfsegoo-emission.service` e os logs do serviço. Não exponha o arquivo de ambiente em logs ou repositório.
4. Execute `node scripts/check-emission-worker.cjs` com as variáveis do serviço e integre seu **código de saída 2** ao monitor externo. Execute a cada minuto; alerte o responsável de plantão quando faltar heartbeat de emissão, houver fila atrasada/posse expirada, conciliação manual ou faltar worker de produção quando exigido. O script não transmite notas nem escreve no banco. A página `/admin/emissoes` mostra o mesmo alerta, mas não substitui monitoramento fora do navegador.
5. Execute o gate `npm run readiness:production` somente depois de o serviço estar saudável. Ele não aceita heartbeat de worker de documentos/consultas como prova de que o emissor está ativo.

O `Restart=always` reinicia o processo quando ele termina; **não** detecta sozinho um processo vivo porém sem progresso. O monitor externo e a idade da fila cobrem esse caso. Em um incidente, consulte o status e os logs, recupere o serviço e confira a tarefa original. Não crie outra venda, não altere o status por SQL e não reenvie uma DPS com resultado remoto incerto.

## Teste de aceitação antes de comercializar

1. Em homologação, solicite uma única nota e confirme que a tarefa passa de `PENDENTE` para resultado fiscal ou erro explícito, com heartbeat `emission-` recente.
2. Pare o worker entre a criação e a captura de uma segunda tarefa. Verifique alerta de indisponibilidade e que a tarefa permanece no banco sem transmissão.
3. Reinicie o serviço pelo supervisor e confirme que **a mesma tarefa** é retomada uma vez, sem segunda venda ou novo clique de emissão.
4. Provoque um encerramento controlado após uma transmissão em ambiente de teste apropriado; confirme que a recuperação consulta a DPS original, sem novo POST. Esse teste exige coordenação fiscal e não deve ser feito com uma nota real de cliente.
5. Simule a ausência de heartbeat com o monitor externo e comprove entrega do alerta a uma pessoa responsável.

Este repositório fornece o processo, o modelo de serviço e os sinais de saúde. Instalar o serviço no host, configurar o monitor externo e aprovar a transmissão de produção continuam sendo etapas obrigatórias do rollout; o código não pode fazê-las automaticamente no servidor que ainda não foi definido.
