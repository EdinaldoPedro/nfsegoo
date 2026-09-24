const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

// Explicit opt-in prevents accidental fixture writes to a production database.
const enabled = process.env.ALLOW_TEST_DATABASE_WRITES === 'true';
test('integracao de seguranca PostgreSQL (fixtures isoladas e removidas)', { skip: !enabled }, async (t) => {
  require('./require-test-database.cjs')();
  const { prisma } = require('../../app/utils/prisma.ts');
  const { signJWT } = require('../../app/utils/auth.ts');
  const { findActiveAuthSession } = require('../../app/utils/auth-session.ts');
  const { checkRateLimit, clearRateLimit, refundRateLimit } = require('../../app/utils/rate-limit.ts');
  const { privateHash } = require('../../app/utils/private-hash.ts');
  const { createTotpSecret, totpAtStep, createRecoveryCodes } = require('../../app/utils/totp.ts');
  const { consumeMfaCode } = require('../../app/services/mfaService.ts');
  const { createMfaLoginChallenge, stageMfaEmailCode, consumeMfaLoginChallenge } = require('../../app/services/mfaLoginService.ts');
  const { encrypt } = require('../../app/utils/crypto.ts');
  const { getAccessibleEmpresaIds, hasCustomerCompanyAccess, hasEmpresaAccess } = require('../../app/utils/access-control.ts');

  const prefix = `qa-security-${randomUUID()}`;
  const userIds = [];
  const companyIds = [];
  const customerIds = [];
  const rateKeys = [];
  try {
    const user = await prisma.user.create({ data: { nome: 'Fixture de seguranca', email: `${prefix}@example.invalid`, senha: 'not-used-by-tests', role: 'COMUM' } });
    userIds.push(user.id);

    await t.test('sessao valida e rejeicao imediata por revogacao/versao', async () => {
      const session = await prisma.authSession.create({ data: { userId: user.id, sessionVersion: 0, expiresAt: new Date(Date.now() + 60_000) } });
      const token = await signJWT({ sub: user.id, role: user.role, sv: 0, sessionId: session.id });
      assert.equal((await findActiveAuthSession(token))?.user.id, user.id);
      await prisma.authSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
      assert.equal(await findActiveAuthSession(token), null);
      await prisma.authSession.update({ where: { id: session.id }, data: { revokedAt: null } });
      await prisma.user.update({ where: { id: user.id }, data: { sessionVersion: { increment: 1 } } });
      assert.equal(await findActiveAuthSession(token), null);
    });

    await t.test('limite atomico permite exatamente cinco de vinte tentativas simultaneas', async () => {
      const key = `${prefix}-rate`;
      rateKeys.push(privateHash('rate-limit', key));
      const results = await Promise.all(Array.from({ length: 20 }, () => checkRateLimit(key, 5, 60_000)));
      assert.equal(results.filter(Boolean).length, 5);
      await prisma.rateLimitBucket.update({ where: { keyHash: rateKeys[0] }, data: { expiresAt: new Date(Date.now() - 1000) } });
      assert.equal(await checkRateLimit(key, 5, 60_000), true);
    });

    await t.test('sucesso devolve somente sua tentativa e pode limpar o contador da identidade', async () => {
      const key = `${prefix}-rate-refund`;
      const keyHash = privateHash('rate-limit', key);
      rateKeys.push(keyHash);
      await checkRateLimit(key, 5, 60_000);
      await checkRateLimit(key, 5, 60_000);
      await checkRateLimit(key, 5, 60_000);
      await refundRateLimit(key);
      assert.equal((await prisma.rateLimitBucket.findUnique({ where: { keyHash } }))?.hits, 2);
      await clearRateLimit(key);
      assert.equal(await prisma.rateLimitBucket.findUnique({ where: { keyHash } }), null);
    });

    await t.test('TOTP e recovery code sao consumidos uma unica vez sob concorrencia', async () => {
      const secret = createTotpSecret();
      const recovery = createRecoveryCodes();
      await prisma.user.update({ where: { id: user.id }, data: { mfaSecret: encrypt(secret), mfaEnabledAt: new Date(), mfaLastUsedStep: -1, mfaRecoveryCodes: JSON.stringify(recovery.hashes) } });
      const code = totpAtStep(secret, Math.floor(Date.now() / 30_000));
      const results = await Promise.all(Array.from({ length: 5 }, () => consumeMfaCode(user.id, code)));
      assert.equal(results.filter(Boolean).length, 1);
      const recoveryResults = await Promise.all(Array.from({ length: 5 }, () => consumeMfaCode(user.id, recovery.codes[0])));
      assert.equal(recoveryResults.filter(Boolean).length, 1);
    });

    await t.test('desafio e codigo MFA por email sao curtos e consumidos uma unica vez', async () => {
      const challenge = await createMfaLoginChallenge(user.id);
      const staged = await stageMfaEmailCode(challenge.token);
      assert.ok(staged);
      const results = await Promise.all(Array.from({ length: 5 }, () => consumeMfaLoginChallenge(challenge.token, 'EMAIL', staged.code)));
      assert.equal(results.filter(Boolean).length, 1);
      assert.equal(await consumeMfaLoginChallenge(challenge.token, 'EMAIL', staged.code), null);
    });

    await t.test('suporte nao tem acesso universal; empresa arquivada nao concede acesso', async () => {
      const company = await prisma.empresa.create({ data: { documento: prefix, razaoSocial: 'Fixture de empresa', proprietarioUserId: user.id } });
      companyIds.push(company.id);
      const support = await prisma.user.create({ data: { nome: 'Fixture suporte', email: `support-${prefix}@example.invalid`, senha: 'not-used-by-tests', role: 'SUPORTE' } });
      userIds.push(support.id);
      assert.deepEqual(await getAccessibleEmpresaIds(support), []);
      assert.equal(await hasCustomerCompanyAccess(support, company.id), false);
      const adminOwner = await prisma.user.create({ data: { nome: 'Fixture admin cliente', email: `admin-${prefix}@example.invalid`, senha: 'not-used-by-tests', role: 'ADMIN' } });
      userIds.push(adminOwner.id);
      await prisma.empresa.update({ where: { id: company.id }, data: { proprietarioUserId: adminOwner.id } });
      assert.deepEqual(await getAccessibleEmpresaIds(adminOwner), [company.id]);
      assert.equal(await hasEmpresaAccess(adminOwner, company.id), true);
      assert.equal(await hasCustomerCompanyAccess(adminOwner, company.id), true);
      await prisma.empresa.update({ where: { id: company.id }, data: { arquivadoEm: new Date() } });
      assert.equal(await hasEmpresaAccess(adminOwner, company.id), false);
      assert.equal(await hasCustomerCompanyAccess(adminOwner, company.id), false);
    });

    await t.test('cadastros de documento igual sao isolados e o banco rejeita vinculo cruzado', async () => {
      const { findTenantCustomer } = require('../../app/services/tenantCustomerService.ts');
      const companies = [];
      for (const suffix of ['A', 'B']) {
        const company = await prisma.empresa.create({ data: { documento: `${prefix}-${suffix}`, razaoSocial: `Fixture ${suffix}`, proprietarioUserId: user.id } });
        companyIds.push(company.id); companies.push(company);
      }
      const customers = [];
      for (const company of companies) {
        const customer = await prisma.cliente.create({ data: { empresaId: company.id, documento: '12345678900', nome: 'Nome original', vinculos: { create: {} } } });
        customerIds.push(customer.id); customers.push(customer);
      }
      await prisma.cliente.update({ where: { id: customers[0].id }, data: { nome: 'Somente empresa A' } });
      assert.equal((await prisma.cliente.findUnique({ where: { id: customers[1].id } })).nome, 'Nome original');
      assert.equal(await findTenantCustomer(customers[0].id, companies[1].id), null);
      await assert.rejects(prisma.venda.create({ data: { empresaId: companies[1].id, clienteId: customers[0].id, valor: 1, descricao: 'Operacao cruzada deve falhar' } }), (error) => error.code === 'P2003');
      const legacyId = randomUUID();
      await prisma.clienteTenantMigration.create({ data: { originalClienteId: legacyId, empresaId: companies[1].id, clienteId: customers[1].id } });
      assert.equal((await findTenantCustomer(legacyId, companies[1].id))?.id, customers[1].id);
      assert.equal(await findTenantCustomer(legacyId, companies[0].id), null);
    });
  } finally {
    if (customerIds.length) {
      await prisma.clienteTenantMigration.deleteMany({ where: { clienteId: { in: customerIds } } });
      await prisma.cliente.deleteMany({ where: { id: { in: customerIds } } });
    }
    if (companyIds.length) await prisma.empresa.deleteMany({ where: { id: { in: companyIds } } });
    if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    if (rateKeys.length) await prisma.rateLimitBucket.deleteMany({ where: { keyHash: { in: rateKeys } } });
    await prisma.$disconnect();
  }
});
