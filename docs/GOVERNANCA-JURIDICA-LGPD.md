# Governança jurídica e LGPD para lançamento

O código implementa controles técnicos, mas não pode emitir parecer jurídico nem provar sozinho que contratos, bases legais e fornecedores estão adequados ao negócio real. Por isso, `readiness:legal` exige uma evidência externa aprovada e vinculada por hash ao conteúdo jurídico efetivamente entregue no release.

O arquivo real parte de `config/legal-governance.example.json`, fica fora do repositório público e é indicado por `LEGAL_GOVERNANCE_EVIDENCE_FILE`. Ele contém referências, versões e responsáveis; contratos completos, dados pessoais, credenciais e pareceres permanecem no repositório documental protegido.

## Documentos mínimos

- Termos de Uso e Política de Privacidade, com versões idênticas às variáveis publicadas.
- Política de cookies compatível com as tecnologias realmente utilizadas.
- acordo/termo de tratamento de dados para a relação B2B em que o SaaS opera dados do cliente;
- registro das atividades de tratamento e inventário de bases/finalidades;
- tabela de retenção e descarte, incluindo exceções fiscais, contábeis, segurança e exercício de direitos;
- procedimento de direitos dos titulares;
- plano de resposta a incidentes;
- registro de operadores/suboperadores e suas avaliações.

O modelo não afirma qual cláusula ou prazo é juridicamente suficiente. Essas decisões precisam ser revisadas por profissional habilitado conforme os produtos, clientes, fornecedores e localidades reais.

## Fluxo de aprovação

1. Congele o release candidato e execute `npm run legal:fingerprint`.
2. Jurídico, privacidade e segurança revisam o mesmo conteúdo, fornecedores e procedimentos. Guarde suas aprovações no repositório protegido.
3. Preencha a evidência com o fingerprint, versões finais, referências dos documentos e responsáveis. Configure as mesmas versões em `NEXT_PUBLIC_TERMS_VERSION` e `NEXT_PUBLIC_PRIVACY_VERSION`.
4. Execute `npm run readiness:legal`. Qualquer alteração posterior nos textos, aceite, direitos ou incidentes invalida o hash e exige nova revisão.
5. Quando Termos/Privacidade mudarem materialmente, publique novas versões. O mecanismo existente exigirá novo aceite autenticado; não altere o conteúdo mantendo a versão antiga.

## Operadores e transferências

Hospedagem, banco e e-mail devem constar no inventário com finalidade, país, contrato/DPA e revisão de segurança. Outros serviços que tratem dados devem ser adicionados antes da integração. O nome público do fornecedor pode permanecer no documento apropriado; a evidência usa referências internas não secretas.

Se houver armazenamento, suporte ou acesso fora do Brasil, registre países, avaliação e salvaguardas aplicáveis. Marcar `occurs: false` exige inventário que sustente essa conclusão; trocar região ou fornecedor reabre a avaliação.

## Operação diária

- A fila de privacidade deve ter responsável e acompanhamento de prazos; respostas e recusas exigem fundamento documentado.
- Pedidos de eliminação não apagam registros com retenção legítima pendente. Primeiro resolva obrigações e vínculos, depois execute o fluxo seguro existente.
- Um alerta técnico não vira automaticamente incidente LGPD. Havendo suspeita de comprometimento de dados, o responsável registra, avalia risco e decide comunicações no módulo de incidentes.
- Novo fornecedor, nova finalidade, analytics/marketing, mudança de país, cobrança automática ou nova categoria de dados exige revisão do inventário e, quando aplicável, dos textos e consentimentos antes do rollout.

## Critério de lançamento

`NEXT_PUBLIC_LEGAL_DOCUMENTS_APPROVED=true` continua necessário, mas não é suficiente. A comercialização somente passa no gate quando identidade/canais são reais, versões não são rascunho e `readiness:legal` confirma conteúdo, documentos internos, operadores, transferências, responsabilidades e três aprovações vigentes.
