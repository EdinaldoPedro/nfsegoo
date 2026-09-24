# Migração de contratos e consumo — procedimento de segurança

Estado: migrações e testes sintéticos executados em banco isolado de QA; ensaio de backfill no histórico restaurado e migração do original ainda pendentes. O PostgreSQL local está disponível. Não aplicar este lote diretamente em produção nem iniciar o app novo sobre o schema antigo. O proprietário executará o build somente na etapa de validação final.

## Antes da janela

1. Confirmar o banco/ambiente de destino sem divulgar credenciais. Fazer backup consistente e comprovar restauração em PostgreSQL descartável, nunca sobre o banco original.
2. Conciliar contratos e ofertas efetivamente aceitas: datas, quantidades, base/pacotes, consumo, limites zero anteriormente apresentados como ilimitados e concessões antigas com prazo artificial. O catálogo atual não reconstrói uma venda histórica.
3. Identificar registros sem proprietário, clientes compartilhados, solicitações pendentes e vínculos contábeis com autorizações independentes. Não presumir titularidade a partir do CNPJ público.
4. Parar novas emissões e o processamento antigo. Para cada transmissão em andamento ou com resultado incerto, consultar o portal pelo identificador da DPS antes de decidir o estado final. Não retransmitir com outro número para “destravar”.
5. Conferir jobs `PENDENTE`, `PROCESSANDO` e `ERRO_TEMPORARIO`. A migração do ledger recusa continuar se houver qualquer um desses estados. Não apagar jobs, alterar estados em massa ou pular a verificação.

## Ensaio no banco restaurado

- Aplicar a sequência completa de migrações no clone. Cada nova migração ainda não aplicada usa transação explícita; a adição do papel COMERCIAL não deve ser utilizada antes do commit da sua migração.
- Conferir o backfill de clientes por empresa, referências de vendas/notas/rascunhos/jobs e snapshots contratuais. Nenhum XML autorizado deve ser reescrito.
- `PlanUsageCycle` recebe uma fotografia do contador legado. Não há restituição automática, tentativa de reconstruir meses desconhecidos ou distribuição arbitrária entre contas.
- Conferir que `EmissionCreditReservation` pertence ao titular da cobrança e ao ciclo correto, e que `EmissaoJob.creditReservationId` não se repete.
- Executar `npm run typecheck`, `npm run lint` e `npm run test:unit`. O build permanece com o proprietário.
- Para a suíte sintética, usar o executor seguro de `BANCO-TESTES.md`: ele exige banco local com nome de QA e define o opt-in apenas no subprocesso. Não executar fixtures sobre o histórico restaurado; o clone com dados reais precisa de verificações de backfill/preservação separadas. Suítes marcadas como SKIP não são resultado aprovado.
- Testar concorrência, timeout, rollback, reenvio, revogação, assinatura futura, ciclo no dia 31, pacotes e suspensão/reativação. A homologação do worker durável é outra condição de liberação, ainda pendente.

## Conferências mínimas

- Totais e valores de faturas/pedidos não mudaram indevidamente.
- Para cada contrato, limites/datas conferem com a evidência comercial; o zero não foi usado como substituto de “ilimitado”.
- As datas de início futuro não concedem cota antes da vigência.
- Autorizações já existentes continuam associadas à empresa original e aos arquivos originais.
- Uma devolução altera apenas a reserva ainda aberta e o ciclo original; reserva consumida nunca é devolvida por erro de e-mail/PDF posterior.
- Editar o cargo não aumenta vencimento, quantidade contratada ou acesso a empresas.
- Solicitantes pendentes não recebem certificado, resumo fiscal ou dados operacionais da empresa.
- A migração de sessões exige novo login e configuração/verificação de MFA para contas internas.

## Aplicação e retorno

Somente após ensaio aprovado: nova cópia de segurança, janela de manutenção, processamento parado, aplicação no alvo confirmado e testes funcionais por perfil. Registrar responsáveis, horários, versão, migrações e resultados, sem segredos.

Uma falha de migração deve ser investigada antes de usar qualquer comando de resolução do Prisma. Não marcar migração como aplicada se o schema não corresponde ao SQL. O plano de retorno precisa considerar documentos fiscais autorizados externamente: restaurar o banco não desfaz uma autorização no portal. Manter cópia pós-incidente e reconciliar os resultados externos antes de retomar emissões.
