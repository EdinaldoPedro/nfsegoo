const { test } = require('node:test');
const assert = require('node:assert/strict');
const { canonicalRps } = require('./fixtures/fiscal.cjs');
const { NacionalAdapter } = require('../app/services/emissor/adapters/NacionalAdapter.ts');
const { assertValidDpsXml } = require('../app/services/emissor/validation/DpsPreflightValidator.ts');

test('DPS: atividade de evento usa as datas e o endereço nacional da prestadora', () => {
  const rps = canonicalRps(31);
  rps.servico.atividadeEvento = {
    descricao: 'Festival & mostra audiovisual',
    dataInicial: '2026-09-16',
    dataFinal: '2026-09-30',
    endereco: {
      cep: '22451-110',
      logradouro: 'Rua Frederico Eyer',
      numero: '00180',
      complemento: 'Sala 2',
      bairro: 'Gávea',
    },
  };

  const xml = new NacionalAdapter().toXml(rps);
  assertValidDpsXml(xml);
  assert.match(xml, /<atvEvento><xNome>Festival &amp; mostra audiovisual<\/xNome><dtIni>2026-09-16<\/dtIni><dtFim>2026-09-30<\/dtFim>/);
  assert.match(xml, /<end><CEP>22451110<\/CEP><xLgr>Rua Frederico Eyer<\/xLgr><nro>00180<\/nro><xCpl>Sala 2<\/xCpl><xBairro>Gávea<\/xBairro><\/end><\/atvEvento>/);
});
