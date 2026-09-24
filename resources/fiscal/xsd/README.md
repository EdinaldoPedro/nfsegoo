# Esquemas fiscais versionados

Origem: [publicação oficial do Portal Nacional](https://www.gov.br/nfse/pt-br/noticias/plataforma-nfs-e-disponibiliza-novas-evolucoes-em-producao-restrita-e-divulga-cronograma-de-implantacao), pacote `esquemas-nfse-rtc-v1-01-20260727.zip`, consultado em 08/09/2026. O Portal informou a entrada do tratamento de CNPJ alfanumérico em Produção em 10/08/2026. O manifesto registra URL, SHA-256 do ZIP e hashes dos arquivos normalizados em UTF-8/LF sem BOM. Nenhum documento de cliente foi usado como fixture.

Os arquivos em `1.01/` são os publicados, com apenas normalização textual. O carregador verifica seus hashes e falha se houver divergência/ausência. Imports/includes só resolvem esses buffers locais: não há acesso à rede, DTDs ou arquivos arbitrários. Os XMLs dos contribuintes não escolhem seu esquema.

## Compatibilidade do schema

O pacote de 27/07/2026 corrigiu o padrão publicado de `TSSerieDPS`; nenhuma expressão é reescrita em memória. `compatibleFiscalSchema` apenas confirma a presença exata da restrição oficial `[0-9]{1,4}|[0-8][0-9]{4}` depois da conferência de hash. Assim, pacote ou faixa alterados exigem revisão explícita. A aplicação normaliza zeros à esquerda e aceita somente a faixa numérica de 0 a 89999.

## Limites da validação

XSD valida estrutura, tipos e ordem; não prova incidência tributária, enquadramento, código municipal, cadeia ICP-Brasil ou aprovação pelo fisco. A verificação XMLDSig valida integridade criptográfica com SHA-256 e a referência efetivamente assinada. A origem governamental depende do cliente mTLS com host fixo, TLS verificado e sem redirects; não se pode reutilizar este validador para confiar em XML importado por usuários. A validação completa de cadeia ICP-Brasil e revogação permanece pendente.

O pacote aceita CNPJ alfanumérico em CNPJ, IDs e chaves. Isso não ativa automaticamente toda a NT 009: em 15/07/2026 o Portal ainda orientava Produção no leiaute base da NT 004 com `tpRetPisCofins` da NT 007 e cronograma posterior para a NT 009 completa. Versões 1.00/1.01 aceitas pelo pacote não significam suporte irrestrito a layouts históricos. Leiautes desconhecidos devem ir para conciliação, preservando o documento original.

No deploy, incluir esta pasta e `node_modules/libxml2-wasm/lib`. O worker usa o diretório raiz do projeto como diretório de trabalho. Não editar XSD em produção nem desabilitar validação para contornar uma rejeição.
