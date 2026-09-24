const { test } = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');
process.env.ENCRYPTION_KEY = '12345678901234567890123456789012'; // Synthetic, isolated test process.
const { BaseStrategy } = require('../app/services/emissor/strategies/BaseStrategy.ts');
const { makeDps, makeNfse, key } = require('./fixtures/fiscal.cjs');
const { preparedDpsId } = require('../app/services/emissor/validation/AuthorizedNfseValidator.ts');
const dps = makeDps(); const id = preparedDpsId(dps);
const xml = makeNfse(dps, { numero: '25' });
class FixtureStrategy extends BaseStrategy {
  extrairCredenciais() { return { cert: 'synthetic-not-for-TLS', key: 'synthetic-not-for-TLS', senha: 'must-not-be-sent' }; }
}
const company = { ambiente: 'PRODUCAO' };

test('transporte: DPS armazenada adulterada ou sem assinatura nao chega a rede', async () => {
  const original = axios.request; let calls = 0;
  axios.request = async () => { calls++; throw new Error('Nao deveria enviar'); };
  try {
    for (const invalid of [dps.replace('123.45', '999.99'), dps.replace(/<Signature[\s\S]*<\/Signature>/, '')]) {
      const result = await new FixtureStrategy().transmitirPreparado(invalid, company);
      assert.equal(result.sucesso, false); assert.equal(result.failureKind, 'LOCAL_REJECTION');
    }
    assert.equal(calls, 0);
  } finally { axios.request = original; }
});

test('transporte: uma chamada POST limitada, mTLS sem senha do PFX em Authorization e sem redirecionamento', async () => {
  const original = axios.request; const calls = [];
  axios.request = async (config) => { calls.push(config); return { status: 201, data: { chaveAcesso: key, nfseXmlGZipB64: Buffer.from(xml).toString('base64') } }; };
  try {
    const result = await new FixtureStrategy().transmitirPreparado(dps, company);
    assert.equal(result.sucesso, true); assert.equal(result.notaGov.numero, '25');
    assert.equal(calls.length, 1); assert.equal(calls[0].method, 'POST');
    assert.equal(calls[0].url, 'https://sefin.nfse.gov.br/SefinNacional/nfse');
    assert.equal(calls[0].timeout, 30000); assert.equal(calls[0].maxRedirects, 0);
    assert.equal(calls[0].httpsAgent.options.rejectUnauthorized, true);
    assert.equal(calls[0].headers.Authorization, undefined);
  } finally { axios.request = original; }
});
test('transporte: timeout nao reenvia, nao afirma rejeicao e nao propaga credencial/erro Axios', async () => {
  const original = axios.request; let calls = 0;
  axios.request = async () => { calls++; throw { message: 'timeout secret-value', config: { key: 'private-secret' } }; };
  try {
    const result = await new FixtureStrategy().transmitirPreparado(dps, company);
    assert.equal(calls, 1); assert.equal(result.sucesso, false); assert.equal(result.failureKind, 'UNKNOWN');
    assert.ok(!JSON.stringify(result).includes('secret'));
  } finally { axios.request = original; }
});
test('transporte: conciliacao usa somente GET, valida XML original e nunca transforma 404 em permissao de reenvio', async () => {
  const original = axios.request; const calls = [];
  axios.request = async (config) => { calls.push(config); return config.url.includes('/dps/')
    ? { status: 200, data: { chaveAcesso: key } } : { status: 200, data: { nfseXmlGZipB64: Buffer.from(xml).toString('base64') } }; };
  try {
    assert.equal((await new FixtureStrategy().conciliarDps(dps, company)).sucesso, true);
    assert.equal(calls.length, 2); assert.ok(calls.every((c) => c.method === 'GET'));
    assert.ok(calls[0].url.endsWith('/dps/' + id)); assert.ok(calls[1].url.endsWith('/nfse/' + key));
    axios.request = async (config) => { assert.equal(config.method, 'GET'); return { status: 404 }; };
    const missing = await new FixtureStrategy().conciliarDps(dps, company);
    assert.equal(missing.sucesso, false); assert.equal(missing.failureKind, 'UNKNOWN');
  } finally { axios.request = original; }
});
