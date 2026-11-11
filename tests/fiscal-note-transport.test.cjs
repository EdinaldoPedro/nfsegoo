const { test } = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');
const { gzipSync } = require('node:zlib');
process.env.ENCRYPTION_KEY = '12345678901234567890123456789012'; // Synthetic, isolated test process.
const { BaseStrategy } = require('../app/services/emissor/strategies/BaseStrategy.ts');
const { prepareCancellationRequest } = require('../app/services/emissor/validation/CancellationEvent.ts');
const { makeDps, makeNfse, key, signingCredentials, makeCancellationEvent } = require('./fixtures/fiscal.cjs');
class FixtureStrategy extends BaseStrategy {
  extrairCredenciais() { return { ...signingCredentials(), senha: 'synthetic-never-send-as-basic' }; }
}
const company = { documento: '11222333000181', ambiente: 'PRODUCAO' };
const reason = { code: '1', justification: 'Erro identificado na descricao do servico' };
const prepare = (overrides = {}) => prepareCancellationRequest({ key, ambiente: company.ambiente, authorDocument: company.documento, reason, timestamp: new Date('2026-09-02T13:00:00Z'), ...overrides }, signingCredentials());

test('cancelamento: certificado ausente ou corrompido e rejeicao local antes da fronteira', async () => {
  await assert.rejects(new FixtureStrategy().prepararCancelamento(key, reason, new Date(), company), { status: 400 });
  class InvalidCertificateStrategy extends FixtureStrategy { extrairCredenciais() { throw new Error('synthetic-private-diagnostic'); } }
  await assert.rejects(new InvalidCertificateStrategy().prepararCancelamento(key, reason, new Date(), { ...company, certificadoA1: 'encrypted-fixture', senhaCertificado: 'encrypted-fixture' }),
    error => error.status === 400 && !error.message.includes('synthetic-private-diagnostic'));
});

