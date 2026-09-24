# Bateria manual por perfil — roteiro de aceite

Estado: roteiro cumulativo com **246 casos** da remediação, ainda **não executado integralmente**. Não é laudo de conformidade nem liberação comercial. Cada caso só conta como aprovado depois de executado no ambiente indicado e documentado com evidência sanitizada.

## Preparação e segurança

1. Usar ambiente de QA/homologação separado, com banco e e-mails de teste. Nunca experimentar cancelamento, permissões ou pagamentos nas contas/documentos reais. O banco sintético descrito em `BANCO-TESTES.md` tem testes técnicos, mas não mantém usuários prontos para estes testes de tela.
2. Antes de testar as telas, preparar o ambiente com todas as migrações e contas de QA. Não apontar o código novo para o banco original ainda sem migração. Backup restaurado e conferido precede qualquer migração do histórico real.
3. Criar contas distintas: cliente A, cliente B, contador A, contador B, SUPORTE, COMERCIAL, ADMIN e MASTER. Cada pessoa usa janela/perfil de navegador separado. Configurar MFA das contas internas; guardar códigos de recuperação fora das evidências públicas.
4. Ter duas empresas independentes A/B; somente o cliente A é titular de A e o cliente B de B. Preparar um vínculo contábil pendente e um aprovado. Um contador deve ter limite de empresas pequeno e contrato com vencimento definido.
5. Preparar ofertas/cupom de QA, um contrato ativo, um vencido e um com saldo esgotado. Usar comprovantes sintéticos e referências bancárias identificadas como QA; não declarar recebimento real para testar ativação.
6. Para testes fiscais externos, usar certificado autorizado e empresa elegível em **HOMOLOGAÇÃO**. Um XML/certificado sintético dos testes automatizados não é credencial do portal. Não habilitar `FISCAL_WORKER_ALLOW_PRODUCTION` para executar esta bateria.
7. O proprietário executa o build web e a compilação do worker, quando a implementação estiver pronta para esse gate. Nenhum dos dois foi executado pelo agente. Seguir `WORKER-EMISSAO.md` para a implantação de QA.
8. Para cada caso, registrar ID, perfil, data, navegador/tamanho da tela, resultado obtido e evidência sem senha/token/certificado/dados reais. Usar: **PASSOU**, **FALHOU**, **BLOQUEADO** (com motivo) ou **NÃO EXECUTADO**. Sem execução não conta como aprovação.

Os testes de falha técnica (queda do worker/rede, retorno remoto inconsistente, concorrência controlada) devem ser preparados por quem administra o QA. O usuário comum avalia apenas o que aparece na interface. Nunca usar edições informais de banco para “aprovar” um caso.

## Todos os perfis: acesso e experiência

| ID | Ação como usuário | Resultado esperado |
| --- | --- | --- |
| G01 | Entrar com credenciais corretas e incorretas | Acesso correto; erro compreensível, sem senha/log técnico na tela |
| G02 | Repetir senhas incorretas muitas vezes | Limite temporário; sem requisições ilimitadas e sem derrubar outras contas |
| G03 | Abrir URL interna antes de entrar | Nenhum dado privado; encaminhamento ao login/negação de acesso |
| G04 | Sair e usar Voltar/Atualizar/URL antiga | Sessão encerrada; nenhuma operação privada permitida |
| G05 | Entrar em dois navegadores e revogar um dispositivo em Segurança | Só a sessão revogada perde o acesso; a lista reflete o estado real |
| G06 | Trocar senha e testar sessões antigas | Sessões antigas não continuam autorizadas; comunicação clara sobre novo login |
| G07 | Solicitar recuperação para e-mail existente e inexistente | Resposta pública equivalente; somente o destinatário correto recebe o fluxo válido |
| G08 | Usar recuperação expirada ou já utilizada | Rejeição; link não reutilizável, sem revelar dados da conta |
| G09 | Ativar MFA; testar solicitação do campo, código errado, código válido e código de recuperação | Solicitar o segundo fator não duplica a tentativa de senha; erros de MFA têm limite próprio; código válido entra e recuperação usada não funciona novamente |
| G10 | Usar todas as telas principais em celular e com zoom de 200% | Conteúdo legível, formulários utilizáveis, ações não escondidas/inacessíveis |
| G11 | Navegar só com teclado e abrir/fechar diálogos | Foco visível, rótulos claros, confirmação/cancelamento acessíveis |
| G12 | Administrador de QA interrompe a API/banco durante uma consulta | Tela informa indisponibilidade; não apresenta lista vazia como se não houvesse dados |
| G13 | Recarregar durante uma solicitação pendente | Estado recuperável; não afirmar sucesso nem disparar outra operação automaticamente |
| G14 | Validar pelo aplicativo marcando dispositivo confiável, sair e entrar novamente | A senha continua obrigatória; o segundo fator não volta a ser pedido por 7 dias no mesmo navegador e volta após o prazo |
| G15 | Escolher e-mail, solicitar código e marcar dispositivo confiável | Código chega uma vez, expira em 10 minutos; após validar, o segundo fator fica dispensado somente por 24 horas no mesmo navegador |
| G16 | Reutilizar código de e-mail/TOTP/recuperação e enviar cinco tentativas simultâneas em QA | Apenas uma utilização pode vencer; recuperação não cria dispositivo confiável; excesso recebe limite temporário |
| G17 | Trocar senha, e-mail ou autenticador após confiar no navegador | Todas as confianças anteriores são revogadas; sessão/cookie antigo não contorna o novo login |
| G18 | Abrir Segurança e remover um ou todos os dispositivos confiáveis | Item some da lista; no próximo login o segundo fator volta a ser exigido conforme a política do perfil |
| G19 | Usar conta ADMIN que também é titular de uma PJ e abrir Área do cliente | Somente a PJ própria aparece; pode editar cadastro, alternar homologação, gerenciar tomadores, abrir notas/relatórios e emitir pelo benefício administrativo; empresas alheias permanecem inacessíveis |
| G20 | Abrir Minha conta com MFA configurado e acessar Segurança da conta | Exibe estado do segundo fator, quantidade de navegadores confiáveis e sessões; o botão abre a central para gerenciar MFA, códigos, dispositivos e sessões |
| G21 | Abrir dashboard, menu e Minha conta como ADMIN/MASTER | Exibe “Administrativo Customizado”, ativo, sem vencimento e com emissões, clientes e empresas “Ilimitado”; não oferece compra/renovação e uma emissão não cria reserva de crédito |

