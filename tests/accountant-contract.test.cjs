const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { parseAccountantBenefit } = require('../app/utils/accountant-contract.ts');
const { grantPlanInTransaction, validateManualGrant } = require('../app/services/manualPlanGrantService.ts');

test('contador exige concessao explicita e nunca aceita renovacao automatica', () => {
  for (const value of [true, false, 'false', 0]) assert.throws(() => parseAccountantBenefit({ action: 'GRANT', kind: 'DEFAULT', cycle: 'ANUAL', renovacaoAutomatica: value }));
  for (const action of [undefined, 'UPDATE', '', 'ATIVO']) assert.throws(() => parseAccountantBenefit({ action }));
});
test('contador starter tem prazo definido e limite congelado, sem usar limites enviados', () => {
  const result = parseAccountantBenefit({ action: 'GRANT', kind: 'DEFAULT', cycle: 'ANUAL', notes: 99999, customers: 99999 });
  assert.deepEqual(result, { action: 'GRANT', kind: 'DEFAULT', cycle: 'ANUAL', notes: 60, customers: 25 });
  for (const cycle of ['AUTO', '10_ANOS', undefined]) assert.throws(() => parseAccountantBenefit({ action: 'GRANT', kind: 'DEFAULT', cycle }));
});
test('contador custom rejeita coercoes, fracionados e limites excessivos; zero e valido', () => {
  const base = { action: 'GRANT', kind: 'CUSTOM', cycle: 'MENSAL', notes: 0, customers: 0 };
  assert.equal(parseAccountantBenefit(base).notes, 0);
  for (const value of [null, '', '60', -1, 0.5, Infinity, NaN, 1000001]) {
    assert.throws(() => parseAccountantBenefit({ ...base, notes: value }));
    assert.throws(() => parseAccountantBenefit({ ...base, customers: value }));
  }
});

function fixture() {
  const input = { actorId: 'admin', userId: 'contador', operationId: randomUUID(), planSlug: 'CUSTOM', cycle: 'MENSAL', justification: 'Concessao administrativa de teste' };
  const target = { id: 'contador', role: 'CONTADOR', planoStatus: 'active' };
  const actor = { id: 'admin', role: 'ADMIN' };
  const changes = []; const created = []; const audit = []; const events = [];
  const histories = [];
  const plan = { id: 'plan', slug: 'CUSTOM', tipo: 'CUSTOM', name: 'Contador de teste', active: true, diasTeste: 0, maxNotasMensal: 60, maxClientes: 25 };
  const tx = {
    user: { findUnique: async () => actor, findUniqueOrThrow: async () => target, update: async ({ data }) => { changes.push(data); Object.assign(target, data); return target; } },
    systemLog: { findUnique: async ({ where }) => audit.find((row) => row.id === where.id), create: async ({ data }) => { audit.push(data); return data; } },
    userEvent: { create: async ({ data }) => { events.push(data); return data; } },
    plan: { findUnique: async () => plan },
    planHistory: { findMany: async () => histories, create: async ({ data }) => { created.push(data); return data; },
      update: async () => { throw new Error('Teste detectou alteracao indevida em contrato vigente'); } },
  };
  return { tx, input, actor, target, histories, plan, changes, created, audit, events };
}
test('suspensao e reativacao preservam contrato, datas e consumo sem criar beneficio', async () => {
  const f = fixture();
  await grantPlanInTransaction(f.tx, { ...f.input, planSlug: 'SUSPENDED', cycle: 'DEFAULT' });
  assert.deepEqual(f.changes, [{ planoStatus: 'suspended' }]);
  await grantPlanInTransaction(f.tx, { ...f.input, operationId: randomUUID(), planSlug: 'REACTIVATE' });
  assert.deepEqual(f.changes[1], { planoStatus: 'active' });
  assert.equal(f.created.length, 0); assert.equal(f.events.length, 2);
});
test('concessao conserva periodo vigente e agenda depois dele, com snapshot e aniversario', async () => {
  const f = fixture();
  const end = new Date('2090-01-31T12:00:00Z');
  f.histories.push({ id: 'paid', dataInicio: new Date('2089-01-31T12:00:00Z'), dataFim: end, pedidoId: 'paid-order', plan: { diasTeste: 0 } });
  const result = await grantPlanInTransaction(f.tx, f.input);
  assert.equal(result.scheduledStart.toISOString(), end.toISOString());
  assert.equal(result.scheduledEnd.toISOString(), '2090-02-28T12:00:00.000Z');
  assert.equal(f.created[0].limiteNotasContratado, 60); assert.equal(f.created[0].limiteClientesContratado, 25);
  assert.deepEqual(f.created[0].cicloInicio, end);
  assert.deepEqual(f.changes[0], {});
});
test('retry de cortesia nao cria outro contrato, mesmo com nova justificativa de reautenticacao', async () => {
  const f = fixture();
  await grantPlanInTransaction(f.tx, f.input);
  const retry = await grantPlanInTransaction(f.tx, { ...f.input, justification: 'Nova justificativa para repetir a chamada' });
  assert.equal(retry.reused, true); assert.equal(f.created.length, 1); assert.equal(f.audit.length, 1);
  await assert.rejects(grantPlanInTransaction(f.tx, { ...f.input, cycle: 'ANUAL' }), (e) => e.status === 409);
});
test('concessao nao reativa implicitamente suspenso nem substitui contrato sem vencimento', async () => {
  const f = fixture(); f.target.planoStatus = 'suspended';
  await assert.rejects(grantPlanInTransaction(f.tx, f.input), (e) => e.status === 409);
  f.target.planoStatus = 'active'; f.histories.push({ id: 'legacy', dataFim: null, plan: { diasTeste: 0 } });
  await assert.rejects(grantPlanInTransaction(f.tx, f.input), (e) => e.status === 409);
  assert.equal(f.created.length, 0); assert.equal(f.changes.length, 0);
});
test('suporte e comercial nao concedem cortesia, nem ADMIN recebe beneficio operacional', async () => {
  const f = fixture();
  for (const role of ['SUPORTE', 'SUPORTE_TI', 'COMERCIAL', 'CONTADOR']) {
    f.actor.role = role;
    await assert.rejects(grantPlanInTransaction(f.tx, f.input), (e) => e.status === 403);
  }
  f.actor.role = 'ADMIN'; f.target.role = 'ADMIN';
  await assert.rejects(grantPlanInTransaction(f.tx, f.input), (e) => e.status === 403);
  assert.equal(f.audit.length, 0);
});
test('toda operacao de cortesia exige UUID v4 e justificativa valida', () => {
  const f = fixture();
  for (const operationId of [undefined, '', 'unsafe', '00000000-4000-1000-8000-000000000000']) assert.throws(() => validateManualGrant({ ...f.input, operationId }));
  for (const justification of ['', 'curta', null, 'x'.repeat(2001)]) assert.throws(() => validateManualGrant({ ...f.input, justification }));
});
