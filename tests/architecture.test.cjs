const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
function files(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(directory, entry.name);
    return entry.isDirectory() ? files(full) : entry.isFile() && full.endsWith('.ts') ? [full] : [];
  });
}

test('Todos os handlers HTTP exportados usam a protecao transversal', () => {
  const methods = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);
  let count = 0;
  for (const file of files(path.join(root, 'app/api')).filter(file => file.endsWith('route.ts'))) {
    const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    for (const statement of source.statements) {
      if (!statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue;
      if (ts.isFunctionDeclaration(statement) && methods.has(statement.name?.text)) assert.fail(`Unprotected handler: ${file}`);
      if (!ts.isVariableStatement(statement)) continue;
      for (const declaration of statement.declarationList.declarations) {
        if (!methods.has(declaration.name.getText(source))) continue;
        count++;
        assert.ok(declaration.initializer && ts.isCallExpression(declaration.initializer)
          && declaration.initializer.expression.getText(source) === 'withApiGuard', `Unprotected handler: ${file}`);
      }
    }
  }
  assert.ok(count >= 131, 'Rotas esperadas nao foram verificadas');
});

test('Aplicacao instancia somente um PrismaClient por processo', () => {
  const instances = files(path.join(root, 'app')).filter(file => /new PrismaClient\s*\(/.test(fs.readFileSync(file, 'utf8')));
  assert.deepEqual(instances.map(file => path.relative(root, file).replaceAll('\\', '/')), ['app/utils/prisma.ts']);
});

test('emissao HTTP nao dispara worker, advisory locks de sessao ou retries em memoria', () => {
  const service = fs.readFileSync(path.join(root, 'app/services/emissaoJobService.ts'), 'utf8');
  assert.ok(!/setTimeout|pg_try_advisory_lock|pg_advisory_unlock|processarEmissaoJob/.test(service));
  for (const file of files(path.join(root, 'app/api'))) {
    const text = fs.readFileSync(file, 'utf8');
    assert.ok(!/processClaimedEmission|claimEmission\(|dispararProcessamentoEmissaoJob|processFiscalNoteOperation|claimFiscalNoteOperation|transmitirCancelamento|generateDanfsePdf/.test(text), file);
  }
});
