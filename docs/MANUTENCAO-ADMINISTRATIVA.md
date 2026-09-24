# Manutenção administrativa de empresas e tomadores

Evidência de 03/09/2026. Lote integrante da remediação; não constitui liberação comercial.

## Mudanças implementadas

- `/api/admin/empresas` mantém consulta e manutenção para ADMIN/MASTER, com sessão válida e MFA. Os demais perfis não recebem acesso por conhecer o endereço da API.
- Edição, arquivamento e restauração exigem senha administrativa atual, justificativa de 10 a 2.000 caracteres e `expectedUpdatedAt`. A API limita a dez tentativas administrativas por cinco minutos e corpo de 16 KiB.
- O serviço reconfere papel e senha, bloqueia a empresa, verifica a versão e grava alteração e auditoria na mesma transação. Falha ao escrever o log desfaz a alteração. Duas edições da mesma versão não sobrescrevem silenciosamente uma à outra.
- Lista explícita de campos cadastrais: nome, contato e endereço. CNPJ/CPF/NIF, tipo, país/moeda, propriedade, responsável financeiro, certificados, ambiente, regime, série e contador DPS não podem ser alterados por essa rota. O nome do tomador é atualizado apenas em seu cadastro, nunca em outra carteira com documento igual.
- Tomador exige tanto seu ID quanto a empresa à qual pertence. Cadastros legados sem empresa não são reivindicados automaticamente.
- Consultas paginadas: 1 a 50 registros, página de 1 a 100.000 e busca de até 120 caracteres. Ordenação estável e leitura consistente de lista/total. Seleção explícita não consulta certificado/senha nem carrega todas as carteiras por empresa. A carteira é consultada separadamente, com filtro de empresa e paginação.
- Interface com identificação do documento/empresa, campos rotulados, foco no título da edição, senha apagada após tentativa, bloqueio de duplo envio e mensagem persistente de conflito. Falha de consulta não aparece como uma base vazia ou total zero.

## Arquivar não é excluir nem cancelar

Empresa com qualquer nota, job de emissão, venda ou rascunho não pode ser ocultada pelo arquivamento. Isso inclui registros de homologação e erros encerrados. O botão não apaga documentos nem altera a situação fiscal.

Empresa sem esse histórico pode ser arquivada. Propriedade, responsável financeiro, vínculo primário, relações contábeis e carteira não são apagados ou recriados. A restauração confere as cotas atuais dos responsáveis/vínculos contabilizados, incluindo solicitações contábeis pendentes e os clientes que voltarão a ocupar a carteira. Não renova contrato, não cria benefícios e não concede titularidade nova.

Tomador pode sair da carteira sem apagar notas antigas; emissão pendente, reserva em aberto ou transmissão sem conciliação comprovada impedem o arquivamento. Restauração confere empresa, versão, responsabilidade e cota vigente. Registros com emissão legada incerta não devem ser liberados alterando status informalmente no banco.

A emissão nova reconfere o tomador dentro da transação, depois de adquirir o bloqueio da empresa. Arquivar ou editar o tomador enquanto a solicitação aguarda não cria venda/job/reserva com dados antigos. A consulta compartilhada de tomador agora aceita o cliente transacional; há teste verificando leitura de alteração ainda não confirmada e rollback.

O antigo DELETE apenas com IDs na query não executa arquivamento/desvínculo. É necessário o corpo explícito com ação, escopo, versão, senha e justificativa.

## Verificação realizada

