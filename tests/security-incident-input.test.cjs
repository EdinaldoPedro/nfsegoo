const { test } = require('node:test');
const assert = require('node:assert/strict');
const { addBusinessDays, parseSecurityIncidentCreate, parseSecurityIncidentUpdate } = require('../app/services/securityIncidentService.ts');

test('incidente: prazo preliminar soma tres dias uteis e atravessa fim de semana', () => {
  assert.equal(addBusinessDays(new Date('2026-09-04T15:00:00Z'), 3).toISOString(), '2026-09-09T15:00:00.000Z');
});

test('incidente: criacao rejeita futuro, campos extras e estimativa fracionaria', () => {
  const valid = { title: 'Exposição sob investigação', category: 'EXPOSICAO', severity: 'ALTA',
    summary: 'Evento sintético usado apenas para validar a entrada administrativa.', detectedAt: '2026-09-01T12:00:00Z' };
  assert.equal(parseSecurityIncidentCreate(valid).category, 'EXPOSICAO');
  assert.throws(() => parseSecurityIncidentCreate({ ...valid, detectedAt: '2099-01-01T00:00:00Z' }), /futuro/);
  assert.throws(() => parseSecurityIncidentCreate({ ...valid, segredo: 'x' }), /não permitidos/);
  assert.throws(() => parseSecurityIncidentCreate({ ...valid, affectedSubjectsEstimate: 1.5 }), /Estimativa/);
});

test('incidente: atualizacao exige versao, risco conhecido e evidencias para encerrar', () => {
  const parsed = parseSecurityIncidentUpdate({ id: 'a-b', version: 1, status: 'EM_AVALIACAO', severity: 'MEDIA',
    riskToSubjects: 'DESCONHECIDO' });
  assert.equal(parsed.version, 1);
  assert.throws(() => parseSecurityIncidentUpdate({ id: 'a-b', version: 0, status: 'EM_AVALIACAO', severity: 'MEDIA', riskToSubjects: 'DESCONHECIDO' }), /Versão/);
});