## Cliente comum — COMUM

| ID | Ação | Resultado esperado |
| --- | --- | --- |
| U01 | Cadastrar-se e confirmar a conta | Validações claras, confirmação única; nunca receber papel interno |
| U02 | Abrir empresa, clientes, notas e pedidos | Somente dados de A; trocar URL/identificador por um de B não concede acesso |
| U03 | Criar/editar cliente de A com documento já usado em B | Cadastro de B não é modificado; dados e contatos permanecem separados |
| U04 | Cadastrar certificado de QA válido/inválido e senha incorreta | Erros controlados; chave/senha não aparecem em respostas, telas ou logs comuns |
| U05 | Emitir em homologação com dados completos | Acompanhar a solicitação; resultado explicitamente de homologação, sem receita/crédito de produção |
| U06 | Tentar emitir com dados obrigatórios ausentes, valor inválido ou regime não suportado | Bloqueio antes de emissão; orientação específica para corrigir |
| U07 | Clicar duas vezes em Emitir e recarregar | Uma venda/solicitação; não gerar duas notas nem consumir dois créditos |
| U08 | Reabrir a emissão depois de perder a conexão na confirmação | Solicitação anterior reaparece; verificar resultado antes de nova tentativa |
| U09 | Abrir nota autorizada e baixar XML/PDF | Documento da nota correta; XML original preservado; PDF indisponível informa preparação |
| U10 | Solicitar cancelamento com motivo 1/2/9 e justificativa real | Primeiro aparece “solicitado/pendente”; não “cancelada” apenas porque a API aceitou |
| U11 | Informar justificativa curta, longa, emoji ou quebra de linha | Validação; nenhum pedido fiscal com justificativa inventada ou completada pelo sistema |
| U12 | Repetir cancelamento pendente ou tentar consultar enquanto há operação conflitante | Acompanhar a mesma operação; sem novo pedido concorrente |
| U13 | Após confirmação externa, consultar e baixar a nota cancelada | Estado CANCELADA; ZIP contém XML autorizado + evento; PDF mostra cancelamento |
| U14 | Portal não confirma cancelamento no cenário preparado pela equipe técnica | Nota preservada; aviso de conciliação e suporte, sem afirmar cancelamento/rejeição definitiva |
| U15 | Tentar excluir venda autorizada ou cancelada | Bloqueio; cancelamento não autoriza ocultar o documento fiscal |
| U16 | Arquivar venda de QA sem nota/obrigação fiscal | Sai do histórico visível, sem exclusão física; repetir não duplica auditoria |
| U17 | Consultar histórico/cancelar documento elegível com plano vencido ou saldo zero | Obrigações anteriores continuam acessíveis; não exigir crédito novo nem devolver crédito da nota cancelada |
| U18 | Selecionar oferta, alternar mensal/anual e aplicar cupom | Totais/ciclo corretos e confirmados pelo servidor; sem alteração de preço pela interface |
| U19 | Enviar comprovante e acompanhar pedido manual | “Em análise” não ativa plano; nunca prometer cobrança automática por API inexistente |
| U20 | Abrir ticket, anexar arquivo permitido e acompanhar resposta | Ticket próprio, sem notas internas do suporte; arquivo inválido é rejeitado |
| U21 | Nas configurações de QA, alternar série 900/0900/00900 e recarregar | A mesma sequência, exibida como 900; nenhum reinício ou duplicação por zeros à esquerda |
| U22 | Informar série com letras, número negativo/fracionário ou superior ao limite mostrado | Validação compreensível, sem remover letras, truncar número ou gravar zero silenciosamente |
| U23 | Com reservas anteriores preparadas pela equipe, informar último número menor e salvar | Não diminuir o piso conhecido; recarregar mostra o valor preservado; candidato considera números reservados |

## Contador — CONTADOR

| ID | Ação | Resultado esperado |
| --- | --- | --- |
| C01 | Solicitar vínculo com empresa de terceiro | Fica pendente; não revela notas/clientes nem altera cadastro da empresa |
| C02 | Tentar aprovar o próprio pedido pendente do titular | Negado; aprovação exige o responsável autorizado |
| C03 | Titular aprova vínculo e contador entra novamente/atualiza | Somente a empresa autorizada passa a ser acessível |
| C04 | Alternar entre duas empresas vinculadas e pesquisar clientes | Contexto explícito; não misturar clientes, documentos, certificados ou numeração |
| C05 | Emitir/consultar/cancelar como operador autorizado | Mesmas proteções U05–U14; auditoria identifica o contador real |
| C06 | Titular revoga vínculo com tela do contador aberta | A próxima operação é negada; cache/tela antiga não conserva permissão |
| C07 | Abrir diretamente empresa B não vinculada | Negado, mesmo conhecendo o identificador |
| C08 | Cadastrar empresas simultaneamente perto do limite contratado | Não ultrapassar a cota; mesma empresa existente não é apropriada pelo contador |
| C09 | Consultar contrato de contador e testar expiração/suspensão em QA | Prazo/limites reais; renovar papel/cadastro não prolonga benefício automaticamente |
| C10 | Tentar acessar área de suporte, comercial, administração e tickets de terceiros | Negado; contador não é funcionário interno |
| C11 | Outro contador pede acesso a empresa da carteira | Contador aprovado não ganha, por isso, poder de compartilhar propriedade ou consentimento do titular |
| C12 | Consultar séries/ambientes de duas empresas de QA, sem emitir | Sequências separadas por empresa/ambiente; zeros à esquerda não criam outra série; resposta atrasada não troca o contexto |

## Suporte — SUPORTE / SUPORTE_TI

| ID | Ação | Resultado esperado |
| --- | --- | --- |
| S01 | Entrar sem MFA concluído | Fluxo de configuração/verificação; operações internas bloqueadas até concluir |
| S02 | Abrir chamado e registrar resposta pública + nota interna | Cliente vê resposta pública, nunca nota interna/anexo interno |
| S03 | Abrir bancada de venda e salvar sugestão técnica | Registra proposta; não altera valor/XML/situação da nota nem emite pelo cliente |
| S04 | Solicitar sincronização da nota | Consulta agendada, sem reenvio fiscal; tela exibe estado real da operação |
| S05 | Solicitar regeneração de PDF | Fila documental; sem novo crédito, emissão ou cancelamento |
| S06 | Tentar cancelar nota, aprovar pagamento, conceder plano ou arquivar venda | Negado; papel de suporte não autoriza essas ações |
| S07 | Abrir modo de suporte somente leitura com senha/justificativa | Prazo visível, ação auditada, sem credenciais do cliente expostas |
| S08 | Em modo somente leitura, tentar salvar cadastro/emitir/cancelar/contratar | Bloqueio no servidor; alterar botão/URL não contorna a restrição |
| S09 | Sair/revogar sessão real durante modo de suporte | A sessão de suporte derivada não continua funcionando |
| S10 | Ver operação fiscal em conciliação manual | Não há botão de “forçar sucesso”, apagar tarefa ou reenviar pedido; escalonar para ADMIN/MASTER |
| S11 | Consultar saúde da fila com worker desligado | Indisponibilidade/heartbeat antigo visível; não exibir “online” permanentemente |
| S12 | Tentar sincronizar a numeração DPS como funcionário interno | Negado; consulta da situação de uma nota não concede poder de configurar/sincronizar a sequência do cliente |

