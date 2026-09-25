const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseAdminCompanyQuery, parseAdminCompanyMutation, adminCompanySelect, adminCustomerSelect,
  companyPublicRegistryData, companyPublicRegistryPatch } = require('../app/services/adminCompanyService.ts');
const input = { id: 'company-id', origem: 'PRESTADOR', expectedUpdatedAt: '2026-09-03T00:00:00.000Z', action: 'UPDATE',
  data: { razaoSocial: 'Empresa QA', email: 'COMERCIAL@EXAMPLE.INVALID' }, adminPassword: 'synthetic-password', justification: 'Correção solicitada em QA' };

test('admin empresas: pagina e limites estritos, busca limitada e categoria/situacao explicitas', () => {
  assert.deepEqual(parseAdminCompanyQuery(new URLSearchParams()), { page: 1, limit: 10, type: 'PRESTADOR', state: 'ATIVOS', empresaId: undefined, search: '' });
  for (const query of ['page=0', 'limit=0', 'page=-1', 'page=1.5', 'page=2abc', 'limit=51', 'page=100001', 'type=ANY', 'state=ANY', 'empresaId=x', 'search=' + 'a'.repeat(121)]) {
    assert.throws(() => parseAdminCompanyQuery(new URLSearchParams(query)), { status: 400 });
  }
  assert.equal(parseAdminCompanyQuery(new URLSearchParams('type=TOMADOR&empresaId=company-id&state=ARQUIVADOS&limit=50')).empresaId, 'company-id');
});
test('admin empresas: DTO minimo nunca consulta certificados, senhas ou carteiras inteiras', () => {
  for (const select of [adminCompanySelect, adminCustomerSelect]) for (const key of ['certificadoA1', 'senhaCertificado', 'senha', 'minhaCarteira']) assert.equal(select[key], undefined);
  assert.equal(adminCustomerSelect.vinculos.take, 1);
  assert.equal(adminCustomerSelect.empresa.select.id, true);
});
test('admin empresas: whitelist bloqueia identidade, acesso, sequencia e mass assignment', () => {
  assert.equal(parseAdminCompanyMutation(input).data.email, 'comercial@example.invalid');
  assert.equal(parseAdminCompanyMutation({ ...input, justification: 'Solicitação de QA.\nRevisão do endereço.' }).justification, 'Solicitação de QA.\nRevisão do endereço.');
  for (const key of ['documento', 'tipo', 'nif', 'pais', 'moeda', 'empresaId', 'ultimoDPS', 'serieDPS', 'ambiente', 'regimeTributario', 'cadastroCompleto', 'proprietarioUserId', 'certificadoA1', 'toString']) {
    assert.throws(() => parseAdminCompanyMutation({ ...input, data: { [key]: 'x' } }), { status: 400 });
  }
  for (const data of [null, [], {}, { email: 'sem-dominio' }, { razaoSocial: '' }, { complemento: 'a'.repeat(101) }, { razaoSocial: 'Nome\nindevido' }]) {
    assert.throws(() => parseAdminCompanyMutation({ ...input, data }), { status: 400 });
  }
});
test('admin empresas: senha/justificativa/versao e escopo do tomador sao obrigatorios', () => {
  for (const extra of [{ adminPassword: '' }, { adminPassword: 'á'.repeat(37) }, { adminPassword: 1 }, { justification: 'curta' },
    { expectedUpdatedAt: undefined }, { expectedUpdatedAt: '2026-99-99T00:00:00.000Z' }, { origem: 'ANY' }, { action: 'DELETE' },
    { origem: 'TOMADOR' }, { origem: ['PRESTADOR'] }, { action: ['UPDATE'] }, { empresaId: 'another-company' }, { role: 'MASTER' }, { action: 'ARCHIVE' }]) assert.throws(() => parseAdminCompanyMutation({ ...input, ...extra }), { status: 400 });
  assert.equal(parseAdminCompanyMutation({ ...input, origem: 'TOMADOR', empresaId: 'tenant-1' }).empresaId, 'tenant-1');
  assert.equal(parseAdminCompanyMutation({ ...input, action: 'ARCHIVE', data: undefined }).action, 'ARCHIVE');
  assert.equal(parseAdminCompanyMutation({ ...input, action: 'RESTORE', data: undefined }).action, 'RESTORE');
});

test('admin prestador: atualização pública exige prévia e não alcança campos privados ou fiscais', () => {
  const parsed = parseAdminCompanyMutation({ ...input, action: 'REFRESH', data: undefined, sourceHash: 'a'.repeat(64) });
  assert.equal(parsed.action, 'REFRESH'); assert.equal(parsed.sourceHash, 'a'.repeat(64));
  assert.throws(() => parseAdminCompanyMutation({ ...input, action: 'REFRESH', data: undefined }), { status: 400 });
  assert.throws(() => parseAdminCompanyMutation({ ...input, origem: 'TOMADOR', empresaId: 'tenant-1',
    action: 'REFRESH', data: undefined, sourceHash: 'a'.repeat(64) }), { status: 400 });
  const publicData = companyPublicRegistryData({ data: { documento: '37414793000103', razaoSocial: 'AK PRODUCOES LTDA',
    nomeFantasia: null, situacaoCadastral: 'ATIVA', emailPublico: 'publico@example.invalid', telefonePublico: '0000',
    cep: '51021040', logradouro: 'ENGENHEIRO DOMINGOS FERREIRA', numero: '4023', complemento: null,
    bairro: 'BOA VIAGEM', cidade: 'RECIFE', uf: 'PE', pais: 'Brasil', codigoIbge: '2611606' }, atividades: [],
    fonte: 'BRASILAPI', payloadHash: 'a'.repeat(64), consultedAt: new Date() });
  assert.equal(publicData.numero, '4023');
  for (const protectedField of ['documento', 'email', 'emailPublico', 'telefonePublico', 'inscricaoMunicipal',
    'certificadoA1', 'ambiente', 'serieDPS', 'ultimoDPS']) assert.equal(Object.hasOwn(publicData, protectedField), false);
  const patch = companyPublicRegistryPatch({ data: { documento: '37414793000103', razaoSocial: 'AK PRODUCOES LTDA',
    nomeFantasia: null, situacaoCadastral: 'ATIVA', emailPublico: null, telefonePublico: null,
    cep: '51021040', logradouro: null, numero: null, complemento: null, bairro: 'BOA VIAGEM',
    cidade: 'RECIFE', uf: 'PE', pais: 'Brasil', codigoIbge: '2611606' }, atividades: [],
    fonte: 'BRASILAPI', payloadHash: 'b'.repeat(64), consultedAt: new Date() });
  assert.equal(patch.bairro, 'BOA VIAGEM');
  for (const omitted of ['nomeFantasia', 'logradouro', 'numero', 'complemento']) assert.equal(Object.hasOwn(patch, omitted), false);
});
