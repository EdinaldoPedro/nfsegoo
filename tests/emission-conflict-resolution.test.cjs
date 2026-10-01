const { test } = require('node:test');
const assert = require('node:assert/strict');
const { hasE0014Evidence } = require('../app/services/emissionConflictResolutionService.ts');

test('conflito DPS: aceita somente evidencia estruturada do E0014', () => {
  assert.equal(hasE0014Evidence({ portalErrors: [{ codigo: 'E0014', mensagem: 'DPS já existe' }] }), true);
  assert.equal(hasE0014Evidence(JSON.stringify({ previousError: { details: [{ Codigo: 'E0014' }] } })), true);
  assert.equal(hasE0014Evidence({ portalErrors: [{ codigo: 'E0015' }] }), false);
  assert.equal(hasE0014Evidence('texto livre mencionando E0014'), false);
});
