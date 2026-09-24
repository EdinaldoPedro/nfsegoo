const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeDpsSeries, normalizeDpsEnvironment, normalizeDpsNumber, dpsSeriesAliases, nextDpsCandidate, MAX_STORED_DPS_NUMBER, MAX_DPS_SERIES } = require('../app/utils/dps-identity.ts');

test('DPS: zeros a esquerda nao criam outra serie; aliases sao finitos e exatos', () => {
  assert.equal(normalizeDpsSeries('00900'), '900');
  assert.equal(normalizeDpsSeries(' 0900 '), '900');
  assert.equal(normalizeDpsSeries('00000'), '0');
  assert.deepEqual(dpsSeriesAliases('00900'), ['900', '0900', '00900']);
  assert.deepEqual(dpsSeriesAliases('0'), ['0', '00', '000', '0000', '00000']);
  assert.deepEqual(dpsSeriesAliases('12345'), ['12345']);
});

test('DPS: serie invalida e ambiente desconhecido nao sao corrigidos silenciosamente', () => {
  assert.equal(normalizeDpsSeries(String(MAX_DPS_SERIES)), '89999');
  for (const value of [null, undefined, '', 'A900', '9e2', '900.0', '+900', '9 00', '90000', '99999', '000900', 900, true, {}, ['900']]) {
    assert.throws(() => normalizeDpsSeries(value), { status: 400 });
  }
  assert.equal(normalizeDpsEnvironment(' producao '), 'PRODUCAO');
  assert.equal(normalizeDpsEnvironment('HOMOLOGACAO'), 'HOMOLOGACAO');
  for (const value of [null, undefined, '', 'PRODUÇÃO', 'PRODUCA', 1, true, {}]) {
    assert.throws(() => normalizeDpsEnvironment(value), { status: 400 });
  }
});

test('DPS: limites de armazenamento nao truncam, nao transbordam e nao reiniciam', () => {
  assert.equal(normalizeDpsNumber('00012'), 12);
  assert.equal(normalizeDpsNumber(0, true), 0);
  assert.equal(normalizeDpsNumber(MAX_STORED_DPS_NUMBER), MAX_STORED_DPS_NUMBER);
  assert.equal(nextDpsCandidate(9, 12), 13);
  assert.equal(nextDpsCandidate(MAX_STORED_DPS_NUMBER, 0), null);
  assert.equal(nextDpsCandidate(0, MAX_STORED_DPS_NUMBER), null);
  for (const value of [0, -1, 1.5, NaN, Infinity, '', null, true, [], '1e2', '+1', '1.0', '12abc', MAX_STORED_DPS_NUMBER + 1, '999999999999999']) {
    assert.throws(() => normalizeDpsNumber(value), { status: 400 });
  }
});

test('DPS: consulta HEAD e gerador de XML usam a mesma identidade numerica', () => {
  const { buildDpsId } = require('../app/services/dpsSequenceService.ts');
  const { NacionalAdapter } = require('../app/services/emissor/adapters/NacionalAdapter.ts');
  const { canonicalRps } = require('./fixtures/fiscal.cjs');
  const company = { documento: '11222333000181', codigoIbge: '3550308' };
  const expected = buildDpsId(company, '900', 12);
  assert.equal(buildDpsId(company, '00900', 12), expected);
  const rps = canonicalRps(12); rps.meta.serie = '00900';
  const xml = new NacionalAdapter().toXml(rps);
  assert.ok(xml.includes(`Id="${expected}"`)); assert.ok(xml.includes('<serie>900</serie><nDPS>12</nDPS>'));
  rps.meta.serie = 'A900'; assert.throws(() => new NacionalAdapter().toXml(rps), { status: 400 });
  rps.meta.serie = '900'; rps.meta.ambiente = 'PRODUCA'; assert.throws(() => new NacionalAdapter().toXml(rps), { status: 400 });
});

test('DPS: CNPJ alfanumerico oficial preserva a identidade completa', () => {
  const { buildDpsId } = require('../app/services/dpsSequenceService.ts');
  const { NacionalAdapter } = require('../app/services/emissor/adapters/NacionalAdapter.ts');
  const { canonicalRps } = require('./fixtures/fiscal.cjs');
  const company = { documento: '12ABC34501DE35', codigoIbge: '3550308' };
  const expected = buildDpsId(company, '900', 12);
  assert.equal(expected, `DPS35503082${company.documento}00900${'12'.padStart(15, '0')}`);
  const rps = canonicalRps(12); rps.prestador.documento = company.documento;
  const xml = new NacionalAdapter().toXml(rps);
  assert.ok(xml.includes(`<CNPJ>${company.documento}</CNPJ>`));
  assert.ok(xml.includes(`Id="${expected}"`));
});
