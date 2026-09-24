const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { parseOwnershipCreation, parseOwnershipDecision, parseOwnershipQuery } = require('../app/services/companyOwnershipInput.ts');

const valid = { requestId: randomUUID(), empresaId: 'emp_1', proposedOwnerId: 'user_2', caseTicketId: 'ticket_3',
  evidenceMessageId: 'message_4', password: 'senha atual', justification: 'Análise humana documentada', confirmedCnpj: '11222333000181', evidenceVerified: true };
test('titularidade: criação exige DTO estrito, CNPJ e prova revisada', () => {
  assert.equal(parseOwnershipCreation(valid).confirmedCnpj, '11222333000181');
  for (const change of [
    { evidenceVerified: false }, { confirmedCnpj: '11222333000180' }, { empresaId: '../x' },
    { requestId: 'retry' }, { password: 'x'.repeat(73) }, { justification: 'curta' }, { proprietarioUserId: 'x' },
  ]) assert.throws(() => parseOwnershipCreation({ ...valid, ...change }));
});
test('titularidade: decisões são explícitas e vinculadas ao hash/CNPJ', () => {
  const base = { action: 'ACCEPT', requestId: 'req_1', termsHash: 'a'.repeat(64), confirmedCnpj: valid.confirmedCnpj, password: 'senha', acknowledged: true };
  assert.equal(parseOwnershipDecision(base).action, 'ACCEPT');
  assert.throws(() => parseOwnershipDecision({ ...base, acknowledged: false }));
  assert.throws(() => parseOwnershipDecision({ ...base, termsHash: 'a'.repeat(63) }));
  assert.throws(() => parseOwnershipDecision({ ...base, action: 'FINALIZE', justification: 'Revisão final independente', evidenceVerified: false, reviewEvidenceMessageId: 'm1' }));
  assert.equal(parseOwnershipDecision({ ...base, action: 'FINALIZE', justification: 'Revisão final independente', evidenceVerified: true, reviewEvidenceMessageId: 'm1' }).action, 'FINALIZE');
});
test('titularidade: listagem é paginada e rejeita filtros extras', () => {
  assert.deepEqual(parseOwnershipQuery(new URLSearchParams()), { page: 1, status: 'PENDING', empresaId: undefined });
  assert.throws(() => parseOwnershipQuery(new URLSearchParams('page=0')));
  assert.throws(() => parseOwnershipQuery(new URLSearchParams('limit=100')));
});
