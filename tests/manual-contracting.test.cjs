const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validatePaymentProof, serializePedidoContratacao } = require('../app/utils/manual-contracting.ts');

test('Comprovante exige assinatura binaria coerente, nao apenas extensao e MIME', () => {
  const invalid = Buffer.from('<html><script>alert(1)</script></html>');
  assert.ok(validatePaymentProof({ nomeArquivo: 'recibo.pdf', mimeType: 'application/pdf', tamanho: invalid.length, conteudoBase64: invalid.toString('base64') }).errorResponse);
  const pdf = Buffer.from('%PDF-1.7\nfixture sintetica');
  const input = { nomeArquivo: 'recibo.pdf', mimeType: 'application/pdf', tamanho: pdf.length, conteudoBase64: pdf.toString('base64') };
  assert.equal(validatePaymentProof(input).value.tamanho, pdf.length);
  assert.ok(validatePaymentProof({ ...input, tamanho: 1 }).errorResponse);
  assert.ok(validatePaymentProof({ ...input, conteudoBase64: 'data:image/png;base64,' + input.conteudoBase64 }).errorResponse);
});

test('Metadados publicos do pedido nao revelam observacoes internas', () => {
  const result = serializePedidoContratacao({ id: 'qa', gatewayId: JSON.stringify({
    planoNome: 'Basic', ticketId: 'qa-ticket', observacaoInterna: 'NOTA_INTERNA', processadoPor: 'staff-id',
  }) });
  assert.equal(result.detalhes.planoNome, 'Basic');
  assert.doesNotMatch(JSON.stringify(result), /NOTA_INTERNA|staff-id|observacaoInterna|processadoPor/);
});