test('consulta: palavra cancelada no servico nao e cancelamento; eventos ausentes permitem confirmar autorizacao', async () => {
  const original = axios.request; const calls = [];
  const xml = makeNfse(makeDps(1, (rps) => ({ ...rps, servico: { ...rps.servico, descricao: 'Correcao de venda cancelada, texto de teste' } })));
  axios.request = async (config) => { calls.push(config); return config.url.includes('/eventos/') ? { status: 404 } : { status: 200, data: { nfseXmlGZipB64: Buffer.from(xml).toString('base64') } }; };
  try {
    const result = await new FixtureStrategy().consultar(key, company);
    assert.equal(result.sucesso, true); assert.equal(result.situacao, 'AUTORIZADA');
    assert.equal(calls.length, 5); assert.ok(calls.every(c => c.method === 'GET' && c.maxRedirects === 0 && c.timeout === 30000 && !c.headers.Authorization));
    assert.equal(result.xmlEvento, undefined);
  } finally { axios.request = original; }
});
test('consulta: evento indisponivel nao autoriza afirmar autorizacao; XML recebido precisa de assinatura valida', async () => {
  const original = axios.request; const xml = makeNfse();
  try {
    for (const nfse of [xml, xml.replace('123.45', '999.99')]) {
      axios.request = async (c) => c.url.includes('/eventos/') ? { status: c.url.endsWith('/101101/1') ? 503 : 404 } : { status: 200, data: { nfseXmlGZipB64: nfse } };
      const result = await new FixtureStrategy().consultar(key, company);
      assert.equal(result.sucesso, false); assert.equal(result.situacao, 'ERRO');
    }
  } finally { axios.request = original; }
});
test('cancelamento: pedido de outro autor/ambiente/chave ou adulterado falha antes de qualquer POST', async () => {
  const original = axios.request; let calls = 0;
  axios.request = async () => { calls++; throw new Error('never'); };
  try {
    const request = await prepare();
    for (const xml of [await prepare({ ambiente: 'HOMOLOGACAO' }), await prepare({ authorDocument: '04252011000110' }), await prepare({ key: '2'.repeat(50) }), request.replace('Erro identificado', 'Texto adulterado')]) {
      const result = await new FixtureStrategy().transmitirCancelamento(xml, key, company);
      assert.equal(result.sucesso, false); assert.equal(result.failureKind, 'LOCAL_REJECTION');
    }
    assert.equal(calls, 0);
  } finally { axios.request = original; }
});
test('cancelamento: um POST; eco do pedido, E0840, timeout e evento adulterado permanecem incertos', async () => {
  const original = axios.request; const xml = await prepare();
  const cases = [
    { status: 201, data: { eventoXmlGZipB64: xml } },
    { status: 400, data: { erros: [{ Codigo: 'E0840' }] } },
    { status: 201, data: { eventoXmlGZipB64: makeCancellationEvent(xml).replace('13:01:00', '13:02:00') } },
    new Error('timeout private-secret'),
  ];
  try {
    for (const [index, response] of cases.entries()) {
      const calls = [];
      axios.request = async (config) => { calls.push(config); if (response instanceof Error) throw response; return response; };
      const result = await new FixtureStrategy().transmitirCancelamento(xml, key, company);
      assert.equal(result.sucesso, false); assert.equal(result.failureKind, 'UNKNOWN');
      assert.equal(result.portalDiagnostic.category, index === 1 ? 'PORTAL_REJECTION' : index === 3 ? 'PORTAL_TRANSPORT' : 'INVALID_PORTAL_EVENT');
      assert.equal(calls.length, 1); assert.equal(calls[0].method, 'POST');
      assert.equal(calls[0].url, `https://sefin.nfse.gov.br/SefinNacional/nfse/${key}/eventos`);
      assert.ok(calls[0].data.pedidoRegistroEventoXmlGZipB64); assert.equal(calls[0].headers.Authorization, undefined);
      assert.ok(!JSON.stringify(result).includes('private-secret'));
    }
  } finally { axios.request = original; }
});
test('cancelamento: falha local de confianca TLS e definitiva e nao simula resposta do Portal', async () => {
  const original = axios.request; const xml = await prepare();
  try {
    axios.request = async () => { throw Object.assign(new Error('synthetic tls detail'), { code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' }); };
    const result = await new FixtureStrategy().transmitirCancelamento(xml, key, company);
    assert.equal(result.sucesso, false);
    assert.equal(result.failureKind, 'LOCAL_REJECTION');
    assert.equal(result.portalDiagnostic.category, 'LOCAL_TLS_TRUST');
    assert.ok(!JSON.stringify(result).includes('synthetic tls detail'));
  } finally { axios.request = original; }
});
test('cancelamento: rejeicao fiscal preserva somente diagnostico seguro e libera decisao definitiva', async () => {
  const original = axios.request; const xml = await prepare();
  try {
    axios.request = async () => ({ status: 422, data: { erros: [{ Codigo: 'E1234', Descricao: 'Cancelamento fora das regras municipais.' }] } });
    const result = await new FixtureStrategy().transmitirCancelamento(xml, key, company);
    assert.equal(result.sucesso, false); assert.equal(result.failureKind, 'PORTAL_REJECTION');
    assert.deepEqual(result.portalDiagnostic.errors, [{ codigo: 'E1234', mensagem: 'Cancelamento fora das regras municipais.' }]);
    assert.equal(result.portalDiagnostic.httpStatus, 422);
  } finally { axios.request = original; }
});
test('cancelamento: ResponseErro singular do endpoint de eventos e tratado como rejeicao definitiva', async () => {
  const original = axios.request; const xml = await prepare();
  try {
    axios.request = async () => ({ status: 400, data: { erro: {
      codigo: 'E1234', descricao: 'Pedido recusado.', complemento: 'Revise o motivo informado.'
    } } });
    const result = await new FixtureStrategy().transmitirCancelamento(xml, key, company);
    assert.equal(result.sucesso, false);
    assert.equal(result.failureKind, 'PORTAL_REJECTION');
    assert.deepEqual(result.portalDiagnostic.errors, [{
      codigo: 'E1234', mensagem: 'Pedido recusado. Revise o motivo informado.'
    }]);
  } finally { axios.request = original; }
});
test('cancelamento: conciliacao ausente registra as quatro consultas GET sem afirmar cancelamento', async () => {
  const original = axios.request; const xml = await prepare();
  try {
    axios.request = async () => ({ status: 404 });
    const result = await new FixtureStrategy().conciliarCancelamento(xml, key, company);
    assert.equal(result.sucesso, false); assert.equal(result.failureKind, 'UNKNOWN');
    assert.equal(result.portalDiagnostic.category, 'CANCELLATION_EVENT_ABSENT');
    assert.deepEqual(result.portalDiagnostic.eventChecks, ['101101', '105102', '105104', '305101'].map(type => ({ type, status: 404 })));
  } finally { axios.request = original; }
});
test('cancelamento: resposta conclusiva vincula pedido; conciliacao externa usa somente GET sem inventar autoria', async () => {
  const original = axios.request; const xml = await prepare();
  try {
    axios.request = async () => ({ status: 201, data: { eventoXmlGZipB64: makeCancellationEvent(xml) } });
    const confirmed = await new FixtureStrategy().transmitirCancelamento(xml, key, company);
    assert.equal(confirmed.sucesso, true); assert.equal(confirmed.requestMatched, true);
    const external = makeCancellationEvent(await prepare({ reason: { code: '2', justification: 'Servico contratado nao foi prestado' } }));
    const calls = [];
    axios.request = async (c) => { calls.push(c); return c.url.endsWith('/101101/1') ? { status: 200, data: { eventoXmlGZipB64: external } } : { status: 404 }; };
    const result = await new FixtureStrategy().conciliarCancelamento(xml, key, company);
    assert.equal(result.sucesso, true); assert.equal(result.requestMatched, false);
    assert.equal(calls.length, 4); assert.ok(calls.every(c => c.method === 'GET'));
  } finally { axios.request = original; }
});

test('cancelamento: le envelope atual eventos[].arquivoXml com base64 externo do Portal', async () => {
  const original = axios.request; const xml = await prepare();
  const official = makeCancellationEvent(xml);
  const arquivoXml = Buffer.from(gzipSync(Buffer.from(official)).toString('base64')).toString('base64');
  try {
    axios.request = async (config) => config.url.endsWith('/101101/1')
      ? { status: 200, data: { eventos: [{ tipoEvento: '101101', arquivoXml }] } }
      : { status: 404 };
    const result = await new FixtureStrategy().conciliarCancelamento(xml, key, company);
    assert.equal(result.sucesso, true);
    assert.equal(result.requestMatched, true);
    assert.ok(result.xmlEvento);
  } finally { axios.request = original; }
});
