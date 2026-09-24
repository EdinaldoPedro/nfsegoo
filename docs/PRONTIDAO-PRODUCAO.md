# Gate de prontidão para produção

O comando `npm run readiness:production` é somente leitura: confere ambiente, banco, migrações, MFA da equipe, aceite manual do release, SMTP, workers, cadeia ICP-Brasil, evidências de homologação, capacidade e infraestrutura, documentos legais, restauração e a fila fiscal. Ele não executa build, migração, worker, emissão ou envio de e-mail.

Um resultado `BLOCK` impede a comercialização. `WARN` exige triagem, mas não muda dados. O arquivo `config/production.env.example` documenta os nomes esperados sem conter valores reais.

## Ordem de ativação

1. Contrate infraestrutura com PostgreSQL gerenciado, TLS, backups automáticos, retenção e restauração ponto no tempo. Formalize topologia, recuperação e responsáveis conforme `INFRAESTRUTURA-PRODUCAO.md`; valide o arquivo protegido com `npm run readiness:infrastructure`.
2. Guarde segredos no cofre da hospedagem. Nunca copie `.env` para imagem, repositório, ticket ou log.
3. Obtenha revisão jurídica e configure a identidade real do controlador, encarregado, canais e versões finais. Formalize documentos internos, operadores e aprovações conforme `GOVERNANCA-JURIDICA-LGPD.md`, gere o fingerprint e execute `npm run readiness:legal`. Alterar as versões força reaceite autenticado de usuários existentes; alterar o conteúdo jurídico invalida a evidência mesmo se alguém esquecer de trocar a versão.
4. Confira o pacote de raízes ICP-Brasil versionado em `resources/fiscal/icp-brasil-roots-20260826.pem` e sua procedência em `resources/fiscal/ICP-TRUST.md`. Atualize-o pelo segredo `ICP_BRASIL_TRUST_BUNDLE_PEM` ou pelo caminho `ICP_BRASIL_TRUST_BUNDLE_FILE` quando necessário. O gate confere leitura e formato; não substitui homologação e revisão de revogação.
5. Gere um pacote único conforme `RELEASE-REPRODUZIVEL.md` e implante esse mesmo pacote, sem recompilar ou substituir arquivos. Com web e workers ainda parados, execute `npm run readiness:release`, `npx prisma migrate status`, aplique `npx prisma migrate deploy` com o usuário proprietário das estruturas e então execute `npm run readiness:migrations`. Nunca use `prisma db push` em produção. Os gates bloqueiam mistura de releases, migração ausente, falha ativa, rollback sem reaplicação, checksum diferente, migração desconhecida no banco, tabela ou coluna esperada ausente.
6. Conclua o processo de `HOMOLOGACAO-FISCAL.md`. Inicie um processo web e um worker separado. O worker só transmite produção com `FISCAL_WORKER_ALLOW_PRODUCTION=true` e uma evidência aprovada, vigente e compatível com o código fiscal implantado.
7. Configure uma sonda externa de vida em `/api/health/live` e use `/api/health/ready` no balanceador. A prontidão compara todo o inventário de migrações do release com o banco e exige heartbeats recentes de emissão, documentos e consultas em produção.
   Configure também o diagnóstico agregado e o fluxo de on-call conforme `OBSERVABILIDADE-E-INCIDENTES.md`; o timer local complementa, mas não substitui, a sonda externa.
8. Configure SMTP e faça um envio de teste pelo painel. Remova `BOOTSTRAP_ADMIN_EMAIL` depois de criar a primeira conta.
9. Confirme o modo de cobrança com `BILLING_MODE=MANUAL`, segregação de funções e conciliação por referência no painel; nunca libere plano apenas por comprovante enviado. O gate e o serviço recusam novas contratações em produção se outro modo for informado, até existir uma integração de provedor implementada e auditada.
10. Execute o ensaio isolado descrito em `CAPACIDADE-E-PILOTO.md` usando o release candidato e valide `npm run readiness:capacity`.
11. Execute integralmente `TESTES-MANUAIS.md`, formalize o resultado conforme `ACEITE-MANUAL-DO-RELEASE.md` e valide `npm run readiness:acceptance`.
12. Inicie conforme `ABERTURA-CONTROLADA-DO-PILOTO.md`, com `PUBLIC_REGISTRATION_MODE=CLOSED`; execute `npm run readiness:production`, o build manual e a suíte automatizada antes de liberar tráfego para a base acompanhada.

