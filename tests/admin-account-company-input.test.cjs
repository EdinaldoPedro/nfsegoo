const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseAccountCompanyQuery, parseAccountCompanyMutation, assertNoLegacyCompanyMutation, accountCompanySelect } = require('../app/services/adminAccountCompanyService.ts');
const { parseCompanyRegistration } = require('../app/services/companyRegistrationService.ts');
const authorization = { adminPassword: 'synthetic-password', justification: 'Cadastro solicitado em QA' };
const input = { action: 'REGISTER_NEW', documento: '88777666000100', razaoSocial: 'Empresa de QA', ...authorization };
const primary = { action: 'SET_PRIMARY', empresaId: 'qa-company-id', expectedUserUpdatedAt: '2026-09-03T00:00:00.000Z', ...authorization };

test('empresas da conta: pagina/busca limitadas e DTO sem segredos ou carteira', () => {
  assert.deepEqual(parseAccountCompanyQuery(new URLSearchParams()), { page: 1, limit: 10, search: '' });
  for (const query of ['page=0', 'page=-1', 'page=100001', 'page=1.5', 'page=1x', 'limit=26', 'limit=0', 'search=' + 'a'.repeat(121), 'search=a%00b']) assert.throws(() => parseAccountCompanyQuery(new URLSearchParams(query)), { status: 400 });
  assert.equal(parseAccountCompanyQuery(new URLSearchParams('limit=25&page=3&search=Empresa')).page, 3);
  assert.deepEqual(Object.keys(accountCompanySelect).sort(), ['ambiente', 'arquivadoEm', 'documento', 'id', 'razaoSocial', 'updatedAt']);
});
test('cadastro novo aceita apenas identidade validada; nao converte letras em outro CNPJ', () => {
  assert.deepEqual(parseCompanyRegistration({ documento: '88.777.666/0001-00', razaoSocial: ' Empresa QA ' }), { documento: '88777666000100', razaoSocial: 'Empresa QA' });
  assert.equal(parseCompanyRegistration({ documento: '12.ABC.345/01DE-35', razaoSocial: 'QA alfanumérica' }).documento, '12ABC34501DE35');
  for (const value of [null, [], {}, { documento: '88777666000101', razaoSocial: 'Nome' }, { documento: 88777666000100, razaoSocial: 'Nome' },
    { documento: '88777666000100', razaoSocial: 'Nome\nindevido' }, { documento: '88777666000100', razaoSocial: 'a'.repeat(201) },
    { documento: '88777666000100', razaoSocial: ['Nome'] }, { documento: '88777666000100', razaoSocial: 'Nome', proprietarioUserId: 'another' }]) assert.throws(() => parseCompanyRegistration(value), { status: 400 });
});
test('cadastro/principal nao aceitam operacoes mistas, papeis, certificado ou versao ausente', () => {
  assert.equal(parseAccountCompanyMutation(input).company.documento, input.documento);
  assert.equal(parseAccountCompanyMutation(primary).empresaId, primary.empresaId);
  assert.equal(parseAccountCompanyMutation({ ...primary, empresaId: null }).empresaId, null);
  for (const extra of [{ role: 'MASTER' }, { proprietarioUserId: 'x' }, { ambiente: 'PRODUCAO' }, { certificadoA1: 'x' }, { empresaId: 'x' }, { action: ['REGISTER_NEW'] }]) assert.throws(() => parseAccountCompanyMutation({ ...input, ...extra }), { status: 400 });
  for (const extra of [{ expectedUserUpdatedAt: undefined }, { expectedUserUpdatedAt: '2026-02-30T00:00:00.000Z' }, { empresaId: undefined }, { empresaId: ['x'] }, { documento: input.documento }]) assert.throws(() => parseAccountCompanyMutation({ ...primary, ...extra }), { status: 400 });
});
test('toda mutacao de empresa da conta exige senha atual e justificativa limitada', () => {
  for (const extra of [{ adminPassword: '' }, { adminPassword: ['pw'] }, { adminPassword: 'á'.repeat(37) }, { justification: 'curta' }, { justification: 'x'.repeat(2001) }, { justification: 'Texto de QA\u0000 inválido' }]) assert.throws(() => parseAccountCompanyMutation({ ...input, ...extra }), { status: 400 });
  assert.equal(parseAccountCompanyMutation({ ...input, justification: 'Solicitação de QA.\nConfirmado o cadastro.' }).justification.includes('\n'), true);
});
test('atalhos antigos sao rejeitados mesmo vazios e misturados com concessao ou papel', () => {
  for (const key of ['newCnpj', 'unlinkCompany', 'addEmpresaProprietaria', 'removeEmpresaProprietariaId', 'empresaId', 'proprietarioUserId', 'donoFaturamentoId', 'contadorCustodianteId']) {
    for (const value of [null, false, '', 'another-company']) assert.throws(() => assertNoLegacyCompanyMutation({ id: 'qa-user', role: 'CONTADOR', plano: 'CUSTOM', [key]: value }), { status: 409 });
  }
  assert.doesNotThrow(() => assertNoLegacyCompanyMutation({ id: 'qa-user', role: 'CONTADOR', limiteEmpresas: 5 }));
  for (const input of [null, [], 'x']) assert.throws(() => assertNoLegacyCompanyMutation(input), { status: 400 });
});