## Comercial — COMERCIAL

| ID | Ação | Resultado esperado |
| --- | --- | --- |
| V01 | Entrar e concluir MFA | Navegação comercial; sem acesso automático à bancada fiscal, cofre ou suporte |
| V02 | Conferir pedidos/cotações mensais e anuais | Valores e benefícios congelados na contratação; catálogo posterior não reescreve pedido |
| V03 | Tentar aprovar pedido ainda pendente, sem análise | Bloqueio; exige a etapa correta e dados da conciliação |
| V04 | Conferir recebimento sintético com valor exato/referência única | Somente aprovação válida ativa benefício; divergência não é aceita silenciosamente |
| V05 | Aprovar o mesmo pedido em duas abas | Uma fatura/ativação; repetir não concede benefícios em dobro |
| V06 | Reutilizar referência bancária já conciliada em outro pedido | Bloqueio e rollback, sem ativação indevida |
| V07 | Tentar aprovar pedido próprio | Bloqueio por segregação de funções |
| V08 | Recusar/cancelar pedido e repetir ação | Estado terminal coerente; não reabrir/ativar pedido cancelado silenciosamente |
| V09 | Tentar conceder cortesia, alterar papel, impersonar ou cancelar NFS-e | Negado |
| V10 | Expirar cotação ou esgotar cupom durante compra em QA | Oferta revalidada; preço/cupom expirado não aceito pelo servidor |
| V11 | Explicar forma de pagamento disponível ao cliente | Fluxo manual explícito; não mostrar cartão recorrente/cobrança automática como disponível sem integração |

## Administração — ADMIN e MASTER

| ID | Perfil | Ação | Resultado esperado |
| --- | --- | --- | --- |
| A01 | ADMIN/MASTER | Entrar em áreas internas | MFA obrigatório; mudanças críticas pedem senha/justificativa |
| A02 | ADMIN | Tentar promover alguém a ADMIN/MASTER ou alterar superior | Bloqueio pela hierarquia |
| A03 | ADMIN/MASTER | Tentar alterar o próprio papel | Bloqueio; sem autoelevação/rebaixamento crítico |
| A04 | MASTER | Tentar remover/rebaixar último MASTER | Bloqueio, inclusive em abas concorrentes |
| A05 | ADMIN/MASTER | Revogar sessão/alterar papel de conta de QA | Permissão anterior deixa de funcionar; auditoria identifica responsável |
| A06 | ADMIN/MASTER | Conceder benefício com prazo, limites e justificativa | Contrato explícito; repetir não duplica benefício; não quita pedido bancário |
| A07 | ADMIN/MASTER | Suspender/reativar benefício operacional | Preserva prazo/consumo; não renova automaticamente nem apaga histórico |
| A08 | ADMIN/MASTER | Editar preço de plano com pedidos anteriores | Novas cotações refletem mudança; pedidos anteriores mantêm fotografia válida |
| A09 | ADMIN/MASTER | Arquivar venda sem nota em QA | Reautenticação, auditoria, preservação física; nota autorizada/cancelada bloqueia |
| A10 | ADMIN/MASTER | Retomar cancelamento transmitido em conciliação manual | Somente GET do evento original, nunca nova assinatura/POST/ambiente |
| A11 | ADMIN/MASTER | Tentar retomar cancelamento não transmitido como se fosse conciliação | Bloqueio; administração não ganha autorização para cancelar pelo cliente |
| A12 | ADMIN/MASTER | Consultar nota cancelada e regenerar PDF | Não volta a AUTORIZADA; PDF somente após validar evento e estado atual |
| A13 | MASTER | Abrir manutenção legada sem habilitação explícita | Bloqueada por padrão; não executar limpeza destrutiva para testar em dados reais |
| A14 | ADMIN/MASTER | Ver logs da operação de QA | IDs e responsável rastreáveis; sem senha, token, chave privada, certificado ou comprovante bruto |
| A15 | MASTER | Conferir configuração de segurança/contatos/documentos legais | Dados reais e versionados; sem SLA/CNPJ/contato fictício publicado |

## Cenários preparados pela equipe técnica

| ID | Preparação controlada | O que o usuário deve observar |
| --- | --- | --- |
| T01 | Worker parado antes de capturar solicitação | Pedido permanece pendente e recuperável após reinício |
| T02 | Encerrar worker depois de enviar, antes de gravar resultado | Recuperação não gera nova nota/cancelamento; preserva mesma solicitação |
| T03 | Portal indisponível/timeout repetido | Aviso de conciliação; nenhuma falsa confirmação nem reembolso automático |
| T04 | Evento retornado pertence a outra nota/ambiente ou tem assinatura inválida | Nota local e documentos preservados; operação não concluída |
| T05 | Cancelar enquanto PDF autorizado está sendo gerado | PDF antigo descartado; nova geração mostra cancelamento e evento correto |
| T06 | Revogar vínculo imediatamente antes do envio fiscal | Nenhum envio pela permissão revogada; depois de envio já iniciado, conciliação ainda preserva resultado oficial |
| T07 | Trocar ambiente da empresa após solicitação de cancelamento | Operação continua no ambiente original da nota; sem redirecionar para produção |
| T08 | Duas requisições disputam último cupom/crédito/cota | Só a quantidade permitida é aceita; perdedora recebe erro compreensível |
| T09 | Restaurar backup em clone sem comunicação externa | Contagens, relações, XMLs, contratos e histórico conferem; registrar tempo de restauração |
| T10 | Executar volume e concorrência acordados para lançamento | Registrar latência, erros, filas, memória/conexões; limite comercial depende dessa medição |
| T11 | Disputar reserva com oito transações usando 900/0900/00900 em QA | Oito números distintos e crescentes; máximos legados preservados; mesma tarefa repetida mantém a reserva |
| T12 | Alterar a série no cadastro depois de enfileirar uma emissão, antes da preparação | Tarefa/XML usam a série congelada na solicitação; mudança só vale para novas solicitações |
| T13 | Preparar empresa sintética exclusiva com piso 2147483647, sem comunicação externa | Próximo candidato indisponível e nova reserva recusada; nunca voltar a 1. Não aplicar esse cenário a empresa/certificado real |

