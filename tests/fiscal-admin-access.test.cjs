const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  canReadFiscalCatalog,
  canWriteFiscalCatalog,
} = require('../app/utils/fiscal-admin-access.ts');

test('somente MASTER e ADMIN consultam os catalogos fiscais administrativos', () => {
  for (const role of ['MASTER', 'ADMIN']) assert.equal(canReadFiscalCatalog(role), true);
  for (const role of ['CONTADOR', 'COMUM', 'SUPORTE', 'SUPORTE_TI', 'COMERCIAL', null, undefined]) {
    assert.equal(canReadFiscalCatalog(role), false);
  }
});

test('somente MASTER e ADMIN alteram os catalogos fiscais administrativos', () => {
  for (const role of ['MASTER', 'ADMIN']) assert.equal(canWriteFiscalCatalog(role), true);
  for (const role of ['CONTADOR', 'COMUM', 'SUPORTE', 'SUPORTE_TI', 'COMERCIAL', null, undefined]) {
    assert.equal(canWriteFiscalCatalog(role), false);
  }
});

test('rotas de catalogo fiscal aplicam a politica central em todos os metodos', () => {
  const root = path.resolve(__dirname, '..');
  const routes = [
    ['app/api/admin/cnaes/route.ts', ['GET', 'PUT']],
    ['app/api/admin/tributacao-municipal/route.ts', ['GET', 'POST', 'PUT', 'DELETE']],
  ];

  for (const [relativePath, methods] of routes) {
    const source = fs.readFileSync(path.join(root, relativePath), 'utf8');
    assert.match(source, /from ['"]@\/app\/utils\/fiscal-admin-access['"]/);
    assert.doesNotMatch(source, /['"]CONTADOR['"]/);

    for (const method of methods) {
      const start = source.indexOf(`export const ${method} =`);
      assert.ok(start >= 0, `${relativePath} nao exporta ${method}`);
      const nextExport = source.indexOf('export const ', start + 1);
      const handler = source.slice(start, nextExport < 0 ? source.length : nextExport);
      assert.match(handler, method === 'GET' ? /canReadFiscalCatalog\(/ : /canWriteFiscalCatalog\(/,
        `${relativePath} ${method} nao aplica a politica fiscal central`);
    }
  }
});
