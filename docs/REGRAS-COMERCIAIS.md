# Regras comerciais e conferência manual

Estado: implementação em andamento; não é autorização para publicar. Build reservado ao proprietário. Migrações, integração e homologação ainda obrigatórias.

## Papéis e limites

- COMUM e CONTADOR contratam para a própria conta. Contas internas não simulam compras de clientes.
- COMERCIAL, ADMIN e MASTER conferem pedidos em `/admin/contratacoes`; precisam de MFA e reautenticação para transições.
- SUPORTE e SUPORTE_TI não conciliam pagamentos nem baixam comprovantes alheios. COMERCIAL não ganha acesso a certificados, emissão, configuração, impersonação ou gestão de papéis.
- ADMIN/MASTER gerenciam catálogo e cupons, com senha e justificativa. Desativação preserva contratos e histórico. Condições de novos pedidos são congeladas na cotação; uma edição posterior não muda o pedido aceito.
- Concessão administrativa é uma cortesia/ajuste auditado, nunca uma quitação. Suspensão é explícita e preserva registros anteriores.

## Cotação autoritativa

O servidor valida produtos ativos e públicos, tipo, preço, benefícios e cupom. Totais enviados pelo navegador são ignorados. Cálculos monetários usam centavos inteiros; valores acima da capacidade Decimal(10,2), negativos, fracionários indevidos e coerções ambíguas são rejeitados.

- Assinatura mensal: 1 a 12 meses antecipados; anual: um ano por pedido.
- Até dez tipos distintos de pacote, 1 a 100 unidades por tipo.
- Preço zero no catálogo significa ciclo indisponível no checkout; cortesia ou teste usa fluxo administrativo/registro próprio.
- Pacote de notas concede o total contratado uma vez, não uma renovação mensal. Pacote de clientes amplia carteira; PJ concede uma empresa adicional por unidade.
- Pacotes avulsos exigem assinatura vigente. Produtos CUSTOM/privados exigem atendimento e concessão administrativa conforme contrato.
- O hash canônico da cotação é conferido novamente na criação; mudança de preço, benefício ou cupom exige nova confirmação.
- Cada pedido tem uma chave de idempotência. Reenvio não cria pedido, anexo, fatura ou benefício adicional. Existe no máximo uma solicitação manual pendente por cliente no fluxo novo.

Esses limites técnicos são explícitos na interface e precisam ser revisados pelo proprietário se a oferta comercial demandar carrinhos maiores. Nenhum preço, tarifa bancária ou promessa de SLA foi inventado.

## Cupons

- Limite nulo é ilimitado; zero é esgotado. Reservas de pedidos vigentes entram no cálculo de disponibilidade.
- Reserva nasce com o pedido; aprovação consome e grava CupomLog junto da fatura. Cancelamento, recusa ou expiração libera disponibilidade.
- Validade configurada como data encerra às 23:59:59.999 de Brasília. Desativação/expiração do cupom impede novas cotações; condições já aceitas são honradas enquanto o pedido estiver vigente.
- `maxCiclos` corresponde a meses de desconto. Num anual, dois meses significam 2/12 da base, não dois anos. Arredondamento comercial em centavos: meio para cima.
- Escopo e produtos elegíveis limitam a base de cálculo. Desconto fixo não ultrapassa essa base.
- Primeira compra considera faturas pagas; uma concessão gratuita administrativa não é compra. Reservas concorrentes não podem ocupar a mesma disponibilidade.

## Estados e conciliação

Solicitação começa aguardando comprovante ou com comprovante enviado. A equipe inicia análise antes de aprovar. Aprovação, recusa, cancelamento e expiração são terminais; não é permitido voltar a pendente ou editar a quitação.

Para aprovar pagamento positivo, o operador deve conferir extrato, pagador, valor e referência bancária. São obrigatórios comprovante, referência única, valor recebido exatamente igual ao pedido, confirmação explícita, senha e justificativa. O servidor não consegue provar a entrada no banco sem uma integração; a conferência humana continua necessária. Total zero por desconto integral exige confirmação da concessão, sem inventar transferência.

Na mesma transação, o sistema cria a fatura paga, registra benefícios com limites congelados, consome a reserva do cupom, altera o pedido e grava auditoria/atendimento. Falha em qualquer etapa reverte as demais. Referência de transferência já conciliada não pode quitar outro pedido.

Renovação antecipada começa depois do período vigente já contratado. Não há estorno, pró-rata ou upgrade imediato implícito. Pacotes entram na data de aprovação e exigem assinatura para uso. Consumo usa o aniversário mensal, inclusive no anual; validar as migrações e a integração antes de disponibilizar as telas.

`CHECKOUT_VALIDITY_HOURS` define o prazo do pedido (padrão 72 horas; permitido 1 a 720). Prazo aparece ao cliente; pedido expirado não deve receber transferência. Pagamento recebido fora do prazo, a maior, a menor, sem identificação, estorno ou devolução exige conciliação humana e registro financeiro apropriado; integração e fluxo de ajustes ainda pendentes.

