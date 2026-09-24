const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateSameOrigin, normalizeBase64Attachment, validateJsonContentLength } = require('../app/utils/request-guards.ts');
const { getPublicBaseUrl, normalizeOrigin } = require('../app/utils/request-url.ts');

test('CSRF rejeita origem ausente, cross-site e headers forwarded forjados', () => {
  const previous = process.env.NODE_ENV;
  const previousUrl = process.env.NEXT_PUBLIC_APP_URL;
  process.env.NODE_ENV = 'production'; process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.com';
  try {
    const request = (headers) => new Request('https://app.example.com/api/test', { method: 'POST', headers });
    assert.equal(validateSameOrigin(request({ origin: 'https://app.example.com' })), null);
    assert.equal(validateSameOrigin(request({})).status, 403);
    assert.equal(validateSameOrigin(request({ origin: 'https://evil.example', 'x-forwarded-host': 'evil.example' })).status, 403);
    assert.equal(validateSameOrigin(request({ origin: 'https://app.example.com', 'sec-fetch-site': 'cross-site' })).status, 403);
    assert.equal(getPublicBaseUrl(request({ 'x-forwarded-host': 'evil.example' })), 'https://app.example.com');
    assert.equal(normalizeOrigin('javascript:alert(1)'), null);
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous;
    if (previousUrl === undefined) delete process.env.NEXT_PUBLIC_APP_URL; else process.env.NEXT_PUBLIC_APP_URL = previousUrl;
  }
});

test('Anexo exige extensao, MIME declarado e assinatura binaria coerentes', () => {
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]).toString('base64');
  assert.equal(normalizeBase64Attachment(png, 'imagem.png').errorResponse, null);
  assert.equal(normalizeBase64Attachment(png, 'imagem.pdf').errorResponse.status, 400);
  assert.equal(normalizeBase64Attachment(`data:application/pdf;base64,${png}`, 'imagem.png').errorResponse.status, 400);
  assert.equal(normalizeBase64Attachment(Buffer.from('<script>alert(1)</script>').toString('base64'), 'arquivo.xml').errorResponse.status, 400);
  assert.equal(normalizeBase64Attachment(Buffer.from('<!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><x>&e;</x>').toString('base64'), 'arquivo.xml').errorResponse.status, 400);
  assert.equal(normalizeBase64Attachment('not-base64!', 'arquivo.pdf').errorResponse.status, 400);
  assert.equal(normalizeBase64Attachment(png, 'imagem.png', 3).errorResponse.status, 413);
});

test('Desenvolvimento aceita aliases loopback somente na mesma porta', () => {
  const previous = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'development';
    const req = origin => new Request('http://localhost:3000/api/test', { method: 'POST', headers: { origin } });
    assert.equal(validateSameOrigin(req('http://127.0.0.1:3000')), null);
    assert.equal(validateSameOrigin(req('http://[::1]:3000')), null);
    assert.equal(validateSameOrigin(req('http://127.0.0.1:3001')).status, 403);
    process.env.NODE_ENV = 'production';
    assert.equal(validateSameOrigin(req('http://127.0.0.1:3000')).status, 403);
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous;
  }
});

test('Content-Length negativo e payload acima do limite sao rejeitados', () => {
  const request = (length) => new Request('http://localhost/api', { method: 'POST', headers: { 'content-length': length } });
  assert.equal(validateJsonContentLength(request('-1')).status, 400);
  assert.equal(validateJsonContentLength(request('100'), 10).status, 413);
});
