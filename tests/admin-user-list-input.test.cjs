const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseAdminUserQuery } = require('../app/services/adminUserListService.ts');

test('lista administrativa de contas exige paginação, papéis e busca limitados', () => {
  assert.deepEqual(parseAdminUserQuery(new URLSearchParams()), { page: 1, limit: 25, search: '', roles: ['COMUM', 'CONTADOR'], segment: 'ALL' });
  assert.deepEqual(parseAdminUserQuery(new URLSearchParams('page=2&limit=50&roles=ADMIN,CONTADOR&search=ana&segment=ACTIVE')), { page: 2, limit: 50, search: 'ana', roles: ['ADMIN', 'CONTADOR'], segment: 'ACTIVE' });
  for (const query of ['page=0', 'limit=51', 'roles=ROOT', 'roles=COMUM,COMUM', 'search=' + 'x'.repeat(121), 'status=active', 'segment=unknown'])
    assert.throws(() => parseAdminUserQuery(new URLSearchParams(query)));
});
