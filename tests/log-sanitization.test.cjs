const { test } = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeLogValue, getErrorDiagnostics } = require('../app/services/logger.ts');
const { EmailService } = require('../app/services/EmailService.ts');

test('logs removem credenciais e dados pessoais, preservando fingerprints', () => {
  const value = sanitizeLogValue({ email: 'pessoa@example.com', to: ['pessoa@example.com'], password: 'segredo',
    emailHash: 'a'.repeat(64), nested: { cpf: '123.456.789-00', ok: true } });
  assert.equal(value.email, '*** DADO SENSIVEL OMITIDO ***');
  assert.equal(value.to, '*** DADO SENSIVEL OMITIDO ***');
  assert.equal(value.password, '*** DADO SENSIVEL OMITIDO ***');
  assert.equal(value.nested.cpf, '*** DADO SENSIVEL OMITIDO ***');
  assert.equal(value.emailHash, 'a'.repeat(64));
  assert.equal(value.nested.ok, true);
});

test('diagnóstico sanitiza e-mail e segredo em URL sem persistir pilha de produção', () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    const value = getErrorDiagnostics(new Error('Falha para pessoa@example.com em /reset?token=supersecreto'));
    assert.doesNotMatch(value.message, /pessoa@|supersecreto/);
    assert.equal(value.stack, undefined);
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous;
  }
});

test('sanitizador é limitado e tolera referência circular', () => {
  const value = { ok: true }; value.self = value;
  assert.equal(sanitizeLogValue(value).self, '*** REFERENCIA CIRCULAR OMITIDA ***');
  assert.match(sanitizeLogValue('x'.repeat(5000)), /OMITIDO|truncado/);
});

test('templates de e-mail escapam conteúdo e mantêm link HTTPS ou fragmento seguro', () => {
  const service = new EmailService();
  const recovery = service.getTemplateRecuperacaoSenha('<img src=x onerror=alert(1)>', 'https://app.example/reset#token=abc');
  assert.doesNotMatch(recovery, /<img src=x/);
  assert.match(recovery, /&lt;img/);
  assert.match(recovery, /https:\/\/app\.example\/reset#token=abc/);
  const support = service.getTemplateRespostaSuporte({ nome: 'A', protocolo: 1, assunto: '<script>x</script>', trecho: '<b>x</b>' });
  assert.doesNotMatch(support, /<script>|<b>x<\/b>/);
});