## Relatórios, homologação e recuperação de dados — casos adicionais

| ID | Perfil | Ação | Resultado esperado |
| --- | --- | --- | --- |
| R01 | COMUM/CONTADOR | Consultar relatórios com plano expirado ou sem créditos | Próprio histórico acessível; não concede direito a novas emissões |
| R02 | COMUM/CONTADOR | Alternar produção, homologação e legado, aplicando cada filtro | Totais separados, ambiente e empresa identificados; teste/legado não são receita de produção |
| R03 | COMUM/CONTADOR | Incluir canceladas e comparar o total autorizado | Canceladas aparecem nas linhas, mas nunca somam ao total autorizado |
| R04 | COMUM/CONTADOR | Ter mais de 20 notas, abrir página 2 e gerar relatório PDF | PDF abrange todas as notas dos filtros; números de até 13 dígitos e total coerente; confirmar arquivo salvo no navegador |
| R05 | COMUM/CONTADOR | Editar filtro sem aplicar e depois aplicar pela tecla Enter | Resumo continua identificado pelos filtros anteriores até aplicar; página/seleção são reiniciadas |
| R06 | COMUM/CONTADOR | Selecionar notas e exportar XML/PDF/ambos | ZIP binário, ambiente explícito, original e evento separados; mesmos números não sobrescrevem arquivos |
| R07 | COMUM/CONTADOR | Exportar lote com PDF pendente ou evento ausente | Erro compreensível para o lote inteiro; não anunciar arquivo parcial como completo |
| R08 | COMUM/CONTADOR | Copiar homologação autorizada/cancelada pelo histórico | Abre nova solicitação para revisão, mantém a origem e não reaproveita DPS; não muda ambiente para produção automaticamente |
| R09 | COMUM/CONTADOR | Alterar nome do tomador após autorização e conferir relatório | Nome extraído de XML preservado; dados ainda não verificados identificados como cadastro atual/legado |
| R10 | ADMIN/MASTER | Comparar painel fiscal com produção, testes e legado de QA | Valor/volume fiscais somente de produção; ambiente indefinido e datas estimadas identificados |
| R11 | COMUM/CONTADOR | Abrir relatório em celular, navegar por teclado e conferir PDF multipágina | Sem controles inacessíveis; tabela rola internamente; avisos e rodapé sem sobreposição |
| R12 | Técnico + usuário | Preparar 1.001+ notas ou lote acima do limite de tamanho | Pedir redução dos filtros/lote; não travar processo nem entregar conteúdo truncado |
| R13 | COMUM/CONTADOR | Gerar relatório com nome fora do alfabeto coberto pela fonte atual | Erro explícito, sem nome corrompido; cobertura Unicode completa ainda é pendência, não aceite final deste caso |
| R14 | COMUM/CONTADOR | Buscar tomador fora dos primeiros 50 cadastros e recuperar cópia/correção | Busca remota encontra o tomador; número anterior não é sugerido; falha de carregamento não libera formulário incompleto |

## Perfil, empresa e confirmação de emissão — casos adicionais

| ID | Perfil | Ação | Resultado esperado |
| --- | --- | --- | --- |
| P01 | COMUM/CONTADOR | Salvar nome/telefone/cargo com telefone ou cargo vazio | Dados pessoais salvos; cadastro, contato e certificado da empresa não são alterados |
| P02 | COMUM/CONTADOR | Alterar complemento e e-mail comercial | Somente a empresa selecionada muda; e-mail de login permanece igual |
| P03 | COMUM/CONTADOR | Enviar campo oculto de papel, plano, proprietário, cobrança ou regra tributária pelo navegador | API rejeita; nenhuma gravação parcial ou publicação global |
| P04 | SUPORTE/COMERCIAL/ADMIN | Tentar editar cadastro fiscal pela rota de perfil de cliente | Acesso negado; suporte segue somente leitura e comercial não recebe poder fiscal |
| P05 | COMUM/CONTADOR | Tentar trocar o CNPJ de empresa existente | Rejeitado; orientar novo cadastro ou análise de titularidade sem reescrever histórico |
| P06 | COMUM/CONTADOR | Cadastrar empresa nova com plano vencido, cota cheia ou CNPJ já existente | Rejeitado sem criar/assumir empresa; pendências contábeis também contam na cota |
| P07 | COMUM/CONTADOR | Validar arquivo não-PFX, base64 inválido, senha vazia, CNPJ divergente ou arquivo acima de 1 MiB | Rejeição genérica e segura; sem persistir arquivo/senha nem expor diagnóstico interno |
| P08 | COMUM/CONTADOR | Selecionar Produção ou remover/substituir certificado sem senha da conta, com senha errada e correta | Duas primeiras negadas; correta altera somente após revalidação. Senha do certificado não serve como senha da conta |
| P09 | COMUM/CONTADOR | Abrir configurações em duas abas, salvar na primeira e salvar dados diferentes na segunda | Segunda aba recebe conflito e precisa atualizar; não sobrescreve edição recente |
| P10 | Técnico + COMUM | Provocar falha controlada de sequência depois de iniciar a transação de cadastro | Empresa, atividades, sequência e log fazem rollback integral |
| P11 | COMUM/CONTADOR | Revisar emissão em homologação, mudar a empresa para produção em outra aba e então enviar a tela antiga | Nova venda/job/crédito não são criados; usuário precisa atualizar e revisar Produção explicitamente |
| P12 | COMUM/CONTADOR | Repetir a mesma chave após resposta perdida e mudança de ambiente | Retorna somente a solicitação original no ambiente original; nunca cria segunda emissão ou redireciona o documento |
| P13 | COMUM/CONTADOR | Abrir Minha conta com cadastro fiscal ausente, legado excessivo ou serviço indisponível | Dados pessoais continuam independentes do cadastro fiscal; falha de carregamento não mostra zeros/defaults como verdade |
| P14 | COMUM/CONTADOR | Usar configurações por teclado e leitor de tela | Nome, CPF, telefone, cargo, idioma, tema e senhas têm nome acessível; mensagens de erro/sucesso são anunciadas |

