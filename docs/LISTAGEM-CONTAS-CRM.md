# Lista administrativa de contas e CRM

Registro de 08/09/2026.

- `GET /api/admin/users` aceita apenas página, limite máximo 50, busca, papéis e segmento conhecidos. DTO explícito não carrega senha, MFA, reset, certificado, XML ou empresa completa.
- SUPORTE/SUPORTE_TI veem COMUM/CONTADOR; ADMIN não enumera MASTER; MASTER mantém visão hierárquica. Busca/filtros ocorrem antes da paginação.
- Clientes, Colaboradores e CRM consomem `data/meta`, oferecem navegação e não carregam toda a base. Busca de candidato à promoção é remota.
- Segmentos usam contrato vigente e pagamento conciliado, não texto legado do usuário.
- KPIs são agregados no banco. MRR usa valor pago, parcela do plano do pedido congelado e normalização anual; preço posterior do catálogo não o reescreve.

Evidência: 155 unitários e 111 PostgreSQL (96 subtestes, 14 grupos) aprovados. O grupo novo prova paginação/DTO, hierarquia e MRR anual congelado. Typecheck do app/worker passou; sem build ou banco original alterado.
