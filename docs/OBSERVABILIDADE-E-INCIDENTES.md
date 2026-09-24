# Observabilidade, alertas e resposta operacional

O SaaS possui duas camadas complementares. Um monitor **externo** consulta o domínio público e detecta perda do host, DNS, TLS ou proxy. O comando interno `npm run monitor:operational` consulta essas mesmas sondas e, em modo somente leitura, agrega banco, workers, filas, e-mail, certificados e prazos legais. Executar apenas o timer no mesmo servidor não detecta a queda completa do servidor.

Nenhuma sonda devolve XML, PDF, certificado, nome, documento, e-mail, identificador de cliente ou mensagem de erro interna. O resultado contém somente estado, contagem e referência de runbook.

## Estados e prioridades

| Sinal | Prioridade | Resposta inicial sugerida |
| --- | --- | --- |
| Web, readiness ou banco indisponível | P1 crítica | até 15 minutos |
| Worker de emissão, documentos ou consultas ausente | P1 crítica | até 15 minutos |
| Tarefa aguardando/retry/lease vencido por mais de 5 minutos | P1 crítica | até 15 minutos; não reenviar operação fiscal |
| Certificado vencido ou a até 7 dias | P1 crítica | contato e rotação imediatos |
| Prazo de titular ou incidente relevante vencido | P1 crítica | acionar privacidade/incidente imediatamente |
| Conciliação/revisão manual ou e-mail terminal | P2 alerta | no mesmo turno operacional |
| Certificado entre 8 e 30 dias | P2 alerta | planejar renovação com o titular |

`monitor:operational` retorna `0` para OK, `1` para alerta e `2` para crítico. O agendador/fornecedor deve transformar os códigos em notificação para o canal indicado por `MONITORING_ALERT_CHANNEL_REF`, deduplicar ocorrências iguais e registrar reconhecimento/resolução. Durante deploy programado, use janela de manutenção; não desabilite definitivamente a sonda.

## Implantação

1. Cadastre no provedor externo `/api/health/live` e `/api/health/ready` usando HTTPS. O primeiro prova que o processo responde; o segundo só aceita tráfego com schema e workers aptos.
2. Configure `MONITOR_TARGET_BASE_URL` com a mesma origem de `NEXT_PUBLIC_APP_URL`. Referências de provedor, responsável, canal e runbook não são URLs secretas nem webhooks.
3. Instale o serviço/timer de exemplo de `deploy/systemd` ou uma tarefa equivalente da plataforma. O processo precisa somente de leitura no banco; não use o proprietário das migrações.
4. Encaminhe stdout JSON e códigos de saída para a ferramenta de observabilidade. Nunca copie `DATABASE_URL` ou variáveis do cofre para o alerta.
5. Faça um teste controlado de cada sinal em staging e registre horário, recebimento, reconhecimento e resolução.

## Fluxo de resposta

1. **Reconhecer:** confirmar que alguém assumiu o alerta e abrir a referência do runbook.
2. **Classificar:** disponibilidade operacional não é automaticamente incidente LGPD. Se houver suspeita de acesso, perda, alteração ou exposição de dados, registre imediatamente no módulo de incidentes.
3. **Conter:** preserve filas e idempotência. Parar o worker é preferível a reenviar emissão/cancelamento incerto.
4. **Recuperar:** restaure serviço, confirme heartbeats e aguarde o readiness retornar 200. Concilie tarefas incertas somente por consulta.
5. **Documentar:** registre linha do tempo, causa, impacto, decisão e ações preventivas. Incidentes com risco relevante seguem avaliação e comunicações formais; o monitor nunca cria ou encerra esse registro automaticamente.

## Teste periódico

Mensalmente em staging: interrompa cada serviço isoladamente, simule tarefa vencida, use certificado sintético próximo do vencimento e valide saídas `WARN`/`CRITICAL`. Trimestralmente combine o exercício com a restauração descrita em `INFRAESTRUTURA-PRODUCAO.md`. Nunca provoque falhas fiscais ou prazos legais no banco de produção apenas para testar alertas.