## Manutenção administrativa de cadastros — casos adicionais

| ID | Perfil | Ação | Resultado esperado |
| --- | --- | --- | --- |
| M01 | COMUM/CONTADOR/SUPORTE/SUPORTE_TI/COMERCIAL | Tentar consultar/alterar pela API administrativa de empresas | 403, mesmo com sessão válida; sem acesso novo por conhecer a URL |
| M02 | ADMIN/MASTER | Buscar, paginar e filtrar tomadores de uma empresa | Empresa de origem explícita; não mistura carteiras; resposta limitada e sem certificado/senha |
| M03 | ADMIN/MASTER | Tentar salvar sem justificativa/senha e depois com senha errada | Nenhuma gravação; mensagem clara; senha não fica retida após a tentativa |
| M04 | ADMIN/MASTER | Alterar endereço/complemento/e-mail comercial com confirmação válida | Somente cadastro selecionado muda; contato pessoal, propriedade, contrato e documentos preservados |
| M05 | ADMIN/MASTER + técnico | Enviar campos não exibidos: documento, empresa, proprietário, certificado, ambiente, série ou DPS | Rejeição de campos; nenhuma substituição de identidade, privilégios ou sequência |
| M06 | ADMIN/MASTER | Editar o mesmo cadastro em duas abas, salvando dados diferentes | Uma gravação; segunda recebe conflito e precisa recarregar, sem perda silenciosa |
| M07 | ADMIN/MASTER | Preparar mesmo CPF/CNPJ em duas carteiras e alterar um tomador | Somente o cadastro da empresa selecionada muda; ID de outro tenant é rejeitado |
| M08 | ADMIN/MASTER | Arquivar empresa sintética sem histórico e restaurar pela lista Arquivados | Operação reversível e auditada; propriedade, vínculos e ambiente preservados, sem criar direitos novos |
| M09 | ADMIN/MASTER | Tentar arquivar empresa com nota, venda, job encerrado ou rascunho | Bloqueio; não oculta histórico nem cancela nota, inclusive em homologação |
| M10 | ADMIN/MASTER | Ocupar cota depois de arquivar uma empresa e tentar restaurá-la | Confere limites de empresas e clientes, incluindo vínculos/pedidos contábeis; não contorna contrato |
| M11 | ADMIN/MASTER | Arquivar tomador com documentos anteriores, mas sem emissão pendente | Documentos e outra carteira preservados; cadastro vai para Arquivados, sem exclusão fiscal |
| M12 | ADMIN/MASTER | Tentar arquivar tomador com emissão pendente/transmissão incerta ou restaurá-lo sem capacidade | Bloqueio com motivo; não perde reserva ou resultado fiscal nem libera cota indevida |
| M13 | Técnico + ADMIN/COMUM | Preparar corrida entre arquivamento de tomador e nova emissão; injetar falha de auditoria separadamente | Tomador é reconferido após o bloqueio; sem venda/job/crédito antigo. Falha de auditoria reverte cadastro e carteira integralmente |
| M14 | ADMIN/MASTER | Usar formulário por teclado, forçar falha de consulta e conferir opções Arquivar/Restaurar | Campos identificados, foco na edição, erro anunciado; falha não parece lista vazia; ações não prometem exclusão LGPD ou cancelamento |

Preparação reproduzível e limites desta etapa em `MANUTENCAO-ADMINISTRATIVA.md`. A equipe prepara os cenários técnicos sem modificar dados reais.

## Empresas da conta e seleção da principal — casos adicionais

| ID | Perfil | Ação | Resultado esperado |
| --- | --- | --- | --- |
| O01 | COMUM/CONTADOR/SUPORTE/SUPORTE_TI/COMERCIAL | Tentar usar a API administrativa de empresas da conta | 403; conhecer ID/CNPJ não concede acesso administrativo. Impersonação também não permite escrita |
| O02 | ADMIN/MASTER | Cadastrar empresa ainda inexistente para cliente/contador, com contrato e cota | Novo cadastro incompleto em homologação, sem certificado, contrato ou vínculo contábil novo; principal anterior preservada |
| O03 | ADMIN/MASTER + técnico | Reenviar payloads antigos de trocar CNPJ, incluir/remover propriedade ou desvincular principal, isolados e junto de um papel | 409 sem alterar cadastro, papel ou contrato; orientar atualização da tela |
| O04 | ADMIN/MASTER | Enviar DV inválido, nome vazio ou campos extras de proprietário/certificado/ambiente | Rejeição sem gravação; letras do CNPJ nunca são descartadas. Cadastro alfanumérico não implica emissão fiscal alfanumérica homologada |
| O05 | ADMIN/MASTER | Informar CNPJ de terceiro, órfão, custodiado, apenas faturado e arquivado; repetir um já pertencente à conta | Casos protegidos recusados; repetição própria ativa não altera dados, não duplica cadastro/log e não concede acesso novo |
| O06 | ADMIN/MASTER + COMUM/CONTADOR | Disputar a última vaga entre cadastro administrativo e cadastro adicional; incluir pendência contábil na cota | Somente a capacidade permitida é criada; plano suspenso/vencido e pendência são considerados |
| O07 | ADMIN/MASTER + COMUM/CONTADOR | Selecionar outra empresa própria e limpar apenas a preferência de principal | Conta continua com acesso às mesmas empresas; histórico, XML, certificado, cobrança, plano e vínculos preservados |
| O08 | ADMIN/MASTER | Tentar limpar principal legado sem proprietário explícito, escolher empresa arquivada ou com principal de outra conta | Bloqueio e orientação de revisão; não deixa histórico órfão nem captura vínculo alheio |
| O09 | ADMIN/MASTER | Confirmar mudanças de principal em duas abas com a mesma versão | Somente uma gravação; a segunda precisa recarregar/revisar, sem substituição silenciosa |
| O10 | Técnico + ADMIN/MASTER | Provocar falha de auditoria após criação/seleção em QA | Rollback completo, nenhum cadastro órfão ou principal parcialmente alterada; log normal contém IDs e motivo, não senha/arquivo fiscal |
| O11 | ADMIN/MASTER | Buscar/paginar e usar formulários por teclado; provocar senha incorreta ou falha de consulta | Conta e empresa explícitas, erro anunciado, consulta falha não parece vazia, senha descartada após tentativa; nenhum pedido automático |
| O12 | ADMIN/MASTER | Abrir Gerenciar e mudar a principal; abrir edição de contador e apenas mudar o papel no seletor sem salvar | Ação contratual começa vazia e exige seleção; mudar principal não concede/suspende plano. Painéis contábeis usam o papel salvo, não uma promoção ainda não persistida |

