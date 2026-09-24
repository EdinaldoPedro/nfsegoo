const { test } = require('node:test');
const assert = require('node:assert/strict');
const { currentUsageCycle, contractIsActive } = require('../app/utils/billing-cycle.ts');
const { getEffectivePlanLimits, checkPlanLimits } = require('../app/services/planService.ts');

const contract = { status: 'ATIVO', dataInicio: new Date('2028-01-31T12:00:00Z'), dataFim: new Date('2029-01-31T12:00:00Z'),
  cicloInicio: new Date('2028-01-31T12:00:00Z'), tipoContratado: 'PLANO', arquivadoEm: null };

test('ciclo muda no aniversario UTC exato, preservando dia 31 e bissexto', () => {
  assert.equal(currentUsageCycle(contract, new Date('2028-02-29T11:59:59Z')).startsAt.toISOString(), '2028-01-31T12:00:00.000Z');
  assert.equal(currentUsageCycle(contract, new Date('2028-02-29T12:00:00Z')).startsAt.toISOString(), '2028-02-29T12:00:00.000Z');
  assert.equal(currentUsageCycle(contract, new Date('2028-03-31T12:00:00Z')).startsAt.toISOString(), '2028-03-31T12:00:00.000Z');
  assert.equal(currentUsageCycle(contract, new Date('2028-03-01T12:00:00Z')).endsAt.toISOString(), '2028-03-31T12:00:00.000Z');
});

test('inicio futuro, expiracao exata, suspensao e arquivo nao concedem cota', () => {
  for (const now of [new Date('2028-01-31T11:59:59Z'), contract.dataFim]) assert.equal(currentUsageCycle(contract, now), null);
  for (const changes of [{ status: 'CANCELADO_ADM' }, { arquivadoEm: new Date() }]) assert.equal(contractIsActive({ ...contract, ...changes }, new Date('2028-02-01')), false);
});

test('pacote avulso usa um unico saldo ao longo dos meses e limite de fim e respeitado', () => {
  const addon = { ...contract, tipoContratado: 'PACOTE_NOTAS', dataFim: null };
  assert.deepEqual(currentUsageCycle(addon, new Date('2035-07-15')), { startsAt: contract.cicloInicio, endsAt: null });
  const short = { ...contract, dataFim: new Date('2028-02-10T12:00:00Z') };
  assert.equal(currentUsageCycle(short, new Date('2028-02-01')).endsAt.toISOString(), short.dataFim.toISOString());
});

function fakeDb(histories, userChanges = {}) {
  return { user: { findUnique: async () => ({ id: 'user', role: 'COMUM', empresaId: 'company', limiteEmpresas: 1, empresasAdicionais: 0, planoStatus: 'active', ...userChanges }) },
    planHistory: { findMany: async () => histories }, vinculoCarteira: { count: async () => 0 }, empresa: { count: async () => 1 } };
}
function history(id, overrides = {}) {
  return { ...contract, id, planId: id, nomeContratado: 'Plano aceito', limiteNotasContratado: 5, limiteClientesContratado: 10,
    plan: { id, slug: id, diasTeste: 0, maxNotasMensal: 999 }, usageCycles: [], ...overrides };
}

test('consulta usa snapshot e ciclo corrente, nao preco/cota mutavel nem contador legado', async () => {
  const now = new Date('2028-03-31T12:00:00Z');
  const db = fakeDb([history('base', { notasEmitidas: 999, usageCycles: [{ startsAt: new Date('2028-02-29T12:00:00Z'), used: 5 }] })]);
  const limits = await getEffectivePlanLimits('user', db, now);
  assert.equal(limits.allowedBase, true); assert.equal(limits.limiteNotas, 5); assert.equal(limits.notasUsadas, 0);
  // The fake has no write methods: a GET attempting a reset would fail here.
});

test('plano futuro nao soma cota; apenas pacotes sem base nao habilitam operacao', async () => {
  const now = new Date('2028-03-31T12:00:00Z');
  const future = history('future', { dataInicio: new Date('2028-08-01T12:00:00Z'), cicloInicio: new Date('2028-08-01T12:00:00Z'), limiteNotasContratado: 999 });
  const addon = history('addon', { tipoContratado: 'PACOTE_NOTAS', dataFim: null, limiteNotasContratado: 20, limiteClientesContratado: 0,
    usageCycles: [{ startsAt: contract.cicloInicio, used: 3 }] });
  const limits = await getEffectivePlanLimits('user', fakeDb([future, history('base'), addon]), now);
  assert.equal(limits.limiteNotas, 25); assert.equal(limits.notasUsadas, 3);
  assert.equal((await getEffectivePlanLimits('user', fakeDb([addon]), now)).allowedBase, false);
});

test('ADMIN e MASTER têm benefício ilimitado; demais contas ainda exigem contrato e zero nunca significa infinito', async () => {
  const now = new Date();
  const active = history('base', { dataInicio: new Date(now.getTime() - 1000), cicloInicio: new Date(now.getTime() - 1000), dataFim: null, limiteNotasContratado: 0, limiteClientesContratado: 0 });
  for (const role of ['SUPORTE', 'SUPORTE_TI', 'COMERCIAL']) {
    assert.equal((await getEffectivePlanLimits('user', fakeDb([], { role }), now)).allowedBase, false);
    assert.equal((await getEffectivePlanLimits('user', fakeDb([active], { role }), now)).allowedBase, true);
  }
  for (const role of ['ADMIN', 'MASTER']) {
    const limits = await getEffectivePlanLimits('user', fakeDb([], { role }), now);
    assert.equal(limits.allowedBase, true); assert.equal(limits.unlimited, true); assert.equal(limits.origem, 'ADMIN');
    assert.equal((await checkPlanLimits('user', 'EMITIR', fakeDb([], { role }))).allowed, true);
    assert.equal((await checkPlanLimits('user', 'CADASTRAR_CLIENTE', fakeDb([], { role }))).allowed, true);
  }
  assert.equal((await checkPlanLimits('user', 'EMITIR', fakeDb([active]))).allowed, false);
  assert.equal((await checkPlanLimits('user', 'CADASTRAR_CLIENTE', fakeDb([active]))).allowed, false);
  assert.equal((await checkPlanLimits('user', 'VISUALIZAR', fakeDb([], { planoStatus: 'expired' }))).allowed, true);
});
