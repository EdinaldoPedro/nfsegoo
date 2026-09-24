const { test } = require('node:test');
const assert = require('node:assert/strict');
process.env.JWT_SECRET = 'unit-test-secret-with-more-than-32-bytes';
const { signJWT, verifyJWT } = require('../app/utils/auth.ts');

test('JWT inclui emissor, audiencia, identificador de sessao e versao revogavel', async () => {
  const token = await signJWT({ sub: 'user', role: 'COMUM', sv: 3, sessionId: 'session' });
  const payload = await verifyJWT(token);
  assert.equal(payload.sub, 'user'); assert.equal(payload.jti, 'session'); assert.equal(payload.sv, 3);
  assert.equal(payload.iss, 'nfsegoo'); assert.equal(payload.aud, 'nfsegoo-web');
  assert.equal(payload.exp - payload.iat, 8 * 60 * 60);
});

test('JWT alterado e token arbitrario sao rejeitados', async () => {
  const token = await signJWT({ sub: 'user', role: 'COMUM', sv: 0, sessionId: 'session' });
  const parts = token.split('.');
  parts[1] = Buffer.from(JSON.stringify({ sub: 'other', role: 'MASTER' })).toString('base64url');
  assert.equal(await verifyJWT(parts.join('.')), null);
  assert.equal(await verifyJWT('invalid'), null);
});
