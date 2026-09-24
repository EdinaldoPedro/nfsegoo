# Banco isolado para testes

## Evidências de 02 e 03/09/2026

O PostgreSQL local voltou a responder durante a remediação. A inspeção somente leitura encontrou PostgreSQL **16.15**, timezone **Etc/UTC**, 8 usuários, 35 empresas, 114 notas, 157 vendas e 117 tarefas de emissão (52 autorizadas e 65 em erro final). Nenhuma tarefa estava em voo naquele instante. Isso é uma fotografia, não autorização para ignorar verificações no momento de migrar.

A conta da aplicação não é superusuária e não tem `CREATEDB`. Essas permissões foram preservadas. Foi criado, pelo contêiner local `nfse-db`, o banco vazio `nfsegoo_qa_20260902_07d19000ca26`, com a aplicação como proprietária **apenas desse novo banco**. Não copiamos certificados, usuários ou XMLs do banco original.

- As 35 migrações do repositório foram aplicadas com sucesso no banco vazio.
- As quatorze baterias de integração passaram: 111 testes contabilizados pelo Node (96 subtestes e quatorze grupos), zero falhas e zero SKIP.
- Cobertura: autenticação/MFA/rate limit, isolamento de clientes, contratos/consentimento de contadores, concorrência de cupom e cobrança manual, reserva/devolução de créditos, posse e retomada de worker, rollback e conciliação sem segundo POST; cancelamento durável, ambiente original, revogação antes do envio, consulta sem descancelamento, PDF concorrente e arquivamento protegido; séries DPS equivalentes, reservas simultâneas, piso legado, limites numéricos e conservação de séries/números históricos; ciclo de homologação sem consumo, cópia idempotente, relatórios por ambiente/snapshot e exportação limitada antes dos blobs; perfil/empresa atômicos, versão, cotas e confirmação explícita do ambiente de emissão; manutenção administrativa, arquivamento/restauração com cotas, rollback de auditoria e concorrência com cadastro de tomador; cadastro administrativo novo, preferência principal sem transferência, empresas órfãs/protegidas, cota compartilhada, versões e rollback de auditoria.
- O teste novo de oito reservas encontrou uma corrida de criação no upsert do ORM; a implementação foi corrigida com inserção atômica nativa. A bateria completa foi repetida e aprovada; não se tratou de ignorar um erro de unicidade.
- Erros de chave estrangeira no teste de vínculo cruzado e de unicidade na disputa pelo mesmo CNPJ são **esperados**: os testes passam quando o banco impede o vínculo cruzado ou o segundo cadastro e a transação é revertida.
- O banco `nfse_db` não foi migrado nem teve seus dados alterados. Nele continuam pendentes nove migrações posteriores a `20260901180000_add_secure_impersonation_sessions`.

## Reproduzir sem build

Manter `.env` apontando para o banco original local. O script substitui `DATABASE_URL` apenas no ambiente dos subprocessos de QA, não no arquivo nem no ambiente da aplicação.

```powershell
node --env-file=.env scripts/database-readiness.cjs
node --env-file=.env scripts/test-database.cjs --reuse nfsegoo_qa_20260902_07d19000ca26
```

Para criar outro banco sintético, com uma conta autorizada a criar bancos:

```powershell
node --env-file=.env scripts/test-database.cjs
```

No ambiente local atual, a opção administrativa explícita abaixo cria o banco via contêiner, sem elevar a conta da aplicação. Exige acesso ao Docker. O script confere que a porta publicada de `nfse-db` corresponde à porta local da conexão.

```powershell
node --env-file=.env scripts/test-database.cjs --bootstrap-docker
```

Os testes exigem opt-in e nome no padrão `nfsegoo_qa_YYYYMMDD_` seguido de 12 caracteres hexadecimais. Apontar para localhost não basta. O script configura o opt-in apenas para os subprocessos; execução direta sem ele exibe SKIP, não aprovação.

Nenhum desses comandos executa build, compila/inicia worker ou se comunica com o Portal Nacional. O banco sintético é preservado para diagnóstico/reutilização, sem exclusão automática. As fixtures automáticas são removidas ao final. Existe um seed separado e restrito de interface para relatórios/cópia (conta fictícia, sem certificado real); ver RELATORIOS-E-HOMOLOGACAO.md. O suplemento administrativo está em MANUTENCAO-ADMINISTRATIVA.md; o roteiro HTTP de empresas da conta está em EMPRESAS-DA-CONTA.md. Os seeds/limpeza foram repetidos e os dados sintéticos de interface removidos apenas do QA. Eles não substituem contas e cenários de todos os perfis.

## Ainda necessário antes da migração real

1. Backup recuperável do banco original e restauração verificada em cópia protegida.
2. Exercitar backfill com dados legados (clientes compartilhados, contratos e sequências), comparar contagens/referências e demonstrar preservação dos XMLs.
3. Verificar novamente ausência de tarefas em voo e desligar processos antigos na janela de migração.
4. Aplicar as migrações no ambiente aprovado e testar login/fluxos completos.
5. Executar o processo de worker compilado, homologação fiscal e testes de queda real. Simulações com objetos de transporte não substituem esses testes.

