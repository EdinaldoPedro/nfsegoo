const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseRegistrationInput, parseRegistrationConfirmation } = require('../app/services/registrationService.ts');
const { privacyVersion, termsVersion } = require('../app/legal-content.ts');

const legalAcceptance = { accepted: true, termsVersion, privacyVersion };

test('cadastro aceita nomes reais curtos e registra versões legais exatas', () => {
  const parsed = parseRegistrationInput({ nome: "  Ana D'Ávila  ", email: ' ANA@Example.Invalid ', cpf: '529.982.247-25',
    senha: 'Segura@Senha1', legalAcceptance });
  assert.equal(parsed.nome, "Ana D'Ávila");
  assert.equal(parsed.email, 'ana@example.invalid');
  assert.equal(parsed.cpf, '52998224725');
  assert.equal(parsed.termsVersion, termsVersion);
  assert.equal(parsed.privacyVersion, privacyVersion);
});

test('cadastro rejeita privilégios, documentos divergentes e aceite antigo', () => {
  const base = { nome: 'Pessoa QA', email: 'pessoa@example.invalid', cpf: '52998224725', senha: 'Segura@Senha1', legalAcceptance };
  assert.throws(() => parseRegistrationInput({ ...base, role: 'MASTER' }), /Campos/);
  assert.throws(() => parseRegistrationInput({ ...base, documento: '11144477735' }), /CPF/);
  assert.throws(() => parseRegistrationInput({ ...base, legalAcceptance: { ...legalAcceptance, termsVersion: 'antiga' } }), /mudaram/);
  assert.throws(() => parseRegistrationInput({ ...base, legalAcceptance: { ...legalAcceptance, accepted: false } }), /mudaram/);
});

test('confirmação cadastral exige objeto estrito, e-mail e seis dígitos', () => {
  assert.deepEqual(parseRegistrationConfirmation({ email: ' A@Example.Invalid ', code: '012345' }),
    { email: 'a@example.invalid', code: '012345' });
  assert.throws(() => parseRegistrationConfirmation({ email: 'a@example.invalid', code: 123456 }), /Código/);
  assert.throws(() => parseRegistrationConfirmation({ email: 'a@example.invalid', code: '123456', role: 'MASTER' }), /Campos/);
});
