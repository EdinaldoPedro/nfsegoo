# Transferência de responsável pelo cadastro

Registro técnico de 08/09/2026. O processo muda responsabilidade e acesso dentro do NFSe Goo; não declara propriedade jurídica do CNPJ.

## Controles

- ADMIN/MASTER abre proposta idempotente com senha própria, CNPJ, justificativa, chamado ativo do destinatário e nota interna própria. CNPJ, pagamento ou custódia isolados não são prova.
- Termos imutáveis vinculam destino, responsáveis anteriores, grafo de acesso, ambiente, validade de sete dias e consequências. Só uma proposta fica pendente por empresa.
- Destinatário e responsáveis anteriores aceitam na própria sessão/senha. Troca de senha invalida o aceite; participante pode rejeitar tudo.
- Recuperação realmente órfã exige outro MASTER e segunda nota interna própria. Registro faturado, custodiado ou acessível não usa esse atalho.
- Conclusão reconfere snapshot, papéis, consentimentos, sessão/MFA, plano, cotas da empresa/carteira e ausência de operação fiscal ou sincronização incerta.
- O commit troca responsável/faturamento, revoga historicamente operadores/contadores e preserva notas, XMLs, vendas, tomadores, contratos, faturas, créditos e sequências.
- O A1 não é entregue: certificado/senha/validade são removidos; a empresa volta à homologação e fica incompleta até nova autorização de produção.
- APIs têm CSRF, limite de corpo, rate limit, sessão revogável, MFA, impersonação somente leitura, paginação e minimização de IDs.

## Evidência

- 155 unitários e 111 PostgreSQL em 14 grupos aprovados. O grupo novo prova idempotência, isolamento pré-aceite, senha/hash/aceites, commit atômico, preservação do XML e revogação histórica.
- Migração aditiva 35 aplicada somente no QA sintético; não apaga nem transfere dados existentes.
- Typecheck de app/worker, lint novo e `diff --check` aprovados. Sem build, worker real ou chamada fiscal.

Documentos continuam no atendimento protegido; a tabela guarda referências e hashes, não PFX/XML/anexos de identidade. Análise jurídica continua humana. A migração requer backup/restauração e rollout antes do banco real; Q01–Q12 exigem pessoas distintas.