O sucesso em banco vazio demonstra a cadeia de DDL e os cenários sintéticos, **não** a segurança do backfill sobre todo o histórico real. Não usar `db push` para contornar migrações, nem apagar tarefas/dados para passar pré-condições.

## Implantação local de 09/09/2026

- Backup consistente criado antes da alteração em `C:\Users\Didi\AppData\Local\Temp\nfse_db_pre_migrations_20260909_codex.dump` (formato custom do `pg_dump`, aproximadamente 19 MB).
- O deploy revelou drift anterior: a migração-base constava no histórico, mas `Fatura` e `CupomLog` não existiam. A migração aditiva `20260902090000_restore_missing_legacy_billing_tables` recria somente essas estruturas quando ausentes, sem substituir tabelas ou reescrever linhas existentes.
- O reparo foi aplicado primeiro no QA; após separar os limites de senha e MFA, a bateria PostgreSQL completa passou novamente: 141/141.
- As 47 migrações foram então aplicadas com o proprietário do banco. `nfse_admin` permaneceu sem superusuário e sem `CREATEDB`, recebendo apenas privilégios de aplicação nas novas tabelas/sequências.
- Estado final: Prisma atualizado; todos os 50 models possuem tabela correspondente. Permaneceram 8 usuários, 35 empresas, 114 notas, 157 vendas e 117 jobs (52 autorizados e 65 em erro final), sem job em voo.

## MFA e empresa própria de conta administrativa — 09/09/2026

- A migração aditiva `20260909140000_mfa_login_challenges_and_trusted_devices` foi aplicada primeiro no banco isolado e depois no `nfse_db`, totalizando 48 migrações.
- Antes do deploy local foram confirmados 0 jobs fiscais em voo e criado o backup `C:\Users\Didi\AppData\Local\Temp\nfse_db_pre_mfa_20260909.dump` (formato custom, aproximadamente 19 MB).
- O QA final aprovou 143/143 testes PostgreSQL, incluindo consumo único concorrente do desafio/código de e-mail, retenção de desafios/dispositivos vencidos e o ciclo fiscal completo de homologação por uma conta `ADMIN` titular da própria PJ. A bateria unitária aprovou 193/193.
- A autorização do portal do cliente passou a combinar papel e relação empresarial: uma conta interna opera somente PJs diretamente próprias. Cadastro, tomadores, notas, relatórios, DPS, emissão e worker repetem essa verificação; o benefício ilimitado de `ADMIN`/`MASTER` nunca concede acesso a empresas de terceiros.
- As tabelas começaram vazias e a conta da aplicação recebeu somente os privilégios operacionais já previstos. As contagens anteriores de usuários, empresas e notas permaneceram 8, 35 e 114.

## Benefício administrativo ilimitado — 09/09/2026

- A migração aditiva `20260909220000_admin_unlimited_plan` registra no job fiscal quando a emissão usa o benefício administrativo, sem criar crédito fictício nem alterar histórico fiscal.
- `ADMIN` e `MASTER` recebem o plano efetivo `Administrativo Customizado`, ativo, sem vencimento e sem limites de emissões, clientes ou empresas. O benefício não amplia o acesso a empresas de terceiros e deixa de autorizar novos envios se o papel ou a situação da conta mudar antes da transmissão.
- O QA isolado aprovou **144/144** testes PostgreSQL; o novo cenário concluiu uma emissão de produção de um `ADMIN` titular sem plano comercial, sem reserva de crédito e sem transmissão fiscal real. A bateria unitária permaneceu em **193/193**.
- A 49ª migração foi aplicada ao `nfse_db` com o proprietário da tabela e reconciliada no histórico do Prisma. As contagens foram preservadas: 8 usuários, 35 empresas, 114 notas, 157 vendas e 117 jobs; nenhum job legado foi reclassificado como ilimitado.

## Identidade fiscal única de tomadores — 09/09/2026

- A migração aditiva `20260909230000_canonical_fiscal_entities` criou a identidade pública global por CNPJ sem remover ou renomear `Cliente` e sem reescrever FKs fiscais.
- O QA isolado aprovou **145/145** testes PostgreSQL. O cenário novo cobre cinco criações concorrentes, duas carteiras com e-mail/telefone/I.M. diferentes, correção global, ausência de dados particulares no DTO administrativo e snapshot imutável do job/nota.
- A bateria unitária aprovou **195/195**. Typecheck web/worker, lint, validação Prisma e smoke HTTP em desenvolvimento passaram. Nenhum build ou transmissão fiscal foi executado.
- No `nfse_db`, 28 relacionamentos PJ foram ligados a 23 identidades únicas. Zero documento global duplicado e zero vínculo incompatível. Permaneceram 8 usuários, 35 empresas, 48 relacionamentos, 114 notas, 157 vendas e 117 jobs. As 50 migrações estão aplicadas.
