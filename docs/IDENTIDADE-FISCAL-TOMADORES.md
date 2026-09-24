# Identidade fiscal única de tomadores PJ

Estado em 09/09/2026: implementado, migrado no banco local e validado em QA sintético. Não substitui homologação fiscal externa, validação jurídica ou aceite humano por perfil.

## Modelo adotado

- `EntidadeFiscal` representa os dados cadastrais públicos de uma PJ, com unicidade global por CNPJ.
- `Cliente` continua sendo o relacionamento privado entre uma empresa emissora e o tomador. Seu ID não mudou, portanto vendas, notas, jobs e vínculos históricos não foram reescritos.
- E-mail de emissão, telefone, inscrição municipal e inscrição estadual permanecem em `Cliente`. Uma carteira nunca consulta esses campos de outra.
- PF e exterior continuam locais por empresa; CPF não foi transformado em identidade global.
- CNAEs públicos ficam associados à identidade fiscal. A fonte e a data de consulta são registradas.
- Correções administrativas públicas ficam em `EntidadeFiscalCorrecao` e prevalecem sobre o valor retornado pela fonte até serem removidas.
- `EntidadeFiscalEvento` e `SystemLog` registram criação, atualização, correção e remoção de correção. Senha e dados privados da carteira não entram nesses eventos.

## Fonte cadastral

A integração atual consulta a BrasilAPI e, quando necessário para completar o código do município, a ViaCEP. São agregadores públicos; a aplicação não os apresenta como conexão direta contratada com Receita Federal ou Serpro. CNPJ alfanumérico continua válido no domínio, mas a atualização automática aguarda suporte da fonte; a identidade pode nascer dos dados revisados no formulário.

Uma consulta externa:

1. valida o CNPJ pedido e o CNPJ devolvido;
2. limita tempo e tamanho da resposta, bloqueia redirecionamento e rejeita conteúdo inválido;
3. grava hash do conteúdo normalizado e procedência;
4. não apaga valor cadastral antigo quando a fonte omite um campo;
5. não substitui correção administrativa ativa;
6. não copia e-mail público para o e-mail fiscal particular sem escolha do prestador.

## Administração

A central `/admin/tomadores` é exclusiva de `ADMIN` e `MASTER`. Ela mostra somente identidade pública e quantidade agregada de relações. Não mostra empresas emissoras, e-mails particulares, telefones particulares ou inscrições municipais.

Correção, atualização da fonte e remoção de correções exigem:

- sessão administrativa com MFA aplicável;
- senha atual;
- justificativa entre 10 e 2.000 caracteres;
- versão otimista atual do cadastro;
- whitelist de campos públicos.

O CNPJ não pode ser trocado. IM continua manual no cadastro de cada carteira e não possui seletor ou lista global.

## Emissão e histórico

Ao registrar um job, o servidor resolve a identidade pública com as correções vigentes, combina os dados privados da carteira e congela essa fotografia no payload durável. Uma atualização global posterior não muda o job já confirmado. A nota autorizada mantém XML, nome/documento verificados e snapshot fiscal próprios.

## Migração local

A migração `20260909230000_canonical_fiscal_entities` foi aplicada primeiro em PostgreSQL isolado. No `nfse_db`, consolidou 28 relações PJ em 23 identidades únicas. Permaneceram:

- 8 usuários;
- 35 empresas emissoras;
- 48 relacionamentos `Cliente`;
- 114 notas;
- 157 vendas;
- 117 jobs.

Verificações pós-migração: zero CNPJ duplicado em `EntidadeFiscal`, zero relação ligada a documento/tipo incompatível e 50 migrações reconhecidas pelo Prisma.

## Evidência automatizada

- 195/195 testes unitários/regressivos.
- 145/145 testes PostgreSQL isolados.
- Typecheck web e worker aprovados.
- Lint completo aprovado.
- Prisma schema e estado das migrações aprovados.
- Smoke test em desenvolvimento: status, página de clientes, central administrativa e negação 401 das novas APIs sem sessão.

O build não foi executado, conforme reservado ao proprietário.
