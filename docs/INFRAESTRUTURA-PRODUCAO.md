# Infraestrutura operacional de produção

Esta etapa transforma requisitos soltos em um contrato operacional verificável. O arquivo real deve partir de `config/infrastructure.example.json`, ficar fora do repositório e ser indicado por `INFRASTRUCTURE_EVIDENCE_FILE`. Ele não contém senhas, tokens nem credenciais: somente decisões aprovadas e referências a runbooks/evidências protegidas.

## Topologia mínima

- HTTPS termina em proxy ou balanceador; o processo Next escuta somente na rede privada/loopback.
- PostgreSQL 16 ou superior é gerenciado, privado, cifrado em repouso e acessado com `sslmode=verify-full`. O orçamento de conexões soma web, três workers, migração e folga operacional.
- Web, emissão, documentos e consultas são processos independentes. Cada um reinicia automaticamente e valida release, evidência de infraestrutura e migrações antes de iniciar.
- Segredos ficam em cofre versionado. O diretório do release é instalado por uma identidade diferente do usuário `nfsegoo`; o usuário do serviço não deve alterar código ou manifestos.
- Logs são centralizados por ao menos 30 dias. Uma sonda externa consulta `/api/health/live`; o balanceador só envia tráfego quando `/api/health/ready` responde 200.

O diretório `deploy/systemd` contém quatro serviços de referência e `deploy/nginx` contém o proxy. São exemplos: ajuste caminhos, limites e mecanismo de segredos à hospedagem e valide-os em staging.

## Responsabilidades no dia a dia

Uma pessoa pode acumular funções neste estágio do SaaS, mas cada função precisa ter dono e escalonamento explícitos:

| Papel operacional | Responsabilidade real |
| --- | --- |
| APPLICATION | deploy/rollback, capacidade web e workers, compatibilidade do release |
| DATABASE | PostgreSQL, TLS, capacidade, conexões, manutenção e migrações |
| BACKUP_RESTORE | política, restauração trimestral, RPO/RTO e evidência |
| SECURITY_SECRETS | cofre, rotação, acesso mínimo e recuperação da `ENCRYPTION_KEY` |
| OBSERVABILITY | sondas externas, alertas, logs, filas e certificado próximo do vencimento |
| INCIDENT_RESPONSE | triagem, contenção, comunicação, ANPD/titulares quando aplicável |

## Backup e teste de restauração

O backup do PostgreSQL inclui XML/PDF armazenados no banco, mas não torna os certificados utilizáveis sem a mesma `ENCRYPTION_KEY`. A cada teste trimestral:

1. restaure o backup em projeto/rede isolados, sem saída para os portais fiscais;
2. injete uma cópia controlada da chave por meio do cofre, nunca por arquivo no release;
3. execute os gates de release e migração, conte registros e faça login apenas com conta QA;
4. abra XML/PDF de amostra e valide a leitura controlada de certificado, sem emitir/cancelar/consultar externamente;
5. meça RPO e RTO, guarde logs/capturas no repositório de evidências e atualize `restoreTestedAt`/`evidenceRef`;
6. destrua o ambiente e revogue as credenciais temporárias.

O gate aceita no máximo RPO 24h, RTO 8h, retenção de backup de sete dias e teste de restauração com até 120 dias. Isso não cria o backup: confirma que a operação real foi executada e aprovada.

## Sequência de deploy

1. Instale exatamente o artefato selado e os arquivos de ambiente/cofre.
2. Execute `npm run readiness:release`, `npm run readiness:infrastructure` e `npx prisma migrate status`.
3. Aplique `npx prisma migrate deploy` com o proprietário das estruturas e execute `npm run readiness:migrations`.
4. Inicie os três workers e confirme seus heartbeats.
5. Inicie a web; confirme `live` e depois `ready`.
6. Execute `npm run readiness:production`; somente então habilite tráfego.

O readiness agora compara todo o inventário de migrações entregue no release com o banco e exige os três workers em produção. Uma migração antiga isolada não é mais aceita como prova de schema atualizado.
