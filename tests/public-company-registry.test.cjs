const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { consultPublicCompanyRegistry } = require('../app/services/publicCompanyRegistryService.ts');

test('consulta cadastral usa identificação HTTP e ReceitaWS quando BrasilAPI bloqueia o Node', async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url: String(url), userAgent: new Headers(options?.headers).get('user-agent') || '' });
    if (String(url).includes('brasilapi')) return new Response('{}', { status: 403 });
    return new Response(JSON.stringify({ status: 'OK', cnpj: '44.932.799/0001-20', nome: 'OTG PUBLICIDADE LTDA',
      fantasia: 'OTG', cep: '78000-000', municipio: 'CUIABA', uf: 'MT',
      atividade_principal: [{ code: '73.11-4-00', text: 'Agências de publicidade' }], atividades_secundarias: [] }),
    { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const result = await consultPublicCompanyRegistry('44932799000120');
    assert.equal(result.status, 'FOUND');
    assert.equal(result.source, 'RECEITAWS');
    assert.equal(result.data.documento, '44932799000120');
    assert.equal(result.data.atividades[0].codigo, '7311400');
    assert.equal(calls.length, 2);
    calls.forEach(call => assert.match(call.userAgent, /^NFSeGoo\//));
  } finally { global.fetch = originalFetch; }
});

test('consulta cadastral diferencia ausência confirmada de indisponibilidade', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => new Response('{}', { status: 404 });
  try {
    assert.deepEqual(await consultPublicCompanyRegistry('44932799000120'), { status: 'NOT_FOUND' });
  } finally { global.fetch = originalFetch; }
});

test('consulta cadastral rejeita resposta pertencente a outro CNPJ', async () => {
  const originalFetch = global.fetch;
  global.fetch = async url => new Response(JSON.stringify(String(url).includes('brasilapi')
    ? { cnpj: '54545869000140', razao_social: 'Empresa errada' }
    : { status: 'OK', cnpj: '54.545.869/0001-40', nome: 'Empresa errada' }), { status: 200 });
  try {
    assert.deepEqual(await consultPublicCompanyRegistry('44932799000120'), { status: 'INVALID_RESPONSE' });
  } finally { global.fetch = originalFetch; }
});

test('contador e consulta da área do cliente compartilham o mesmo serviço cadastral', () => {
  const root = path.resolve(__dirname, '..');
  const accountant = fs.readFileSync(path.join(root, 'app/services/empresaService.ts'), 'utf8');
  const customer = fs.readFileSync(path.join(root, 'app/api/external/cnpj/route.ts'), 'utf8');
  for (const source of [accountant, customer]) assert.match(source, /consultPublicCompanyRegistry/);
  assert.doesNotMatch(accountant, /brasilapi\.com\.br|receitaws\.com\.br/);
});