- 146 testes unitários/regressivos: quatro casos novos cobrem paginação, seleção mínima, campos permitidos, coerções indevidas, senha, justificativa, versão e escopo.
- 88 testes PostgreSQL em onze grupos (77 subtestes), sem falhas ou SKIP. O grupo novo contém doze subtestes: isolamento, segredo, permissões, conflito entre cinco alterações, rollback após falha injetada de auditoria, bloqueios de histórico, cotas na restauração, preservação de documentos e corrida entre arquivamento e emissão. São transações reais em banco sintético; transporte fiscal externo não é chamado.
- Typecheck da aplicação e do worker, sem compilação de artefatos. A checagem do worker detectou a assinatura antiga do helper de tomador; corrigida para participar da transação e coberta por regressão.
- ESLint: zero erros, 41 avisos em 317 arquivos. Os avisos preexistentes continuam pendentes de revisão ampla de UX/hooks.
- Navegador autenticado: login exigiu MFA; senha administrativa errada rejeitada; edição válida de empresa e tomador; segunda aba recebeu conflito. Complementos e contato foram conferidos no QA; e-mail de login permaneceu separado. Layout desktop inspecionado visualmente.
- Dezesseis chamadas HTTP de verificação local: paginação inválida/DELETE legado retornaram 400; GET/PUT retornaram 403 para COMUM, CONTADOR, SUPORTE, SUPORTE_TI e COMERCIAL; empresa com histórico retornou 409; arquivar/listar arquivada/restaurar empresa vazia retornaram 200. Respostas conferidas com `no-store`. Os 27 documentos sintéticos foram preservados nessas operações.
- Inspeção somente leitura do original manteve 8 usuários, 35 empresas, 114 notas, 157 vendas e 117 jobs. Oito migrações continuam pendentes no original; 34 aplicadas no QA.
- Servidor temporário encerrado; contas, contrato e documentos da fixture removidos somente do QA e recriáveis pelos scripts. Nenhum build, worker real ou transmissão fiscal executado.

## Reproduzir a interface em QA

Executar primeiro a preparação de banco descrita em `BANCO-TESTES.md`. O banco de QA precisa estar sem contas, não conter dados reais e não estar sendo usado por outro teste. Manter `.env` apontando para o original: os scripts substituem o alvo apenas em seus próprios processos.

```powershell
node --env-file=.env scripts/qa-report-ui.cjs seed nfsegoo_qa_20260902_07d19000ca26
node --env-file=.env scripts/qa-admin-ui.cjs seed nfsegoo_qa_20260902_07d19000ca26
node --env-file=.env scripts/qa-report-ui.cjs serve nfsegoo_qa_20260902_07d19000ca26
```

Os seeds mostram credenciais sintéticas aleatórias. O administrador tem MFA; usar um código de recuperação emitido pelo seed, uma única vez, no login de `http://localhost:3105/login`. Não compartilhar senha/códigos nas evidências. A empresa vazia usa documento sintético com DV válido, não credencial de titularidade ou autorização do portal.

Depois de encerrar o servidor temporário, remover o suplemento antes da fixture principal:

```powershell
node --env-file=.env scripts/qa-admin-ui.cjs clean nfsegoo_qa_20260902_07d19000ca26
node --env-file=.env scripts/qa-report-ui.cjs clean nfsegoo_qa_20260902_07d19000ca26
```

Não renomear os nomes de identificação das fixtures: a limpeza verifica esses nomes e a propriedade antes de remover. O banco em si permanece disponível. O seed administrativo foi repetido e limpo após corrigir o DV do documento da empresa vazia.

## Limites e próximas correções

- Atualização posterior: os atalhos legados de atribuir/remover propriedade e trocar CNPJ na administração de usuários foram bloqueados/substituídos; ver `EMPRESAS-DA-CONTA.md`. Cadastro novo e preferência principal estão separados. Transferência/recuperação com prova e consentimentos continua pendente; o CNPJ público não comprova titularidade.
- O cadastro comum de clientes ainda requer revisão de validação, identidade e concorrência. Não declarar todos os caminhos cadastrais encerrados apenas pela correção da rota administrativa.
- Arquivamentos legados que já apagaram vínculos não são reparados automaticamente. Reconstrução requer evidência, revisão da capacidade e preservação do acesso histórico; não inventar vínculos para contornar cota.
- Não há exclusão LGPD implementada por esse botão. Retenção, direitos dos titulares, governança fiscal, validação completa de PFX/ICP-Brasil, operação, carga, recuperação de backup e aceite integral por perfil continuam na matriz de trabalho.
- A bateria manual cumulativa foi ampliada para 141 casos, ainda não executados integralmente. Build e compilação do worker continuam reservados ao proprietário.
