# Evidência de homologação fiscal

Testes unitários, integração sintética e uma nota isolada não liberam produção. A liberação exige um relatório sanitizado, cenários externos concluídos no Portal Nacional e aprovações técnica e fiscal separadas. O arquivo de evidência não contém certificado, senha, token, XML fiscal, CPF/CNPJ ou dados do tomador; guarda apenas referências internas e hashes.

## Fluxo real

1. Mantenha `FISCAL_WORKER_ALLOW_PRODUCTION=false` e execute os cenários em homologação com certificado autorizado.
2. Registre no relatório completo os resultados de PJ, PF, consulta, rejeição, cancelamento, XML/PDF, retomada sem duplicidade e os três regimes suportados. Sanitize qualquer dado pessoal, segredo e documento fiscal antes de armazenar a evidência.
3. Execute `npm run fiscal:fingerprint`. Esse hash representa os componentes que preparam, assinam, transmitem, conciliam e validam a operação fiscal. Mudança nesses componentes invalida automaticamente a aprovação anterior.
4. Calcule o SHA-256 do relatório sanitizado. No PowerShell: `Get-FileHash -Algorithm SHA256 CAMINHO_DO_RELATORIO`.
5. Copie `config/fiscal-homologation.example.json` para uma área protegida fora do repositório e do diretório público. Preencha hashes, datas, referências e responsáveis. Mude `status` para `APPROVED` somente após as duas aprovações.
6. Configure o caminho absoluto em `FISCAL_HOMOLOGATION_EVIDENCE_FILE` e execute `npm run readiness:fiscal`.
7. Somente com `FISCAL_HOMOLOGATION_OK`, habilite `FISCAL_HOMOLOGATION_ENFORCEMENT=true` e `FISCAL_WORKER_ALLOW_PRODUCTION=true`. Em produção, o worker encerra antes de anunciar heartbeat ou capturar tarefas caso a evidência esteja ausente, vencida ou incompatível.

O prazo máximo da evidência é 180 dias. Uma alteração em código/ativos fiscais, mudança relevante do Portal, inclusão de regime ou falha externa exige nova execução e aprovação, mesmo antes do vencimento. Não edite o hash para contornar o gate: gere outra evidência a partir dos testes correspondentes.

## Cenários obrigatórios

- Emissão para PJ e PF.
- Consulta de autorização e rejeição fiscal conclusiva.
- Cancelamento e preservação do evento.
- XML e PDF coerentes com o retorno autorizado.
- Retomada após queda sem segundo envio da DPS.
- MEI, Simples Nacional e Lucro Presumido.

Referências como chamado, parecer e endereço do cofre documental devem permitir auditoria interna, mas não podem ser URLs públicas com tokens. O relatório integral permanece no repositório documental protegido; somente seu hash entra no manifesto.
