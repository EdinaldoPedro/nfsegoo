const { test } = require('node:test');
const assert = require('node:assert/strict');
const { restartDelayMs } = require('../scripts/supervise-consultations.cjs');

test('supervisor de consultas usa backoff limitado sem iniciar processo ao importar', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 20].map(restartDelayMs),
    [1000, 2000, 4000, 8000, 16000, 30000, 30000]);
});
