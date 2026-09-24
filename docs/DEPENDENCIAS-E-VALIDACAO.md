# Atualizacao de seguranca da base

Registro de 02/09/2026. Esta etapa integra a remediacao, nao e autorizacao de producao.

## Alteracoes

- Next 14.2.35 -> 16.3.4; React/React DOM 18.3.1 -> 19.2.8.
- Cookies e parametros de rotas migrados para APIs assincronas; tipos de rotas gerados sem build.
- `serverComponentsExternalPackages` substituido por `serverExternalPackages`.
- Axios 1.20.0, xmldom 0.8.15, node-forge 1.4.0, Nodemailer 9.1.1, jsPDF 4.2.1, AutoTable 5.0.8, Playwright 1.62.1.
- libxml2-wasm 0.7.1 fixado, sem dependências transitivas de runtime, instalado sem scripts. XSDs oficiais são carregados de arquivos locais com verificação de hash; importação dinâmica preservada em Node16 no worker e no executor de testes. Assets incluídos explicitamente no tracing do Next; build continua reservado ao proprietário.
- Puppeteer removido: era usado apenas para localizar um navegador alternativo, nao para executar a automacao. Continua possivel configurar um executavel via `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` (ou o nome legado `PUPPETEER_EXECUTABLE_PATH`).
- ESLint 10.9.1 com regras efetivas; configuracao anterior nao tinha regras de verificacao.
- Removido o pacote npm `node`. Usar o runtime Node 24 do ambiente; `.node-version` indica a versao de referencia.

## Resultado e limites da evidencia

A auditoria completa de dependencias terminou com zero alertas conhecidos. A base anterior tinha 19 alertas de producao, dois criticos. Houve regressao automatizada de PDF, criptografia e extracao de PFX sintetico. Os testes sinteticos nao validam a cadeia ICP-Brasil nem substituem homologacao fiscal externa.

Nao foi executado `npm run build`, conforme pedido do proprietario. O banco isolado de QA passou por 35 migrações e 111 testes de integração; o banco original não foi migrado. Fluxos completos por perfil (navegador de relatórios/cópia/perfil/manutenção administrativa já conferido parcialmente em QA), backfill legado, ambiente de producao, SMTP e Portal Nacional com certificado real ainda exigem validacao posterior. `npm audit` completo e somente produção foram repetidos após a instalação do validador XSD: zero alertas conhecidos.

## Referencias tecnicas

- [Politica de suporte do Next.js](https://nextjs.org/support-policy)
- [Migracao oficial para Next.js 16](https://nextjs.org/docs/app/guides/upgrading/version-16)
- Documentacao da versao instalada: `node_modules/next/dist/docs/`.
- [Transporte SMTP do Nodemailer](https://nodemailer.com/smtp)
- [Historico do Puppeteer](https://pptr.dev/CHANGELOG) — consultado antes de confirmar que a dependencia podia ser removida.

## Reproducao local (sem build)

1. Instalar Node 24 e dependencias com `npm ci` conforme a politica de scripts do ambiente.
2. Executar `node node_modules/prisma/build/index.js generate`.
3. Executar `node node_modules/playwright/cli.js install chromium` quando o ambiente precisar da consulta automatizada ao Portal Nacional.
4. Executar `node node_modules/next/dist/bin/next typegen` e `npm run typecheck`.
5. Executar `npm run test:unit` e `npm run lint`.
6. Executar `npm audit` e revisar novos alertas, sem usar `--force` indiscriminadamente.
7. Executar `npm run worker:typecheck`. Compilacao separada `npm run worker:compile` e build do Next ficam com o proprietario; inicializacao e homologacao seguem `WORKER-EMISSAO.md`.

Instalacoes de producao precisam tambem das bibliotecas de sistema do Chromium e de limites de recursos. Isso sera detalhado no runbook operacional.
