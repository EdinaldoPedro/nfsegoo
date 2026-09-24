'use strict';
// tsc preserves the repository's @/ aliases. Resolve them only within the
// compiled worker tree; never load TypeScript or the test harness in production.
const Module = require('node:module');
const path = require('node:path');
const root = path.resolve(__dirname, '../dist/worker');
const original = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (request.startsWith('@/')) {
    const resolved = path.resolve(root, request.slice(2));
    if (!resolved.startsWith(root + path.sep)) throw new Error('Invalid worker module path');
    request = resolved;
  }
  return original.call(this, request, parent, ...rest);
};