Preparação e limites deste lote em `EMPRESAS-DA-CONTA.md`. Transferência/recuperação com prova e consentimento permanece um critério adicional pendente, não uma autorização para usar os atalhos antigos.

## Transferência de responsável pelo cadastro — casos adicionais

| ID | Perfil | Ação | Resultado esperado |
| --- | --- | --- | --- |
| Q01 | ADMIN/MASTER | Abrir solicitação com chamado ativo do destino, nota interna própria, CNPJ, senha e justificativa | Pendente, sem mudar acesso, cobrança ou certificado |
| Q02 | ADMIN/MASTER | Usar CNPJ público, chamado de terceiro, mensagem externa/de outro autor ou conta interna | Rejeição sem assumir dados |
| Q03 | ADMIN/MASTER | Repetir UUID e reutilizá-lo para outro destino | Repetição idêntica retorna; conteúdo divergente conflita |
| Q04 | COMUM/CONTADOR destino | Ler termos, confirmar CNPJ e aceitar com senha própria | Só seu consentimento é registrado |
| Q05 | Responsável anterior | Aceitar e trocar a senha antes da conclusão | Aceite fica inválido e deve ser renovado |
| Q06 | Participante | Rejeitar com senha e justificativa | Tudo encerrado sem transferência |
| Q07 | ADMIN/MASTER | Concluir sem aceites, com hash/CNPJ divergente, expiração ou vínculos alterados | Bloqueio integral |
| Q08 | ADMIN/MASTER | Concluir com job, crédito, operação fiscal incerta ou sincronização DPS ativa | Bloqueio até conciliação |
| Q09 | ADMIN/MASTER | Concluir com nota final e cota do destino | Novo responsável; HOMO; A1 removido; sem envio/cobrança automática |
| Q10 | Todos | Conferir XMLs, notas, vendas, carteira, sequências e acessos | História preservada; acessos antigos revogados com registro |
| Q11 | Dois MASTER | Recuperar órfã: um inicia e outro conclui | Destino consente; iniciador não se autorrevisa |
| Q12 | SUPORTE/COMERCIAL/impersonação | Tentar operar e inspecionar logs | 403; sem senha, PFX, XML ou prova bruta |

Detalhes e limites em `TRANSFERENCIA-TITULARIDADE.md`.

## Lista administrativa e CRM — casos adicionais

| ID | Perfil | Ação | Resultado esperado |
| --- | --- | --- | --- |
| L01 | SUPORTE/SUPORTE_TI | Listar clientes e pedir equipe interna | Clientes paginados; equipe recebe 403 |
| L02 | ADMIN | Pedir MASTER pela API | 403; não enumera superior |
| L03 | MASTER | Paginar equipe/clientes por nome/e-mail | Até 50, total e ordem estáveis |
| L04 | Internos | Inspecionar JSON | Sem senha, MFA, reset, certificado, XML ou empresa completa |
| L05 | ADMIN/MASTER | Buscar além da primeira página nas três telas | Busca remota encontra; falha não parece vazio |
| L06 | ADMIN/MASTER | Alternar segmentos do CRM | Página reinicia; filtros seguem contrato vigente |
| L07 | ADMIN/MASTER | Editar catálogo após pagamento anual | MRR usa pedido/fatura congelados e normalização mensal |
| L08 | ADMIN/MASTER | Conferir totais com várias páginas | KPIs globais agregados no banco; tabela identifica a página |

Detalhes em `LISTAGEM-CONTAS-CRM.md`.

## Aceite jurídico e direitos dos titulares — casos adicionais

| ID | Perfil | Ação | Resultado esperado |
| --- | --- | --- | --- |
| D01 | Todos | Entrar com conta antiga depois de alterar as versões jurídicas em QA | Depois de login e MFA, direcionamento obrigatório ao reaceite; APIs privadas permanecem bloqueadas até a confirmação |
| D02 | Todos | Enviar aceite sem marcar, sem senha, com senha errada ou versões antigas | Rejeição sem gravar aceite; a tela exige leitura das versões vigentes e não revela detalhes da credencial |
| D03 | Todos | Confirmar as versões atuais e repetir o envio em duas abas | Um aceite e um evento de auditoria; IP e navegador somente como hash, sem valor bruto persistido |
| D04 | COMUM/CONTADOR | Abrir Política, Termos e Central de Privacidade em celular e desktop | Identidade, CNPJ, endereço, encarregado, canais e versões reais; nenhum texto “draft”, contato fictício ou promessa não aprovada |
| D05 | COMUM/CONTADOR | Abrir a Central de Privacidade e solicitar acesso/correção/eliminação com senha | Protocolo próprio, prazo visível e repetição do mesmo direito aberto sem duplicação |
| D06 | COMUM/CONTADOR | Exportar os próprios dados com senha correta e incorreta | Arquivo JSON somente para a senha correta; inclui dados/aceites pertinentes, nunca hash de senha, MFA, PFX, chave privada ou anexos binários |
| D07 | COMUM/CONTADOR | Tentar consultar protocolo ou exportação de outra conta alterando ID/URL | Negado sem indicar se o titular existe; nenhuma informação de outro tenant |
| D08 | SUPORTE/SUPORTE_TI/COMERCIAL | Tentar abrir ou alterar a fila administrativa de privacidade | Acesso negado; atendimento pode orientar o titular, mas não decidir ou anonimizar |
| D09 | ADMIN/MASTER | Iniciar, solicitar informação, concluir e recusar pedidos sintéticos | Cada mudança exige senha e justificativa; resposta/fundamento obrigatórios conforme a decisão; versão concorrente recebe conflito |
| D10 | ADMIN/MASTER | Tentar anonimizar conta com empresa, contrato, cobrança, ticket ou obrigação fiscal | Bloqueio indicando necessidade de análise/retenção; nenhum dado ou acesso é alterado parcialmente |
| D11 | ADMIN/MASTER | Anonimizar uma conta sintética livre de bloqueadores | Identificadores substituídos, sessões revogadas e login futuro negado; protocolo e auditoria permanecem preservados |
| D12 | ADMIN/MASTER | Preparar solicitação vencida e usar filtro Atrasadas | Item e prazo aparecem; diagnóstico operacional também sinaliza a pendência sem expor o pedido a suporte comum |

