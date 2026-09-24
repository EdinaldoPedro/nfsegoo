# Conciliação de ambiente de NFS-e legadas

## Operação

1. Entre como `ADMIN` ou `MASTER` e abra **Administração → Conciliação fiscal legada** (`/admin/legado-fiscal`).
2. Confira a prévia. Somente notas autorizadas/canceladas, não arquivadas, com `ambiente` nulo e XML assinado coerente com a chave, o prestador, a empresa, o número e o valor podem ser selecionadas.
3. Selecione as notas da página, informe justificativa e sua senha atual, e confirme. Cada lote aceita até 50 notas. Repita nas páginas restantes.
4. Atualize o painel do contador/cliente. A quantidade “sem ambiente confirmado” cai conforme as notas das empresas vinculadas são conciliadas. Uma nota ainda divergente continua sinalizada, nunca é promovida a produção por presunção.

## Garantias e limites

- A operação altera **somente** `NotaFiscal.ambiente`; preserva XML, PDF, status, valor, data, número, venda, créditos e metadados legados.
- A assinatura externa da NFS-e, a chave, o CNPJ do prestador e da empresa, o número e o valor são conferidos de novo imediatamente antes do registro. As duas colunas de XML, se diferentes, não podem apontar para ambientes distintos.
- O XSD atual é exigido, exceto por erros restritos aos campos históricos `xNBS`/`CEP`. Nessa exceção, apenas o ambiente é confirmado; `metadadosVerificadosEm` continua inalterado. Novas emissões seguem a validação estrita normal.
- A senha administrativa é verificada em cada lote. Cada nota confirmada recebe um `SystemLog` na mesma transação, com responsável, justificativa, ambiente e SHA-256 do XML, sem copiar XML, certificado ou dados pessoais ao log.
- A integridade da assinatura embutida **não substitui** consulta oficial ao Portal Nacional nem validação de cadeia ICP-Brasil. Esta rotina concilia o ambiente de documentos históricos já preservados pelo SaaS, não autoriza novas notas nem declara autenticidade fiscal independente.
- Se houver divergência, ausência de XML, alteração concorrente ou falha de auditoria, a nota não muda de ambiente e permanece disponível para análise manual.

Não há migração de esquema nem processamento automático em segundo plano. Em produção, restrinja a bancada a administradores autorizados e mantenha os logs de auditoria e backups usuais.
