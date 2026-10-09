const { test } = require('node:test');
const assert = require('node:assert/strict');
const { getMensagemErroFiscalCliente } = require('../app/utils/fiscal-error-messages.ts');

test('retorno do Portal que proibe prest/IM oferece omissao sem apagar o cadastro', () => {
  const result = getMensagemErroFiscalCliente({
    details: [{
      codigo: 'E0120',
      mensagem: 'IM do prestador não deve ser informado, pois não existem informações complementares registradas no CNC NFS-e do município emissor informado na DPS.',
    }],
  });
  assert.equal(result.reasonType, 'INSCRICAO_MUNICIPAL_NAO_INFORMAR');
  assert.equal(result.needsSupport, false);
  assert.match(result.message, /preservar a IM no cadastro/i);
  assert.doesNotMatch(result.message, /remova a IM/i);
});