## Incidentes, disponibilidade e operação — casos adicionais

| ID | Perfil | Ação | Resultado esperado |
| --- | --- | --- | --- |
| I01 | SUPORTE_TI | Abrir diagnósticos operacionais | Somente estados agregados de banco, SMTP, worker, filas e prazos; sem credenciais, destinatários, conteúdo de e-mail ou dados dos incidentes |
| I02 | SUPORTE/SUPORTE_TI/COMERCIAL | Tentar acessar o registro de incidentes pela tela e API | 403; nenhum protocolo, resumo ou categoria afetada é enumerado |
| I03 | ADMIN/MASTER | Registrar incidente sintético com senha/justificativa e conferir prazo | Protocolo único, detecção, prazo preliminar de três dias úteis e retenção mínima de cinco anos; feriados continuam sob revisão humana |
| I04 | ADMIN/MASTER | Atualizar o mesmo incidente em duas abas com a mesma versão | Uma alteração vence; a outra recebe conflito e precisa recarregar; histórico não é sobrescrito silenciosamente |
| I05 | ADMIN/MASTER | Tentar retroceder o estado ou editar incidente encerrado | Operação recusada; correção deve ser documentada sem apagar o registro encerrado |
| I06 | ADMIN/MASTER | Encerrar com risco desconhecido ou relevante sem registrar comunicações | Bloqueio. Risco relevante exige avaliação, contenção, fundamento e datas de comunicação à ANPD e aos titulares |
| I07 | Técnico | Consultar `/api/health/live` com banco/worker indisponíveis e depois `/api/health/ready` | Vida do processo pode responder; prontidão falha fechada e não recebe tráfego enquanto dependências/migração/worker não estiverem aptos |
| I08 | Técnico + SUPORTE_TI | Parar o worker de QA por mais de 45 segundos e abrir diagnósticos/readiness | Heartbeat antigo e prontidão indisponível; religar o worker recupera o estado sem apagar ou duplicar tarefas |
| I09 | Técnico + usuário | Bloquear SMTP após solicitar recuperação/confirmar e-mail e restaurá-lo antes do vencimento | Solicitação fica na outbox cifrada, é reenviada com backoff e não duplica no reprocessamento normal; tela não afirma envio definitivo quando a mensagem expirou. Queda depois do aceite do provedor deve ser tratada como risco operacional de entrega repetida |
| I10 | Técnico | Inspecionar a outbox no banco isolado | Destinatário e conteúdo não aparecem em claro; posse expirada é recuperável; falha final e mensagem vencida ficam visíveis no diagnóstico |
| I11 | Técnico | Executar a retenção operacional com registros sintéticos vencidos e registros fiscais/jurídicos | Remove apenas rate limits/cadastros temporários e sessões/resets após a janela; não remove notas, XMLs, pedidos, aceites, incidentes ou auditoria |
| I12 | Técnico | Conferir headers em páginas públicas e privadas | CSP, anti-framing, nosniff, referrer e permissions policy presentes; páginas autenticadas com `no-store`; HSTS somente no domínio HTTPS preparado |

## Gate comercial e implantação — casos adicionais

| ID | Perfil | Ação | Resultado esperado |
| --- | --- | --- | --- |
| X01 | COMUM/CONTADOR | Solicitar contratação em produção com `BILLING_MODE` ausente ou diferente de `MANUAL` | Nova cotação/pedido indisponível; nenhum pedido ou benefício criado |
| X02 | COMUM/CONTADOR | Solicitar contratação com modo manual, enviar comprovante e recarregar | Pedido/ticket únicos; upload não ativa plano nem é apresentado como cobrança automática |
| X03 | COMERCIAL | Marcar análise e tentar ativar sem referência única, confirmação de conferência ou valor exato | Bloqueio e rollback; nenhuma fatura paga ou benefício concedido |
| X04 | ADMIN/MASTER + responsável técnico | Executar `npm run readiness:production` no ambiente de lançamento | Zero `BLOCK`; cada `WARN` triado e documentado. O comando não migra, não envia e-mail, não transmite nota e não substitui build/testes manuais |
| X05 | Operação | Parar separadamente emissão, documentos e consultas, consultando `/api/health/ready` após cada parada | Readiness responde 503 e identifica somente o tipo indisponível; ao restaurar os três heartbeats volta a 200 |
| X06 | Operação | Manter no banco uma migração a menos que o release em clone isolado e consultar `/api/health/ready` | Readiness responde 503; aplicar a migração e repetir faz o schema voltar a apto sem alterar produção |
| X07 | Backup/segurança | Restaurar backup em ambiente isolado sem saída fiscal e seguir `INFRAESTRUTURA-PRODUCAO.md` | XML/PDF e chave cifrada são recuperáveis, nenhuma transmissão ocorre, RPO/RTO e evidência ficam registrados |
| X08 | Operação | Executar `npm run monitor:operational` com web, banco e três workers saudáveis | Código 0, estado `OK` e somente contagens/referências técnicas no resultado |
| X09 | Operação | Em staging, parar um worker por vez e criar tarefa sintética vencida por mais de 5 minutos | Código 2, sinal `CRITICAL`, alerta recebido pelo on-call e nenhuma operação fiscal reenviada |
| X10 | Privacidade/operação | Em staging, usar prazos e certificados sintéticos próximos/vencidos | 30 dias gera `WARN`; 7 dias, vencimento ou prazo legal atrasado gera `CRITICAL`, sem dados pessoais no alerta |
| X11 | Jurídico/privacidade/segurança | Aprovar o release candidato, gerar evidência e executar `npm run readiness:legal` | Gate aprova somente fingerprint, versões, documentos, operadores, transferências e três aprovações compatíveis |
| X12 | Técnico + jurídico | Alterar uma frase da política ou serviço de direitos após a aprovação, sem trocar a evidência | `readiness:legal` bloqueia por hash divergente; nova revisão e nova evidência são obrigatórias |
| X13 | Privacidade | Simular inclusão de fornecedor ou transferência internacional ainda não documentada | Gate bloqueia inventário incompleto ou ausência de avaliação/salvaguardas; nenhuma integração é liberada |
| X14 | Técnico/operação | Rodar o perfil de `CAPACIDADE-E-PILOTO.md` em staging com o release candidato | Evidência registra carga, latência, erros, recursos, filas e isolamento dentro dos limites, sem transmissão fiscal de produção |
| X15 | Técnico/operação | Reiniciar web e cada worker separadamente durante a carga sintética | Readiness retira o processo, filas preservam operações aceitas e recuperação ocorre sem duplicidade ou perda |
| X16 | Técnico | Tentar reutilizar evidência de outro release ou com vazamento entre tenants | `readiness:capacity` bloqueia mesmo que latência e taxa de erro estejam aprovadas |
| X17 | Responsável técnico | Executar build e compilação do worker com Node 24, depois iniciar ambos em QA | Build/compilação aprovados; web e worker usam a mesma versão/migrações; nenhum processo antigo permanece concorrendo |
| X18 | Responsável técnico | Restaurar backup recente em clone isolado e repetir login/leitura de XML/PDF | RPO/RTO medidos, contagens e documentos conferidos, chave de criptografia disponível e nenhuma comunicação externa durante o teste |
| X19 | Produto + QA | Conferir que cada ID deste roteiro possui execução e evidência sanitizada no release candidato | Nenhum caso ausente, repetido, ignorado, bloqueado ou reprovado é apresentado como aceite |
| X20 | Produto + técnico + operação | Aprovar separadamente a evidência integral e executar `npm run readiness:acceptance` | Gate aceita somente o release, roteiro, prazo e três responsáveis compatíveis |
| X21 | Técnico | Alterar o roteiro ou gerar novo release depois do aceite | Evidência anterior é recusada por fingerprint ou `releaseId` divergente |
| X22 | Visitante | Abrir Cadastro com o piloto configurado como `CLOSED` | Tela informa a abertura acompanhada e não permite continuar; Login permanece disponível |
| X23 | Visitante + técnico | Enviar `POST /api/auth/cadastro` diretamente durante o piloto fechado | Resposta 503 antes de rate limit, banco ou e-mail; nenhum cadastro pendente é criado |
| X24 | Cliente existente | Entrar e operar enquanto o cadastro público está fechado | Acesso normal conforme papel, empresa e plano; o fechamento não revoga contas existentes |
| X25 | Produto + operação | Tentar abrir cadastro antes de 14 dias, com amostra insuficiente ou pendência grave | `readiness:public-launch` bloqueia e o estágio permanece `CONTROLLED_PILOT` |
| X26 | Produto + técnico + operação | Aprovar a saída do piloto saudável para o release atual | Gate aceita métricas, amostra e aprovações segregadas; `LAUNCH_STAGE=PUBLIC` com modo `OPEN` passa no gate geral |
| X27 | Técnico | Usar estágio `PUBLIC` com cadastro `CLOSED`, ou piloto com cadastro `OPEN` | `readiness:production` bloqueia a combinação inconsistente |

