const { test } = require('node:test');
const assert = require('node:assert/strict');
const { internalCustomerGrantActive, hasCustomerCompanyAccess, hasCustomerAccountCapability } = require('../app/utils/access-control.ts');

test('ADMIN e MASTER preservam acesso; perfis internos restritos comecam bloqueados', () => {
  for (const role of ['ADMIN', 'MASTER']) assert.equal(internalCustomerGrantActive({ role }), true);
  for (const role of ['SUPORTE', 'SUPORTE_TI', 'COMERCIAL']) {
    assert.equal(internalCustomerGrantActive({ role }), false);
    assert.equal(internalCustomerGrantActive({ role, customerPortalGrantedAt: new Date() }), true);
    assert.equal(internalCustomerGrantActive({ role, customerPortalGrantedAt: new Date(), customerPortalRevokedAt: new Date() }), false);
  }
  assert.equal(internalCustomerGrantActive({ role: 'COMUM', customerPortalGrantedAt: new Date() }), false);
});

test('concessao pessoal nao autoriza empresa de terceiros e revogacao bloqueia imediatamente', async () => {
  let companyQueries = 0;
  const db = {
    user: { findUnique: async () => ({ role: 'SUPORTE', customerPortalGrantedAt: new Date(), customerPortalRevokedAt: null }) },
    empresa: { findFirst: async ({ where }) => {
      companyQueries++;
      return where.id === 'own-company' && where.OR.some(item => item.proprietarioUserId === 'staff-user') ? { id: 'own-company' } : null;
    } },
  };
  const staff = { id: 'staff-user', role: 'SUPORTE', empresaId: null };
  assert.equal(await hasCustomerCompanyAccess(staff, 'own-company', db), true);
  assert.equal(await hasCustomerCompanyAccess(staff, 'other-company', db), false);
  assert.equal(await hasCustomerAccountCapability(staff, db), true);
  db.user.findUnique = async () => ({ role: 'SUPORTE', customerPortalGrantedAt: new Date(), customerPortalRevokedAt: new Date() });
  assert.equal(await hasCustomerCompanyAccess(staff, 'own-company', db), false);
  assert.equal(await hasCustomerAccountCapability(staff, db), false);
  assert.equal(companyQueries, 2);
});
