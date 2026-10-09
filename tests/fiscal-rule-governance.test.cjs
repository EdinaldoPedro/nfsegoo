const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  assertFiscalRuleVersion,
  changedFiscalRuleFields,
  fiscalRuleSnapshot,
  parseFiscalRuleDate,
  parseFiscalRuleGovernance,
  validateNormativeSource,
} = require('../app/utils/fiscal-rule-governance.ts');

test('governanca fiscal exige justificativa de 15 caracteres e versao nas alteracoes', () => {
  assert.throws(() => parseFiscalRuleGovernance({}, true), /justificativa/i);
  assert.throws(() => parseFiscalRuleGovernance({ justification: 'Ajuste fiscal' }, true), /justificativa/i);
  assert.throws(() => parseFiscalRuleGovernance({ justification: 'Ajuste fiscal aprovado' }, true), /versão/i);
  const parsed = parseFiscalRuleGovernance({ justification: 'Ajuste fiscal aprovado', expectedUpdatedAt: '2026-09-24T12:00:00.000Z' }, true);
  assert.equal(parsed.justification, 'Ajuste fiscal aprovado');
  assert.equal(parsed.expectedUpdatedAt.toISOString(), '2026-09-24T12:00:00.000Z');
});

test('fonte normativa e obrigatoria para liberar uma regra fiscal', () => {
  assert.throws(() => validateNormativeSource(''), /fonte normativa/i);
  assert.throws(() => validateNormativeSource('x'), /fonte normativa/i);
  assert.equal(validateNormativeSource('Lei municipal 123/2026'), 'Lei municipal 123/2026');
});

test('datas fiscais aceitam dia ou timestamp do banco sem concatenar outro horario', () => {
  assert.equal(parseFiscalRuleDate('2026-10-09', 'Início').toISOString(), '2026-10-09T00:00:00.000Z');
  assert.equal(parseFiscalRuleDate('2026-10-09T00:00:00.000Z', 'Início').toISOString(), '2026-10-09T00:00:00.000Z');
  assert.equal(parseFiscalRuleDate('2026-10-09T23:59:59.999Z', 'Fim', true).toISOString(), '2026-10-09T23:59:59.999Z');
  assert.equal(parseFiscalRuleDate('', 'Início'), null);
  assert.throws(() => parseFiscalRuleDate('2026-02-30', 'Início'), /inválido/i);
});

test('snapshot fiscal preserva valores anteriores e lista somente campos alterados', () => {
  const before = { id: 'r1', cnae: '6201501', ativo: true, aliquotaIss: '2.00', updatedAt: new Date('2026-09-24T10:00:00Z') };
  const after = { ...before, ativo: false, aliquotaIss: '3.00', updatedAt: new Date('2026-09-24T11:00:00Z') };
  const snapshot = fiscalRuleSnapshot(before);
  after.aliquotaIss = '4.00';
  assert.equal(snapshot.aliquotaIss, '2.00');
  assert.deepEqual(changedFiscalRuleFields(snapshot, fiscalRuleSnapshot(after)), ['ativo', 'aliquotaIss']);
});

test('controle otimista rejeita tela fiscal desatualizada', () => {
  const actual = new Date('2026-09-24T12:00:00.000Z');
  assert.doesNotThrow(() => assertFiscalRuleVersion(actual, new Date(actual)));
  assert.throws(() => assertFiscalRuleVersion(actual, new Date('2026-09-24T11:59:59.000Z')), error => error.status === 409);
});

test('rotas fiscais registram antes/depois e suspensao municipal nao apaga historico', () => {
  const root = path.resolve(__dirname, '..');
  const globalRoute = fs.readFileSync(path.join(root, 'app/api/admin/cnaes/route.ts'), 'utf8');
  const municipalRoute = fs.readFileSync(path.join(root, 'app/api/admin/tributacao-municipal/route.ts'), 'utf8');
  const globalPage = fs.readFileSync(path.join(root, 'app/admin/cnaes/page.tsx'), 'utf8');
  const municipalPage = fs.readFileSync(path.join(root, 'app/admin/tributacao-municipal/page.tsx'), 'utf8');
  for (const source of [globalRoute, municipalRoute]) {
    assert.doesNotMatch(source, /requireAdminReauthentication\(/);
    assert.match(source, /changedFiscalRuleFields\(before, after\)/);
    assert.match(source, /before, after/);
    assert.match(source, /justification: governance\.justification/);
  }
  for (const source of [globalPage, municipalPage]) {
    assert.doesNotMatch(source, /adminPassword|senha administrativa/i);
    assert.match(source, /mínimo 15 caracteres/);
    assert.match(source, /dialog\.showConfirm\(/);
  }
  assert.doesNotMatch(municipalRoute, /tributacaoMunicipal\.delete\(/);
  assert.match(municipalRoute, /MUNICIPAL_RULE_SUSPENDED/);
  assert.match(municipalRoute, /data: \{ ativo: false \}/);
});
