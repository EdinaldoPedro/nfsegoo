const { test } = require('node:test');
const assert = require('node:assert/strict');
process.env.ENCRYPTION_KEY = '12345678901234567890123456789012';
const axios = require('axios');
const vault = require('../app/services/certificateVault.ts');
const { headDps } = require('../app/services/dpsSequenceService.ts');
test('numeracao: HEAD usa mTLS sem enviar senha PFX em Basic e libera agente TLS', async () => {
  const original = axios.head; const open = vault.openEmpresaCertificate; const calls = [];
  vault.openEmpresaCertificate = () => ({ cert: 'synthetic-no-network', key: 'synthetic-no-network', senha: 'must-not-be-sent' });
  axios.head = async (url, config) => { calls.push({ url, config }); return { status: 404 }; };
  try {
    const result = await headDps({ id: 'qa', documento: '11222333000181', codigoIbge: '3550308' }, 'PRODUCAO', '900', 12);
    assert.equal(result.exists, false); assert.equal(calls.length, 1);
    assert.equal(calls[0].config.headers?.Authorization, undefined);
    assert.equal(calls[0].config.httpsAgent.options.rejectUnauthorized, true);
    assert.equal(calls[0].config.maxRedirects, 0); assert.equal(calls[0].config.timeout, 12000);
    assert.ok(!JSON.stringify(calls).includes('must-not-be-sent'));
  } finally { axios.head = original; vault.openEmpresaCertificate = open; }
});