## Identidade fiscal global de tomadores PJ — casos adicionais

| ID | Perfil | Ação | Resultado esperado |
| --- | --- | --- | --- |
| E01 | COMUM (empresa X) | Cadastrar a PJ B com e-mail, telefone e I.M. próprios | Um relacionamento na carteira X; dados públicos vêm da identidade B e os três campos particulares ficam na relação X |
| E02 | COMUM (empresa Y) | Cadastrar o mesmo CNPJ B com outro e-mail, telefone e I.M. | Reutiliza a mesma identidade pública; cria outra relação privada sem copiar os dados de X |
| E03 | COMUM (empresas X/Y) | Reabrir B nas duas carteiras | Razão/endereço/IBGE iguais; e-mail, telefone e I.M. continuam diferentes conforme cada relação |
| E04 | COMUM | Editar B e salvar e-mail, telefone e I.M. | Apenas a relação da empresa selecionada muda; CNPJ, razão e endereço públicos permanecem bloqueados para edição manual |
| E05 | COMUM | Usar Atualizar cadastro em B | Fonte pública é consultada; campos públicos atualizam para todas as carteiras e os particulares permanecem intactos |
| E06 | COMUM | Cadastrar o mesmo CPF em duas empresas | PF continua tenant-local; nenhum nome/endereço privado é compartilhado globalmente |
| E07 | COMUM | Cadastrar o mesmo NIF exterior em duas empresas | Exterior continua tenant-local; país, endereço e contato não atravessam carteiras |
| E08 | COMUM + Técnico | Enfileirar emissão para B, corrigir a identidade antes do worker e inspecionar o resultado em homologação | O job/nota usa a fotografia confirmada antes da correção; nova emissão usa a identidade atualizada |
| E09 | ADMIN/MASTER | Abrir Identidades de Tomadores e pesquisar B | Uma linha por CNPJ; nenhum e-mail, telefone, I.M. ou nome da empresa emissora é exibido |
| E10 | ADMIN/MASTER | Corrigir código IBGE com senha, versão e justificativa | Correção aparece em X e Y; evento/auditoria criados; documento e dados particulares preservados |
| E11 | ADMIN/MASTER | Consultar a fonte pública com uma correção ativa | Dados-base atualizam, mas a correção administrativa continua prevalecendo |
| E12 | ADMIN/MASTER | Remover as correções ativas | Valores atuais da fonte voltam a prevalecer; operação versionada e auditada |
| E13 | SUPORTE/SUPORTE_TI/COMERCIAL/CONTADOR | Tentar abrir ou chamar a central administrativa global | Acesso negado; suporte não ganha dados nem poder de correção global |
| E14 | Técnico | Enviar cadastros simultâneos do mesmo CNPJ por empresas diferentes em QA | Uma identidade fiscal; uma relação por empresa; nenhuma violação de unicidade ou mistura de dados privados |

Total: **225 casos**. O build, a compilação do worker, a homologação fiscal externa e a execução integral deste roteiro permanecem ações do proprietário/equipe de lançamento.

## Critério de saída

- Nenhum defeito crítico de isolamento, acesso, duplicidade fiscal, ativação financeira ou perda de documentos.
- Todos os casos obrigatórios executados no ambiente correto; falhas corrigidas e casos repetidos. Casos bloqueados por integração/decisão externa ficam explicitamente pendentes.
- Build e compilação do worker pelo proprietário aprovados; instalação limpa, migração com restauração e fluxo real de homologação conferidos.
- Revisão fiscal/jurídica do escopo vendido, contatos e documentos legais; política de backup/retencão/incidentes definida com responsáveis reais.
- A inexistência de API de cobrança não impede fluxo manual aprovado, mas impede vender automatismos que ainda não existem.

Modelo de evidência: `ID | perfil | data | navegador/tela | PASSOU/FALHOU/BLOQUEADO/NÃO EXECUTADO | resultado observado | evidência sanitizada | responsável pela correção`.
