const fs = require('node:fs');
const ts = require('typescript');
const path = require('node:path');
const Module = require('node:module');

const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function resolveWorkspaceAlias(request, parent, isMain, options) {
  const resolved = request.startsWith('@/') ? path.join(__dirname, '..', request.slice(2)) : request;
  return originalResolveFilename.call(this, resolved, parent, isMain, options);
};

require.extensions['.ts'] = function compileTypeScript(module, filename) {
  const source = fs.readFileSync(filename, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.Node16,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
      moduleResolution: ts.ModuleResolutionKind.Node16,
    },
    fileName: filename,
  });
  module._compile(output.outputText, filename);
};