Depois do período acompanhado, siga `SAIDA-DO-PILOTO-E-ABERTURA-PUBLICA.md`. O estágio `PUBLIC` somente passa com `PUBLIC_REGISTRATION_MODE=OPEN` e `readiness:public-launch` aprovado para o release atual.

O lançamento deve parar imediatamente se `readiness:legal`, `readiness:infrastructure`, `readiness:capacity`, `readiness:acceptance`, `migrate deploy`, `readiness:migrations` ou `readiness:production` terminar com código diferente de zero. A aplicação e os workers nunca devem iniciar sobre um banco reprovado. O gate não executa carga, emite parecer jurídico, cria backup, corrige histórico, troca proprietário nem marca migração como aplicada: essas ações exigem responsáveis próprios e uma janela controlada.

## Cadeia ICP-Brasil para o certificado A1

O cadastro de A1 em **produção** exige uma cadeia de confiança configurada no servidor. As raízes públicas v5/v12 obtidas e verificadas no pacote oficial do ITI estão incluídas no repositório por padrão; veja `resources/fiscal/ICP-TRUST.md`. A falta da cadeia não significa senha incorreta ou arquivo defeituoso. Para futuras atualizações, obtenha certificados de AC **Raiz** no [repositório oficial do ITI](https://www.gov.br/iti/pt-br/assuntos/repositorio/repositorio-ac-raiz); o [pacote vigente do ITI](https://www.gov.br/iti/pt-br/assuntos/repositorio/certificados-das-acs-da-icp-brasil-arquivo-unico-compactado) publica também hash SHA-512 para conferência da origem. Não use o PFX privado da empresa, um certificado de usuário ou a cadeia inteira de intermediárias como âncoras de confiança.

Para substituir o bundle padrão, converta somente as raízes oficiais para PEM, confira procedência e integridade, e coloque-as em arquivo fora do repositório (ou no cofre de segredos). Configure `ICP_BRASIL_TRUST_BUNDLE_FILE` com caminho absoluto desse arquivo PEM; alternativamente injete o conteúdo em `ICP_BRASIL_TRUST_BUNDLE_PEM`. Reinicie o servidor web e os workers para carregar a configuração. Em seguida, valide novamente o A1 e execute o gate de produção. O sistema recusa arquivos de confiança ilegíveis, grandes, que não contenham PEM ou cujos certificados não sejam raízes autoassinadas. Ainda é necessária validação operacional de revogação/cadeia completa antes da comercialização.

## Backups e recuperação

- Banco: backup diário, restauração ponto no tempo, cópia em conta/região separada e criptografia gerenciada.
- Segredos: cofre com versionamento e acesso mínimo. O backup do banco sozinho não recupera certificados sem a chave de criptografia correta.
- Teste de restauração: ao menos trimestral em ambiente isolado, verificando migrações, contagens, login de QA, leitura de XML/PDF e nenhuma transmissão fiscal.
- RPO/RTO sugeridos para definição contratual: RPO de até 24 horas e RTO de até 8 horas no início; reduza conforme SLA comercial.
- Registre data, responsável, evidência e resultado do teste. Preencha `BACKUP_RESTORE_TESTED_AT` e a seção `recovery` da evidência somente após um teste real.

## Incidentes

MASTER e ADMIN dispõem de “Incidentes de segurança” no painel. O registro guarda detecção, risco, contenção, decisão, comunicações e retenção mínima de cinco anos. O prazo automático de três dias úteis não considera feriados: o responsável deve confirmar o prazo legal e usar os canais oficiais da ANPD. Depois de encerrado, o registro fica imutável.

## Retenção operacional

O worker remove buckets de limitação expirados e cadastros pendentes vencidos. Sessões e solicitações de redefinição permanecem por 30 dias após o vencimento para diagnóstico e depois são eliminadas. Registros fiscais, comerciais, aceites legais, incidentes e auditoria não participam dessa limpeza automática. A caixa de saída de e-mail cifra o conteúdo, tenta novamente com backoff e elimina registros terminais somente depois da janela operacional.
