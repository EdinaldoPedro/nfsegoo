const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseAccountProfile, parseCompanyProfile, assertCertificateInput } = require('../app/services/profileService.ts');
const { readEmissionConfirmation, assertEmissionConfirmation } = require('../app/utils/emission-confirmation.ts');
const { companyProfileFormFields } = require('../app/utils/company-profile-form.ts');
const company = { escopo: 'EMPRESA', empresaConfirmadaId: null, documento: '11.222.333/0001-81', razaoSocial: 'Empresa de QA' };

test('formulario converte campos opcionais nulos em vazios sem usar email de login como contato', () => {
  const fields = companyProfileFormFields({ ...company, nomeFantasia: null, complemento: null, inscricaoMunicipal: null, email: 'login@example.invalid', emailComercial: null });
  assert.equal(fields.email, ''); assert.equal(fields.complemento, ''); assert.equal(fields.nomeFantasia, '');
  const { email, ...input } = fields;
  assert.doesNotThrow(() => parseCompanyProfile({ ...company, ...input, emailComercial: email }));
});

test('perfil pessoal nao aceita empresa, credencial, privilegio ou coercoes de preferencias', () => {
  const body = { escopo: 'CONTA', nome: 'Pessoa de QA', cargo: 'Analista', configuracoes: { darkMode: false, idioma: 'pt-BR', notificacoesEmail: true } };
  assert.equal(parseAccountProfile(body).nome, body.nome);
  for (const extra of [{ role: 'MASTER' }, { empresaId: 'other' }, { documento: company.documento }, { senha: 'secret' }, { email: 'new@example.invalid' }, { nome: [] }, { configuracoes: { darkMode: 'false' } }]) {
    assert.throws(() => parseAccountProfile({ ...body, ...extra }), { status: 400 });
  }
});
test('cadastro normaliza CNPJ/CNAE sem aceitar regras tributarias de cliente ou campos internos', () => {
  const activity = { codigo: '6201-5/01', descricao: 'Atividade de QA', principal: true };
  const input = parseCompanyProfile({ ...company, cnaes: [activity], complemento: 'Sala 2', emailComercial: 'COMERCIAL@example.invalid' });
  assert.equal(input.documento, '11222333000181'); assert.equal(input.cnaes[0].codigo, '6201501'); assert.equal(input.data.email, 'comercial@example.invalid');
  for (const extra of [{ proprietarioUserId: 'other' }, { donoFaturamentoId: 'other' }, { cadastroCompleto: true }, { documento: '11222333000182' },
    { cnaes: [activity, activity] }, { cnaes: [{ ...activity, temRetencaoInss: true }] }, { cnaes: [{ ...activity, principal: false }] },
    { cnaes: [] }, { uf: 'XX' }, { codigoIbge: '123' }, { ambiente: 'prod' }, { ultimoDPS: 1.5 }, { serieDPS: '9e2' }, { empresaConfirmadaId: 'existing' }]) {
    assert.throws(() => parseCompanyProfile({ ...company, ...extra }), error => error.status === 400);
  }
});
test('certificado exige base64 canonico, senha e tamanho limitado antes de abrir PKCS12', () => {
  const bytes = Buffer.alloc(1024 * 1024, 1).toString('base64');
  assert.doesNotThrow(() => assertCertificateInput(bytes, 'synthetic'));
  for (const value of ['', 'AAAA\n', 'data:application/x-pkcs12;base64,AAAA', 'AB==', {}, Buffer.alloc(1024 * 1024 + 1).toString('base64')]) {
    assert.throws(() => assertCertificateInput(value, 'synthetic'), { status: 400 });
  }
  assert.throws(() => assertCertificateInput('AAAA', ''), { status: 400 });
  assert.throws(() => parseCompanyProfile({ ...company, certificadoSenha: 'without file' }), { status: 400 });
  assert.throws(() => parseCompanyProfile({ ...company, certificadoArquivo: 'AAAA', certificadoSenha: 'synthetic', deletarCertificado: true }), { status: 400 });
});
test('confirmacao de emissao nunca deduz empresa ou ambiente e detecta tela desatualizada', () => {
  for (const input of [null, {}, [], { empresaConfirmadaId: 'qa', ambienteConfirmado: 'producao' }, { empresaConfirmadaId: 'qa', ambienteConfirmado: true }]) {
    assert.throws(() => readEmissionConfirmation(input), { status: 400 });
  }
  const confirmation = readEmissionConfirmation({ empresaConfirmadaId: 'qa', ambienteConfirmado: 'HOMOLOGACAO' });
  assert.doesNotThrow(() => assertEmissionConfirmation(confirmation, { id: 'qa', ambiente: 'HOMOLOGACAO' }));
  assert.throws(() => assertEmissionConfirmation(confirmation, { id: 'qa', ambiente: 'PRODUCAO' }), { status: 409 });
  assert.throws(() => assertEmissionConfirmation(confirmation, { id: 'other', ambiente: 'HOMOLOGACAO' }), { status: 409 });
});
