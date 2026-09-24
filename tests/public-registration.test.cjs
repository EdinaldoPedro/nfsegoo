const assert = require('node:assert/strict');
const test = require('node:test');
const { publicRegistrationMode, publicRegistrationOpen, requirePublicRegistrationOpen } = require('../app/utils/public-registration.ts');

test('produção falha fechada quando o modo não foi configurado ou é desconhecido', () => {
  assert.equal(publicRegistrationMode({ NODE_ENV: 'production' }), 'CLOSED');
  assert.equal(publicRegistrationMode({ NODE_ENV: 'production', PUBLIC_REGISTRATION_MODE: 'pilot' }), 'CLOSED');
  assert.equal(publicRegistrationOpen({ NODE_ENV: 'production' }), false);
});

test('abertura e fechamento exigem valores explícitos e toleram caixa e espaços', () => {
  assert.equal(publicRegistrationMode({ NODE_ENV: 'production', PUBLIC_REGISTRATION_MODE: ' open ' }), 'OPEN');
  assert.equal(publicRegistrationMode({ NODE_ENV: 'development', PUBLIC_REGISTRATION_MODE: 'closed' }), 'CLOSED');
});

test('desenvolvimento permanece aberto por padrão e pode simular o piloto fechado', () => {
  assert.equal(publicRegistrationMode({ NODE_ENV: 'development' }), 'OPEN');
  assert.equal(publicRegistrationOpen({ NODE_ENV: 'development', PUBLIC_REGISTRATION_MODE: 'CLOSED' }), false);
});

test('guard recusa cadastro antes de rate limit, banco ou envio de e-mail', () => {
  assert.throws(() => requirePublicRegistrationOpen({ NODE_ENV: 'production', PUBLIC_REGISTRATION_MODE: 'CLOSED' }), error => (
    error?.status === 503 && Boolean(error?.message?.includes('piloto'))
  ));
  assert.doesNotThrow(() => requirePublicRegistrationOpen({ NODE_ENV: 'production', PUBLIC_REGISTRATION_MODE: 'OPEN' }));
});
