const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

function syntheticCpf(seed) {
  const base = seed.replace(/[^0-9a-f]/gi, '').slice(0, 9).split('').map(character => parseInt(character, 16) % 10);
  while (base.length < 9) base.push((base.length * 3 + 1) % 10);
  if (base.every(digit => digit === base[0])) base[8] = (base[8] + 1) % 10;
  const digit = length => {
    const sum = base.slice(0, length).reduce((total, value, index) => total + value * (length + 1 - index), 0);
    const result = 11 - (sum % 11);
    return result >= 10 ? 0 : result;
  };
  base.push(digit(9)); base.push(digit(10));
  return base.join('');
}

test('PostgreSQL: cadastro exige aceite versionado e código armazenado como hash', { skip: process.env.ALLOW_TEST_DATABASE_WRITES !== 'true' }, async (t) => {
  require('./require-test-database.cjs')();
  const { prisma } = require('../../app/utils/prisma.ts');
  const { privacyVersion, termsVersion } = require('../../app/legal-content.ts');
  const { confirmRegistration, discardStagedRegistration, parseRegistrationInput, stageRegistration } = require('../../app/services/registrationService.ts');
  const prefix = `qa-signup-${randomUUID()}`;
  const email = `${prefix}@example.invalid`, cpf = syntheticCpf(prefix);
  let userId;
  try {
    const input = parseRegistrationInput({ nome: 'Li QA', email, cpf, senha: 'Cadastro@Senha1',
      legalAcceptance: { accepted: true, termsVersion, privacyVersion } });

    let latest;
    await t.test('reenvio mantém somente o código mais recente e limpeza antiga não o apaga', async () => {
      const first = await stageRegistration(input);
      latest = await stageRegistration(input);
      assert.equal(await discardStagedRegistration(first.pendingId, first.codeHash), false);
      const stored = await prisma.pendingRegistration.findUniqueOrThrow({ where: { email } });
      assert.equal(stored.id, latest.pendingId);
      assert.equal(stored.verificationCodeHash, latest.codeHash);
      assert.notEqual(stored.verificationCodeHash, latest.code);
      assert.match(stored.verificationCodeHash, /^[a-f0-9]{64}$/);
      assert.equal(stored.termsVersion, termsVersion);
      assert.equal(stored.privacyVersion, privacyVersion);
    });

    await t.test('código incorreto não cria conta nem consome pendência', async () => {
      await assert.rejects(confirmRegistration(email, '000000'), /inválido|expirado/);
      assert.equal(await prisma.user.count({ where: { email } }), 0);
      assert.equal(await prisma.pendingRegistration.count({ where: { email } }), 1);
    });

    await t.test('confirmação concorrente cria uma conta, trial congelado, aceite e auditoria', async () => {
      const results = await Promise.allSettled([confirmRegistration(email, latest.code), confirmRegistration(email, latest.code)]);
      assert.equal(results.filter(result => result.status === 'fulfilled').length, 1,
        results.map(result => result.status === 'rejected' ? `${result.reason?.name}:${result.reason?.message}` : 'fulfilled').join(' | '));
      const created = results.find(result => result.status === 'fulfilled').value;
      userId = created.id;
      const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
      assert.equal(user.role, 'COMUM');
      assert.equal(user.plano, 'TRIAL');
      assert.equal(user.planoStatus, 'trialing');
      assert.ok(user.planoExpiresAt > new Date());
      const history = await prisma.planHistory.findFirstOrThrow({ where: { userId }, include: { plan: true } });
      assert.equal(history.limiteNotasContratado, history.plan.maxNotasMensal);
      assert.equal(history.limiteClientesContratado, history.plan.maxClientes);
      assert.equal(history.nomeContratado, history.plan.name);
      const acceptance = await prisma.legalAcceptance.findFirstOrThrow({ where: { userId } });
      assert.equal(acceptance.termsVersion, termsVersion);
      assert.equal(acceptance.privacyVersion, privacyVersion);
      assert.equal(acceptance.source, 'SIGNUP_EMAIL_CONFIRMED');
      assert.equal(await prisma.userEvent.count({ where: { userId, titulo: 'Conta criada' } }), 1);
      const log = await prisma.systemLog.findFirstOrThrow({ where: { userId, action: 'ACCOUNT_CREATED' } });
      assert.doesNotMatch(log.details || '', new RegExp(`${cpf}|${latest.code}|Cadastro@`, 'i'));
      assert.equal(await prisma.pendingRegistration.count({ where: { email } }), 0);
    });
  } finally {
    await prisma.pendingRegistration.deleteMany({ where: { OR: [{ email }, { cpf }] } });
    if (userId) {
      await prisma.systemLog.deleteMany({ where: { userId } });
      await prisma.userEvent.deleteMany({ where: { userId } });
      await prisma.planUsageCycle.deleteMany({ where: { history: { userId } } });
      await prisma.planHistory.deleteMany({ where: { userId } });
      await prisma.legalAcceptance.deleteMany({ where: { userId } });
      await prisma.user.delete({ where: { id: userId } });
    }
  }
});
