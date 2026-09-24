# Saída do piloto e abertura pública

Mudar `PUBLIC_REGISTRATION_MODE` para `OPEN` aumenta aquisição, suporte, e-mail, trial e demanda fiscal. A decisão não pode depender apenas de “pareceu funcionar”. O gate exige observação real e evidência aprovada para o mesmo release.

## Critério mínimo

- Ao menos 14 dias corridos de piloto, sem misturar mais de 90 dias ou releases diferentes.
- Três empresas ativas e três clientes que concluíram o fluxo principal.
- Dez emissões de produção bem-sucedidas e ao menos uma interação de suporte revisada.
- Disponibilidade mínima de 99,5%, erro HTTP de até 1% e resposta mediana inicial do suporte em até 24 horas.
- Zero incidente de isolamento, emissão duplicada, perda documental, severidade 1/2 não resolvida, conciliação manual aberta ou suporte prioritário represado.
- Todas as falhas fiscais observadas classificadas e revisadas.
- Aprovações separadas de Produto, Técnica e Operação.

Esses números são o piso para abrir cadastro, não um SLA público. Se o perfil comercial esperado for maior que o ensaio de capacidade, repita o ensaio antes de abrir.

## Procedimento

1. Mantenha `LAUNCH_STAGE=CONTROLLED_PILOT` e `PUBLIC_REGISTRATION_MODE=CLOSED` durante a observação.
2. Extraia métricas sanitizadas, revise incidentes, conciliações, tickets e falhas fiscais.
3. Preencha `config/public-launch-evidence.example.json` em local protegido, usando o `releaseId` implantado.
4. Execute `npm run readiness:public-launch`. Pendência ou limite excedido mantém o cadastro fechado.
5. Somente com aprovação, configure `LAUNCH_STAGE=PUBLIC` e `PUBLIC_REGISTRATION_MODE=OPEN`; execute novamente `readiness:production` antes da mudança.
6. Continue monitorando. Abertura não impede retornar a `CLOSED` imediatamente se aquisição ou suporte se tornarem a origem do risco.

Correção de código gera outro release e invalida a evidência. O novo pacote precisa de regressão e aprovação compatíveis; não reutilize o relatório anterior por conveniência.
