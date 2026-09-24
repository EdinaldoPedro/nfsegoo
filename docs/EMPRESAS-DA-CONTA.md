# Empresas da conta — cadastro e preferência principal

Registro de 03/09/2026. Este lote fecha atalhos administrativos de tomada de cadastro. Não conclui o fluxo de transferência/recuperação de titularidade nem autoriza comercialização por si só.

## O que foi implementado

- Painel compartilhado em **Configurar Contas** e na edição de clientes/contadores em **Colaboradores**. Cadastro novo e preferência principal têm ações, revisão, senha e justificativa próprias; salvar papel/contrato não executa essas operações.
- `GET/POST /api/admin/users/[id]/empresas`: somente ADMIN/MASTER; papel atual e senha atual reconferidos na transação, com bloqueios de usuários e empresas em ordem consistente. Corpo máximo de 16 KiB, CSRF, rate limit administrativo e respostas privadas sem cache. Contexto de impersonação é recusado para escrita.
- Cadastro novo reutiliza a mesma regra do cadastro adicional do cliente: DV do CNPJ, nome obrigatório, contrato vigente, cota incluindo pedidos contábeis pendentes e auditoria atômica. Sempre inicia em HOMOLOGACAO, incompleto e sem certificado. Não cria contrato, custódia ou vínculo contábil e não troca a principal automaticamente.
- CNPJ já registrado para terceiro, órfão, custodiado, apenas faturado ou arquivado não pode ser reivindicado. Repetir cadastro de empresa ativa já explicitamente pertencente à conta devolve somente seu resumo, sem alterar dados nem duplicar log.
- Selecionar principal exige a versão da conta vista na confirmação. Somente empresa ativa já pertencente à conta e sem principal de outro usuário pode ser selecionada. Limpar essa preferência só é permitido quando a propriedade explícita preserva o acesso. Contrato vencido não impede selecionar um histórico já acessível.
- Vínculo principal legado sem proprietário explícito não é apagado nem substituído por esta operação. É necessária revisão de titularidade; não se presume prova a partir do CNPJ, de quem paga, de custódia ou de um vínculo antigo inconsistente.
- Antigos payloads `newCnpj`, `unlinkCompany`, `addEmpresaProprietaria` e `removeEmpresaProprietariaId` recebem 409, inclusive quando misturados com papel/benefício. Os botões antigos foram substituídos. A rotina não utilizada de marcar em lote empresas faturadas como propriedade do contador foi removida do código; nenhum dado foi apagado por essa remoção.
- Lista de empresas da conta com busca, paginação de até 25 registros e DTO mínimo, incluindo indicação de arquivados. Detalhe administrativo do usuário não carrega senha/certificado/carteira completa; vínculos contábeis ativos estão limitados a 50 com contagem/aviso e encaminhamento à bancada.
- Corrigida validação de e-mail na atualização administrativa de dados pessoais, sem truncamento silencioso de nome/e-mail. Abrir o gerenciamento não pré-seleciona suspensão/contratação: é necessário escolher uma ação explicitamente.

Cadastro no SaaS não comprova titularidade jurídica do CNPJ. Este lote altera cadastro/preferência operacional, não a propriedade jurídica da pessoa jurídica.

## Evidências obtidas

- **151 testes unitários/regressivos aprovados**, incluindo cinco novos casos de entrada, limites, DTO, DV, coerções e rejeição de atalhos legados.
- **101 testes PostgreSQL aprovados** (89 subtestes e 12 grupos), sem falhas ou SKIP na execução final. Os 12 novos subtestes cobrem papéis/senha atuais, novo cadastro mínimo, empresas protegidas, cota concorrente compartilhada com o cadastro adicional, plano/pendências, mesmo CNPJ em duas contas, rollback real após falha de auditoria, preservação de XML/certificado/contrato/vínculos, versão concorrente, principal legado e logs sem segredos.
- Primeiro ensaio do novo teste corrigiu uma referência ao campo de XML da fixture; a bateria completa foi repetida e aprovada. Falhas esperadas de unicidade de CNPJ e FK de outra empresa são testes negativos, não gravações parciais toleradas.
- **32 verificações HTTP locais aprovadas**, com login/MFA novos e cookies apenas em memória do cliente HTTP: 401/403, hierarquia, versões, CSRF, impersonação, atalhos legados, criação 201, repetição 200 e e-mail normalizado. As 27 notas sintéticas permaneceram preservadas. Uma repetição imediata encontrou o rate limit de login; após expiração normal da janela, o roteiro passou. Nenhuma proteção de login foi desabilitada.
- Navegador de QA: login/MFA, painel, campos/revisão, CNPJ inválido sem envio, senha incorreta, mensagens, foco no título de confirmação e seleção contratual inicialmente vazia. Inspeção visual em desktop aprovada. Criação e troca/restauração da principal foram exercitadas por HTTP; a confirmação positiva desses botões no navegador e o aceite completo por todos os perfis ainda estão no roteiro manual.
- Typecheck do app e worker sem emissão de artefatos; lint sem erros (avisos globais ainda pendentes). Não houve `npm run build`, compilação/início de worker real ou comunicação fiscal externa.
- Banco original verificado somente para leitura: 8 usuários, 35 empresas, 114 notas, 157 vendas e 117 jobs, com oito migrações posteriores à impersonação ainda pendentes. Este lote não adiciona migração.

## Reproduzir o HTTP em QA

Preparar os seeds e iniciar o servidor conforme `MANUTENCAO-ADMINISTRATIVA.md`. Não apontar o servidor para o banco original. O roteiro usa somente `http://127.0.0.1:3105` e confere os identificadores das fixtures antes de operar.

Em outro terminal, usar a senha sintética e um código de recuperação ainda não usado, mostrados pelo seed administrativo:

```powershell
$env:NFSE_QA_PASSWORD = 'SENHA_SINTETICA_DO_SEED'
$env:NFSE_QA_MFA_CODE = 'CODIGO_DE_RECUPERACAO_SINTETICO_NAO_USADO'
node --env-file=.env scripts/qa-account-companies-http.cjs nfsegoo_qa_20260902_07d19000ca26
Remove-Item Env:NFSE_QA_PASSWORD, Env:NFSE_QA_MFA_CODE
```

Não usar credenciais reais nem editar `.env`. O roteiro alterna apenas o papel do administrador sintético para testar a negação e restaura o papel no `finally`; restaura também a principal original e remove apenas o novo cadastro sintético criado por ele, depois de conferir identidade e ausência de histórico. O bucket de reautenticação desse administrador sintético é limpo no encerramento; os limites de login continuam ativos. Aguardar cinco minutos entre execuções se atingir 429. Não rodar o teste simultaneamente com interação manual usando essa mesma conta.

Encerrar o servidor e limpar o suplemento administrativo antes da fixture de relatórios. Credenciais/códigos de QA não devem constar de evidências compartilhadas.

## Ainda pendente

- Transferência e recuperação agora usam o fluxo explícito em `TRANSFERENCIA-TITULARIDADE.md`; os atalhos antigos continuam proibidos.
- Paginação/DTOs de todas as outras listagens de usuários/CRM/carteira, governança do e-mail administrativo e recuperação, cadastro comum de clientes e revisão ampla por perfil.
- Homologação fiscal alfanumérica, certificado completo, operação/backup/LGPD e demais critérios em `REMEDIACAO.md`.
- Bateria manual cumulativa com 173 casos, ainda não executada integralmente. Build e compilação do worker continuam reservados ao proprietário.
