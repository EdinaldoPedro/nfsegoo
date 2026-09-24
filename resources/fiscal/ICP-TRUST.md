# Raízes públicas ICP-Brasil incluídas no SaaS

Fonte: [pacote vigente do Instituto Nacional de Tecnologia da Informação (ITI)](https://www.gov.br/iti/pt-br/assuntos/repositorio/certificados-das-acs-da-icp-brasil-arquivo-unico-compactado), atualizado em 26/08/2026. Arquivo baixado em 16/09/2026 do link oficial `ACcompactado.zip`. O SHA-512 calculado do ZIP coincidiu com `hashsha512.txt` publicado na mesma página:

`4585a99955607525e475cf22138302fe8ddce6ca8f0926cd1f01809f007d4bcddff5c1070369d29b1de99c0d2eb058ce0deb856bae0189469ba37e09a59d7985`

O arquivo `icp-brasil-roots-20260826.pem` contém **somente** as ACs Raiz v5 e v12 extraídas desse ZIP, sem chaves privadas nem certificados de usuários. Para cada uma, foram conferidos assinatura autoassinada e atributo CA com o X.509 do Node:

| Raiz | SHA-256 do `.crt` no ZIP | Expira |
| --- | --- | --- |
| v5 | `5bd85f219695dabe6cf3d4bd713d9bd8e41b2323194022acf1acd658daef148a` | 02/03/2029 |
| v12 | `ce6c66c73e41b12881ea8a9b8cb7efef9a482ea012c3cd3b843667e37a7a145c` | 22/10/2037 |

As raízes v6/v7 do pacote usam algoritmo de chave pública que a versão atual do `node-forge` não interpreta neste fluxo; não foram incluídas para não criar uma falsa promessa de validação. O bundle padrão cobre apenas cadeias que terminem em v5/v12 e sejam processáveis pela biblioteca atual. Se o A1 real pertencer a outra cadeia, o cadastro continuará recusado com erro de cadeia: identifique a AC emissora e implemente suporte criptográfico apropriado antes de liberar produção. Não substitua a verificação por `requireTrustedChain: false` em produção.

O bundle é lido do diretório `resources/fiscal` por padrão. `ICP_BRASIL_TRUST_BUNDLE_PEM` ou `ICP_BRASIL_TRUST_BUNDLE_FILE` substitui esse padrão quando explicitamente configurado. O arquivo precisa acompanhar web e worker em implantação. O teste de cadeia local não consulta CRL/OCSP nem prova aceite no Portal Nacional; revogação e homologação externa permanecem gates separados. Revise o pacote quando o ITI atualizar raízes, antes da expiração da v5, e no mínimo a cada ciclo de implantação.
