# Aceite manual do release

O roteiro em `TESTES-MANUAIS.md` é uma especificação, não uma aprovação automática. Cada release candidato precisa ser exercitado em staging com os perfis indicados, e cada caso precisa terminar como `PASSED` com uma referência de evidência sanitizada. Falha, bloqueio, ausência ou `skip` impedem o lançamento.

## Vínculos obrigatórios

- O `releaseId` deve ser exatamente o manifesto implantado em staging.
- O `planFingerprint` representa todo o conteúdo do roteiro. Alterar uma ação ou resultado esperado invalida o aceite anterior.
- Cada ID do roteiro aparece uma única vez no arquivo e uma única vez em `caseResults`.
- Evidências não podem conter senha, token, documento fiscal, dado pessoal ou URL assinada. Use referências para o repositório protegido.
- Produto, técnica e operação aprovam separadamente; uma pessoa não acumula essas aprovações no mesmo release.
- O aceite vale por no máximo 30 dias e somente para o release e roteiro avaliados.

## Execução

1. Gere e implante o pacote candidato sem recompilar no staging.
2. Copie `config/manual-acceptance-evidence.example.json` para o repositório protegido.
3. Execute o roteiro inteiro por perfil. Registre capturas/logs sanitizados e preencha um resultado `PASSED` por ID.
4. Registre as três aprovações depois da execução. Mude `status` para `APPROVED` somente quando não houver pendência.
5. Configure `MANUAL_ACCEPTANCE_EVIDENCE_FILE` com caminho absoluto e execute `npm run readiness:acceptance`.
6. Qualquer correção gera outro release: refaça ao menos os casos afetados e toda regressão prevista no roteiro, emitindo nova evidência para o novo `releaseId`.

O gate não clica na interface, não cria usuários, não aprova resultado e não substitui observação humana. Ele apenas impede que uma planilha incompleta, antiga ou pertencente a outro pacote seja tratada como aceite comercial.