Cancelar solicitação não devolve dinheiro. A interface orienta contato quando já houve transferência. Não há cobrança automática, PIX fictício, webhook de provedor ou simulação de confirmação bancária.

## Comprovantes e notificações

Até cinco arquivos por pedido, cada um até 5 MB, com extensão, MIME e assinatura binária coerentes. O arquivo é guardado uma vez; listagens retornam apenas metadados. Download restrito e auditado. Isso não equivale a antivírus ou análise integral de conteúdo; armazenamento privado/quarentena ainda deve ser concluído na frente de anexos.

Atualizações ficam registradas no atendimento. E-mails comerciais síncronos foram retirados para não devolver erro de pagamento já concluído por falha de SMTP; a entrega durável por outbox ainda está pendente e deve ser concluída antes do lançamento.

## Migração e evidências

1. Fazer backup e restaurar em banco descartável PostgreSQL compatível.
2. Aplicar a sequência completa de migrações e conferir vínculos, totais e snapshots.
3. Revisar contratos legados: limites congelados pela migração refletem o catálogo atual, não uma reconstrução das condições originalmente vendidas.
4. Recusar/cancelar pedidos legados sem cotação e recriá-los. Não ajustar status diretamente no banco.
5. Rodar os testes integrados com opt-in explícito em PostgreSQL local; fixtures usam `example.invalid`, referências sintéticas e IDs isolados. Não realizam transferência, envio fiscal ou e-mail real.
6. Validar o consumo por ciclo, concorrência, suspensão, concessões, renovação antecipada, caixa de atendimento e notificações.

Há 15 testes unitários comerciais aprovados no lote original (13 de cotação/estados/permissões e dois de catálogo). A suíte completa foi ampliada; os testes comerciais de concorrência com PostgreSQL passaram no banco sintético isolado, junto às demais baterias, conforme `BANCO-TESTES.md`. O histórico real não foi migrado. Nenhum build executado.

## Contratos, consumo e concessões de contadores

- `PlanUsageCycle` mantém saldos separados por contrato e aniversário UTC. Dia 31 é limitado ao último dia do mês curto sem perder a âncora para os meses seguintes. Pacotes não se renovam mensalmente.
- `EmissionCreditReservation` vincula a reserva ao pedido de emissão e ao ciclo original. Reserva e criação de job/venda são uma transação; liberar duas vezes não devolve dois créditos. Liberação no mês seguinte não reduz uso daquele mês. Nota autorizada e consumo definitivo são gravados juntos.
- GET não renova contratos nem zera contadores. Zero notas/clientes significa zero, não infinito. Contas internas não têm bypass de emissão.
- Suspender bloqueia novas operações sem cancelar o período pago. Reativar mantém vencimento, uso e histórico; um contrato vencido não volta a valer.
- Alterar papel/limite de empresas não muda assinatura, cadastro ou propriedade de empresas. A concessão contábil é separada, mensal ou anual, sem renovação automática ou recebimento fictício. Condições personalizadas são congeladas por operação; novas condições começam após os contratos existentes.
- Contratos sem vencimento e promessas legadas de “ilimitado”, bem como os antigos prazos artificiais de dez anos, exigem revisão documentada com o proprietário antes da migração. Não se pode inferir o que foi vendido a partir do catálogo atual nem reduzir direitos contratados por uma migração técnica.
- Histórico administrativo é paginado e relaciona eventos por identificadores estáveis. Não presume receita recorrente pelo preço atual do catálogo nem correlaciona pagamentos por proximidade de horário/e-mail.

## Empresas e autorização contábil

O número total de empresas considera a cota da conta e adicionais. Novos cadastros são serializados pelo titular da cota; pendências de vínculo também reservam capacidade. Uma empresa já existente, mesmo sem proprietário, nunca é apropriada apenas pelo CNPJ público.

Solicitar vínculo com empresa existente não modifica seus dados e não libera detalhes fiscais. Titular/custodiante principal decide a solicitação; outro contador com simples acesso não pode transferir custódia. ADMIN/MASTER precisam reautenticar e documentar a evidência da autorização. Revogação preserva documentos e retira o acesso do contador, salvo outra autorização independente legítima. O texto ao cliente distingue acesso contábil duradouro de suporte temporário.

O utilitário de CNPJ segue o [manual de DV da Receita Federal/Serpro](https://www.gov.br/receitafederal/pt-br/centrais-de-conteudo/publicacoes/documentos-tecnicos/cnpj/manual-dv-cnpj.pdf): conserva caracteres alfanuméricos, zeros e dígitos verificadores. Testes incluem o exemplo do manual e a [primeira inscrição alfanumérica divulgada pela Receita](https://www.gov.br/receitafederal/pt-br/assuntos/noticias/2026/julho/receita-federal-gera-o-primeiro-cnpj-em-formato-alfanumerico). Isso valida formato/DV, não existência, titularidade, regime fiscal ou habilitação para emissão. A integração fiscal completa continua pendente.
