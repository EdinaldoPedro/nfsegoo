# Release reproduzível e indivisível

Web, workers, dependências, migrações e recursos fiscais formam uma única versão. Não copie apenas `.next`, apenas `dist/worker` ou um arquivo corrigido diretamente para o servidor. O manifesto de release associa todos esses componentes ao mesmo commit e detecta alteração, ausência ou mistura posterior.

## Construção

Use um checkout descartável, sem `.env` de produção, na revisão aprovada. O repositório deve estar sem alterações e com Node/npm exatamente nas versões declaradas por `.node-version` e `packageManager`.

```powershell
npm run release:build
```

Esse comando executa, em ordem: `npm ci`, Prisma Client, testes unitários, typechecks web/worker, lint, build Next, compilação dos três workers e criação de `dist/release-manifest.json`. A primeira falha encerra o processo. Ele não migra banco, não inicia serviço e não transmite nota.

Os testes PostgreSQL continuam sendo executados separadamente no banco isolado autorizado. O manifesto não transforma teste ausente em aprovação e não substitui a homologação fiscal externa.

## Distribuição e ativação

Distribua o diretório resultante sem recompilar no servidor. Preserve, no mínimo, `.next`, `dist/worker`, `dist/release-manifest.json`, dependências instaladas, `package.json`, `package-lock.json`, Prisma, recursos fiscais, scripts de runtime e os fontes incluídos pelo verificador. Configure:

```text
RELEASE_MANIFEST_FILE=/opt/nfsegoo/dist/release-manifest.json
```

Antes de iniciar qualquer processo:

```powershell
npm run readiness:release
npm run readiness:migrations
npm run readiness:fiscal
```

Os modelos de serviço executam o gate de release em `ExecStartPre`. Se um arquivo for trocado, um worker vier de outro build, a versão do Node divergir, uma migração mudar ou faltar artefato, o processo não inicia. Faça rollback implantando integralmente um release anterior compatível com o estado atual do banco; nunca edite o manifesto ou substitua arquivos isolados.

## Regras operacionais

- O manifesto só é criado a partir de commit limpo e não pode sobrescrever outro manifesto.
- Build não é feito no host que atende usuários.
- Segredos e `.env` não entram no manifesto nem no pacote versionado.
- O mesmo pacote aprovado vai para homologação e produção; somente configuração e credenciais mudam.
- Guarde manifesto, commit, resultado dos gates e aprovação do rollout junto ao registro da mudança.
