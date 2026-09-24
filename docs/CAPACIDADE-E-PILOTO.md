# Capacidade e escalabilidade do piloto comercial

O gate de capacidade não promete escala ilimitada. Ele comprova um baseline mínimo para iniciar um piloto controlado e obriga novo ensaio quando mudar o release, a topologia ou o perfil de uso. O teste ocorre em staging isolado, com dados sintéticos e **zero transmissão fiscal em produção**.

O arquivo real parte de `config/capacity-evidence.example.json`, fica protegido fora do repositório e é indicado por `CAPACITY_EVIDENCE_FILE`. `readiness:capacity` compara seu `releaseId` ao manifesto selado; resultado obtido com outro commit/build é recusado.

## Baseline inicial

- pelo menos 30 minutos, 20 usuários concorrentes e 5.000 requisições;
- base sintética com ao menos 25 empresas e 1.000 notas para exercitar paginação e relatórios;
- leituras autenticadas, enfileiramento em homologação, PDFs, relatórios, retomada de filas e isolamento entre empresas;
- reinício individual de web e dos três workers;
- taxa de erro HTTP até 1%, p95 até 1,5 s, p99 até 3 s e readiness disponível em pelo menos 99,5% do ensaio;
- CPU, memória e conexões de banco abaixo de 80%, preservando margem para picos;
- atraso p95 das filas até 60 segundos e zero vazamento entre tenants.

Esses valores são um critério mínimo para o piloto pequeno, não um SLA ao cliente nem garantia para campanhas ou crescimento súbito. Depois do piloto, substitua o perfil por tráfego observado e aumente gradualmente carga/duração.

## Como executar

1. Gere o release candidato e implante exatamente o mesmo artefato em staging com topologia equivalente à produção.
2. Use banco exclusivo com dados sintéticos. Certificados e credenciais devem ser próprios de homologação; bloqueie saída para endpoints fiscais de produção.
3. Prepare sessões de usuários sintéticos pertencentes a empresas diferentes. Nunca grave senhas ou cookies no relatório.
4. Execute a ferramenta de carga aprovada pela equipe. Distribua os cenários de modo representativo e registre séries temporais de latência, erros, CPU, memória, conexões e filas.
5. Durante a carga, reinicie um processo por vez. Confirme que requests já aceitos permanecem nas filas e que o readiness retira/recoloca a instância corretamente.
6. Execute verificações negativas cruzadas entre tenants. Qualquer acesso indevido torna o resultado inválido, independentemente de desempenho.
7. Guarde relatório bruto, configuração da carga, dashboards e aprovações técnica/operacional no repositório protegido. Preencha a evidência e rode `npm run readiness:capacity`.

## Pilotagem real

- Comece com um grupo limitado de empresas e canal de suporte acompanhado.
- Observe saturação, atraso das filas, rejeições fiscais, PDFs e consultas antes de ampliar o grupo.
- Aumente capacidade horizontal dos processos independentes, respeitando o orçamento de conexões do PostgreSQL.
- Se p95, filas ou recursos se aproximarem dos limites, pause novas entradas no piloto; não aumente concorrência do worker fiscal sem medir limites do portal e idempotência.
- Reexecute o ensaio após mudanças relevantes de consulta, PDF, XML, banco, autenticação, relatórios, topologia ou versão do runtime.

O ensaio não substitui testes funcionais por perfil nem homologação fiscal externa. Ele também não deve ser executado contra produção para “descobrir o limite” depois que clientes estiverem ativos.
