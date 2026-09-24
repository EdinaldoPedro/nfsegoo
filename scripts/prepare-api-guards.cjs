// Idempotent AST-based mechanical migration. Dry-run by default; --write applies it.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const methods = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);
const files = [];
function collect(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) collect(full);
    else if (entry.name === 'route.ts') files.push(full);
  }
}
collect(path.join(root, 'app/api'));
let patch = '*** Begin Patch\n';
const changed = [];
const limit = Number(process.argv[2] || 1000);
const write = process.argv.includes('--write');
for (const full of files) {
  if (changed.length >= limit) break;
  const original = fs.readFileSync(full, 'utf8').replace(/\r\n/g, '\n');
  if (original.includes('withApiGuard(')) continue;
  const source = ts.createSourceFile(full, original, ts.ScriptTarget.Latest, true);
  const edits = [];
  let count = 0;
  for (const statement of source.statements) {
    if (!ts.isFunctionDeclaration(statement) || !statement.name || !statement.body
      || !methods.has(statement.name.text) || !statement.modifiers?.some(mod => mod.kind === ts.SyntaxKind.ExportKeyword)) continue;
    if (!statement.modifiers?.some(mod => mod.kind === ts.SyntaxKind.AsyncKeyword)) throw new Error(`Non-async handler: ${full}`);
    const name = statement.name.text;
    let limit;
    function findLimit(node) {
      if (ts.isCallExpression(node) && node.expression.getText(source) === 'validateJsonContentLength' && node.arguments[1]) {
        const expression = node.arguments[1].getText(source);
        if (!/^[\d_\s*+]+$/.test(expression)) throw new Error(`Nonliteral body limit: ${full}`);
        limit = expression;
      }
      ts.forEachChild(node, findLimit);
    }
    findLimit(statement.body);
    edits.push({ start: statement.getStart(source), end: statement.name.end, text: `export const ${name} = withApiGuard(async function ${name}` });
    edits.push({ start: statement.end, end: statement.end, text: limit ? `, { maxBodyBytes: ${limit} });` : ');' });
    count++;
  }
  if (!count) continue;
  let updated = original;
  for (const edit of edits.sort((a, b) => b.start - a.start)) updated = updated.slice(0, edit.start) + edit.text + updated.slice(edit.end);
  const oldLines = original.split('\n');
  const newLines = updated.split('\n');
  if (oldLines.length !== newLines.length) throw new Error('Unexpected line count change');
  const relative = path.relative(root, full).replaceAll('\\', '/');
  const importLine = "import { withApiGuard } from '@/app/utils/api-route';";
  patch += `*** Update File: ${relative}\n`;
  const ranges = [{ start: 0, end: 0 }];
  for (let i = 0; i < oldLines.length; i++) {
    if (oldLines[i] === newLines[i]) continue;
    const start = Math.max(0, i - 3);
    const end = Math.min(oldLines.length - 1, i + 3);
    const last = ranges.at(-1);
    if (last && start <= last.end + 1) last.end = end;
    else ranges.push({ start, end });
  }
  for (const range of ranges) {
    patch += '@@\n';
    for (let i = range.start; i <= range.end; i++) {
      if (i === 0) patch += `+${importLine}\n`;
      if (oldLines[i] === newLines[i]) patch += ` ${oldLines[i]}\n`;
      else patch += `-${oldLines[i]}\n+${newLines[i]}\n`;
    }
  }
  const expected = `${importLine}\n${updated}`;
  if (write) {
    const resolved = fs.realpathSync(full);
    if (!resolved.startsWith(root + path.sep)) throw new Error('File is outside the workspace');
    fs.writeFileSync(full, expected, 'utf8');
  }
  changed.push({ path: relative, count, hash: crypto.createHash('sha256').update(expected.trimEnd()).digest('hex') });
}
patch += '*** End Patch';
process.stdout.write(JSON.stringify({ patch: write ? undefined : patch, changed }));
