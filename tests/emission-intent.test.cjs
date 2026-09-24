const { test } = require('node:test');
const assert = require('node:assert/strict');
const { emissionIntentSlot, getEmissionIntent, readEmissionIntent, clearEmissionIntent } = require('../app/utils/emission-intent.ts');
function storage() { const map = new Map(); return { getItem: (k) => map.get(k), setItem: (k, v) => map.set(k, v), removeItem: (k) => map.delete(k) }; }
test('intencao: recarregar ou reenviar os mesmos dados reutiliza a chave sem armazenar dados fiscais', async () => {
  const s = storage(); const slot = emissionIntentSlot('user', 'company');
  const payload = '{"descricao":"servico privado","valor":"10.00"}';
  const first = await getEmissionIntent(s, slot, payload);
  const second = await getEmissionIntent(s, slot, payload);
  assert.deepEqual(second, first);
  assert.ok(!s.getItem(slot).includes('privado'));
  assert.deepEqual(readEmissionIntent(s, slot), first);
});
test('intencao: dados diferentes exigem conferir resultado anterior; outra empresa tem chave propria', async () => {
  const s = storage(); const slot = emissionIntentSlot('user', 'a');
  const first = await getEmissionIntent(s, slot, '{"valor":10}');
  await assert.rejects(getEmissionIntent(s, slot, '{"valor":20}'), /anterior/);
  const other = await getEmissionIntent(s, emissionIntentSlot('user', 'b'), '{"valor":10}');
  assert.notEqual(other.key, first.key);
  clearEmissionIntent(s, slot, other.key);
  assert.ok(readEmissionIntent(s, slot));
  clearEmissionIntent(s, slot, first.key);
  assert.equal(readEmissionIntent(s, slot), null);
});
test('intencao: armazenamento inconsistente ou indisponivel nao gera chave descartavel silenciosamente', async () => {
  const s = storage(); s.setItem('x', '{"key":"broken"}');
  assert.throws(() => readEmissionIntent(s, 'x'));
  await assert.rejects(getEmissionIntent({ ...s, setItem() { throw new Error('storage unavailable'); } }, 'new', '{}'));
});
