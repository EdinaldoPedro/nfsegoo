const { test } = require('node:test');
const assert = require('node:assert/strict');
const { consultarEntidadeFiscalPublica, effectiveFiscalEntity, mergeTenantCustomer } = require('../app/services/fiscalEntityService.ts');
const { parseAdminFiscalEntityMutation, parseAdminFiscalEntityQuery } = require('../app/services/adminFiscalEntityService.ts');

test('identidade fiscal: correção administrativa prevalece sem misturar dados privados da carteira', () => {
  const entity = { id: 'entity-1', documento: '11222333000181', razaoSocial: 'Razão da fonte', nomeFantasia: 'Fonte',
    cep: '01001000', logradouro: 'Rua Fonte', numero: '10', complemento: null, bairro: 'Centro', cidade: 'São Paulo', uf: 'SP',
    pais: 'Brasil', codigoIbge: null, version: 2, fonte: 'BRASILAPI', fonteConsultadaEm: new Date('2026-09-01T00:00:00Z'),
    updatedAt: new Date('2026-09-01T00:00:00Z'), correcoes: [{ campo: 'codigoIbge', valor: '3550308', updatedAt: new Date('2026-09-02T00:00:00Z') }] };
  assert.equal(effectiveFiscalEntity(entity).codigoIbge, '3550308');
  const merged = mergeTenantCustomer({ id: 'customer-1', empresaId: 'issuer-1', entidadeFiscalId: entity.id, tipo: 'PJ',
    documento: entity.documento, nome: 'Legado', email: 'privado@example.invalid', telefone: '11999999999',
    inscricaoMunicipal: '1234', updatedAt: new Date('2026-08-01T00:00:00Z'), entidadeFiscal: entity });
  assert.equal(merged.nome, 'Razão da fonte'); assert.equal(merged.codigoIbge, '3550308');
  assert.equal(merged.email, 'privado@example.invalid'); assert.equal(merged.telefone, '11999999999');
  assert.equal(merged.inscricaoMunicipal, '1234'); assert.equal(merged.updatedAt.toISOString(), '2026-09-02T00:00:00.000Z');
  assert.equal('correcoes' in merged, false); assert.equal('entidadeFiscal' in merged, false);
});

test('admin identidade fiscal: entrada é estrita e nunca aceita CNPJ ou campos particulares', () => {
  const valid = { id: 'entity-1', expectedVersion: 1, action: 'CORRECT', data: { codigoIbge: '3550308', uf: 'sp' },
    adminPassword: 'synthetic-password', justification: 'Correção pública confirmada em QA' };
  const parsed = parseAdminFiscalEntityMutation(valid);
  assert.deepEqual(parsed.data, { codigoIbge: '3550308', uf: 'SP' });
  for (const field of ['documento', 'email', 'emailPublico', 'telefone', 'telefonePublico', 'inscricaoMunicipal']) {
    assert.throws(() => parseAdminFiscalEntityMutation({ ...valid, data: { [field]: 'x' } }), { status: 400 });
  }
  for (const change of [{ expectedVersion: 0 }, { adminPassword: '' }, { justification: 'curta' }, { action: 'DELETE' },
    { data: {} }, { role: 'MASTER' }]) assert.throws(() => parseAdminFiscalEntityMutation({ ...valid, ...change }), { status: 400 });
  assert.deepEqual(parseAdminFiscalEntityMutation({ ...valid, action: 'RESET', data: undefined, fields: ['codigoIbge', 'codigoIbge'] }).fields, ['codigoIbge']);
  const refresh = parseAdminFiscalEntityMutation({ ...valid, action: 'REFRESH', data: undefined, sourceHash: 'a'.repeat(64) });
  assert.equal(refresh.sourceHash, 'a'.repeat(64));
  assert.throws(() => parseAdminFiscalEntityMutation({ ...valid, action: 'REFRESH', data: undefined }), { status: 400 });
  assert.throws(() => parseAdminFiscalEntityMutation({ ...valid, sourceHash: 'a'.repeat(64) }), { status: 400 });
  assert.equal(parseAdminFiscalEntityQuery(new URLSearchParams('page=2&limit=50&search=Empresa')).page, 2);
  for (const query of ['page=0', 'limit=51', 'page=1.5', 'search=' + 'x'.repeat(121)]) assert.throws(() => parseAdminFiscalEntityQuery(new URLSearchParams(query)), { status: 400 });
});

test('consulta pública identifica o cliente HTTP exigido pela fonte externa', async () => {
  const originalFetch = global.fetch;
  let receivedUserAgent = '';
  global.fetch = async (_url, options) => {
    receivedUserAgent = new Headers(options?.headers).get('user-agent') || '';
    return new Response(JSON.stringify({ cnpj: '44932799000120', razao_social: 'OTG PUBLICIDADE LTDA',
      codigo_municipio: 5103403, municipio: 'CUIABA', uf: 'MT', cnae_fiscal: 7311400,
      cnae_fiscal_descricao: 'Agências de publicidade', cnaes_secundarios: [] }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  };
  try {
    const result = await consultarEntidadeFiscalPublica('44932799000120');
    assert.equal(result?.data.documento, '44932799000120');
    assert.match(receivedUserAgent, /^NFSeGoo\//);
  } finally {
    global.fetch = originalFetch;
  }
});

test('consulta pública complementa endereço incompleto pelo CEP sem inventar número', async () => {
  const originalFetch = global.fetch;
  global.fetch = async url => new Response(JSON.stringify(String(url).includes('viacep') ? {
    cep: '50870-005', logradouro: 'Avenida Doutor José Rufino', complemento: 'lado ímpar',
    bairro: 'Areias', localidade: 'Recife', uf: 'PE', ibge: '2611606',
  } : {
    cnpj: '54545869000140', razao_social: '54.545.869 EDINALDO PEDRO DA SILVA', cep: '50870005',
    bairro: 'AREIAS', municipio: 'RECIFE', uf: 'PE', codigo_municipio: 2531,
    cnae_fiscal: 6201501, cnaes_secundarios: [],
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  try {
    const result = await consultarEntidadeFiscalPublica('54545869000140');
    assert.equal(result?.fonte, 'BRASILAPI_VIACEP');
    assert.equal(result?.data.logradouro, 'Avenida Doutor José Rufino');
    assert.equal(result?.data.bairro, 'AREIAS');
    assert.equal(result?.data.codigoIbge, '2611606');
    assert.equal(result?.data.numero, null);
  } finally { global.fetch = originalFetch; }
});
