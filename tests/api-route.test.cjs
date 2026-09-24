const { test } = require('node:test');
const assert = require('node:assert/strict');
const { assertBoundedJsonBody, withApiGuard } = require('../app/utils/api-route.ts');

function request(body, extraHeaders = {}) {
  return new Request('http://localhost:3000/api/test', {
    method: 'POST', headers: { origin: 'http://localhost:3000', 'content-type': 'application/json', ...extraHeaders },
    body, duplex: 'half',
  });
}

test('Corpo original permanece legivel apos inspecao limitada', async () => {
  const req = request(JSON.stringify({ a: [1, 2], b: 'teste' }));
  await assertBoundedJsonBody(req, 1000);
  assert.deepEqual(await req.json(), { a: [1, 2], b: 'teste' });
});

test('Limite real rejeita transferencias sem tamanho e com tamanho forjado', async () => {
  for (const headers of [{}, { 'content-length': '2' }]) {
    const stream = new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode('{"text":"'));
      controller.enqueue(new TextEncoder().encode('x'.repeat(2000)));
      controller.enqueue(new TextEncoder().encode('"}'));
      controller.close();
    } });
    await assert.rejects(assertBoundedJsonBody(request(stream, headers), 64), { status: 413 });
  }
});

test('JSON invalido, primitivo, UTF8 invalido e chaves perigosas sao rejeitados', async () => {
  for (const body of ['{', 'null', '5', '{"__proto__":{"polluted":true}}', Buffer.from([255, 254])]) {
    await assert.rejects(assertBoundedJsonBody(request(body), 1000), { status: 400 });
  }
  await assert.rejects(assertBoundedJsonBody(request('['.repeat(40) + '0' + ']'.repeat(40)), 1000), { status: 413 });
});

test('Envio lento e compactacao nao negociada nao chegam ao handler', async () => {
  const stream = new ReadableStream({ start() {} });
  await assert.rejects(assertBoundedJsonBody(request(stream), 1000, 20), { status: 408 });
  await assert.rejects(assertBoundedJsonBody(request('{}', { 'content-encoding': 'gzip' }), 1000), { status: 415 });
});

test('Guard bloqueia CSRF, preserva contexto da rota e retira erros internos', async () => {
  let calls = 0;
  const handler = withApiGuard(async (req, context) => {
    calls++;
    return Response.json({ ...(await req.json()), id: (await context.params).id });
  });
  const forbidden = await handler(request('{}', { origin: 'https://attacker.invalid' }), { params: Promise.resolve({ id: 'abc' }) });
  assert.equal(forbidden.status, 403);
  assert.equal(calls, 0);
  const success = await handler(request('{"ok":true}'), { params: Promise.resolve({ id: 'abc' }) });
  assert.deepEqual(await success.json(), { ok: true, id: 'abc' });
  assert.match(success.headers.get('x-request-id'), /^[0-9a-f-]{36}$/);
  assert.equal(success.headers.get('cache-control'), 'no-store, private');
  const legacy = withApiGuard(async () => Response.json({ error: 'SELECT secret FROM users; senha=TEST_ONLY' }, { status: 500 }));
  const failure = await legacy(request('{}'));
  assert.equal(failure.status, 500);
  assert.doesNotMatch(await failure.text(), /SELECT|senha|TEST_ONLY/);
});
