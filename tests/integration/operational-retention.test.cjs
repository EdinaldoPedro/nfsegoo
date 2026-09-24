const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const bcrypt = require('bcryptjs');

test('PostgreSQL: retenção remove somente material operacional vencido', { skip: process.env.ALLOW_TEST_DATABASE_WRITES !== 'true' }, async () => {
  require('./require-test-database.cjs')();
  const { prisma } = require('../../app/utils/prisma.ts');
  const { cleanupOperationalData } = require('../../app/services/operationalRetentionService.ts');
  const marker = randomUUID();
  const now = new Date();
  const ago = days => new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  let user;
  try {
    user = await prisma.user.create({ data: { email: `qa-retention-${marker}@example.invalid`, nome: 'Retenção QA', senha: await bcrypt.hash('Retencao@123', 4) } });
    await prisma.rateLimitBucket.create({ data: { keyHash: marker, hits: 2, expiresAt: ago(1) } });
    await prisma.pendingRegistration.create({ data: { email: `pending-${marker}@example.invalid`, senhaHash: 'hash-qa', nome: 'Pendente QA',
      cpf: String(BigInt('0x' + marker.replace(/-/g, '').slice(0, 10)) % 100000000000n).padStart(11, '0'), verificationCodeHash: marker.replace(/-/g, '').padEnd(64, '0'),
      verificationExpires: ago(1), termsVersion: 'qa-terms', privacyVersion: 'qa-privacy', acceptedAt: ago(2) } });
    await prisma.passwordResetRequest.createMany({ data: [
      { userId: user.id, tokenHash: `${marker}-old-reset`, expiresAt: ago(31) },
      { userId: user.id, tokenHash: `${marker}-recent-reset`, expiresAt: ago(29) },
    ] });
    await prisma.authSession.createMany({ data: [
      { userId: user.id, sessionVersion: 0, expiresAt: ago(31) },
      { userId: user.id, sessionVersion: 0, expiresAt: ago(29) },
    ] });
    await prisma.mfaLoginChallenge.createMany({ data: [
      { userId: user.id, tokenHash: `${marker}-old-mfa`, expiresAt: ago(31) },
      { userId: user.id, tokenHash: `${marker}-recent-mfa`, expiresAt: ago(29) },
    ] });
    await prisma.mfaTrustedDevice.createMany({ data: [
      { userId: user.id, tokenHash: `${marker}-old-device`, method: 'EMAIL', expiresAt: ago(31) },
      { userId: user.id, tokenHash: `${marker}-recent-device`, method: 'TOTP', expiresAt: ago(29) },
    ] });
    await prisma.legalAcceptance.create({ data: { userId: user.id, termsVersion: 'qa-terms', privacyVersion: 'qa-privacy', acceptedAt: ago(60), source: 'QA' } });

    const result = await cleanupOperationalData(now);
    assert.equal(result.skipped, false);
    for (const key of ['rateLimits', 'pendingRegistrations', 'passwordResets', 'sessions', 'mfaChallenges', 'trustedDevices']) assert.ok(result[key] >= 1);
    assert.equal(await prisma.rateLimitBucket.count({ where: { keyHash: marker } }), 0);
    assert.equal(await prisma.pendingRegistration.count({ where: { email: `pending-${marker}@example.invalid` } }), 0);
    assert.equal(await prisma.passwordResetRequest.count({ where: { userId: user.id } }), 1);
    assert.equal(await prisma.authSession.count({ where: { userId: user.id } }), 1);
    assert.equal(await prisma.mfaLoginChallenge.count({ where: { userId: user.id } }), 1);
    assert.equal(await prisma.mfaTrustedDevice.count({ where: { userId: user.id } }), 1);
    assert.equal(await prisma.legalAcceptance.count({ where: { userId: user.id } }), 1);
    assert.equal(await prisma.systemLog.count({ where: { action: 'OPERATIONAL_RETENTION_CLEANUP' } }), 1);
  } finally {
    await prisma.systemLog.deleteMany({ where: { action: 'OPERATIONAL_RETENTION_CLEANUP' } });
    await prisma.rateLimitBucket.deleteMany({ where: { keyHash: marker } });
    await prisma.pendingRegistration.deleteMany({ where: { email: `pending-${marker}@example.invalid` } });
    if (user) await prisma.user.deleteMany({ where: { id: user.id } });
  }
});
