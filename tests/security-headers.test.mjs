import test from 'node:test';
import assert from 'node:assert/strict';
import config from '../next.config.mjs';

test('cabecalhos globais bloqueiam framing, objetos, origem cruzada e recursos sensiveis', async () => {
  const entries = await config.headers();
  const global = Object.fromEntries(entries.find(entry => entry.source === '/:path*').headers.map(item => [item.key, item.value]));
  assert.equal(global['X-Frame-Options'], 'DENY');
  assert.equal(global['X-Content-Type-Options'], 'nosniff');
  assert.equal(global['Cross-Origin-Opener-Policy'], 'same-origin');
  assert.match(global['Content-Security-Policy'], /object-src 'none'/);
  assert.match(global['Content-Security-Policy'], /frame-ancestors 'none'/);
  assert.match(global['Content-Security-Policy'], /form-action 'self'/);
});

test('paginas autenticadas nao podem ser armazenadas pelo navegador ou CDN', async () => {
  const entries = await config.headers();
  for (const route of ['/admin/:path*', '/cliente/:path*', '/configuracoes/:path*', '/seguranca/:path*', '/privacidade/:path*', '/emitir/:path*', '/relatorios/:path*', '/contador/:path*', '/aceite-legal/:path*']) {
    const item = entries.find(entry => entry.source === route);
    assert.ok(item, `cabecalho ausente em ${route}`);
    assert.match(item.headers[0].value, /private, no-store/);
  }
});
