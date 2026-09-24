// Supplemental admin UI fixture. Run after qa-report-ui.cjs seed; clean this
// supplement before cleaning that fixture. Never targets the original database.
require('./register-typescript-tests.cjs');
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const { randomBytes } = require('node:crypto');
const { encrypt } = require('../app/utils/crypto.ts');
const { createTotpSecret, createRecoveryCodes } = require('../app/utils/totp.ts');
const email = 'qa-admin-ui@example.invalid';
const ownerEmail = 'qa-report-ui@example.invalid';
const slug = 'qa-admin-ui-synthetic-contract';
const companyDocument = '88777666000100';
const companyName = 'QA ADMIN - EMPRESA VAZIA - SEM VALOR FISCAL';

async function main() {
  const [mode, database] = process.argv.slice(2);
  const url = new URL(process.env.DATABASE_URL || '');
  if (!['seed', 'clean'].includes(mode) || !/^nfsegoo_qa_[0-9]{8}_[a-f0-9]{12}$/.test(database || '') ||
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || decodeURIComponent(url.pathname.slice(1)) === database) throw new Error('Alvo de QA inválido.');
  url.pathname = '/' + database;
  const prisma = new PrismaClient({ datasources: { db: { url: url.toString() } }, log: [] });
  try {
    const owner = await prisma.user.findUnique({ where: { email: ownerEmail } });
    const admin = await prisma.user.findUnique({ where: { email } });
    const company = await prisma.empresa.findUnique({ where: { documento: companyDocument } });
    const plan = await prisma.plan.findUnique({ where: { slug } });
    if (mode === 'clean') {
      if (!admin && !company && !plan) { console.log('Suplemento administrativo já ausente.'); return; }
      if (!owner || !admin || !company || !plan || company.proprietarioUserId !== owner.id || company.razaoSocial !== companyName || admin.role !== 'ADMIN') throw new Error('Fixture não confere; limpeza recusada.');
      const history = await prisma.planHistory.findMany({ where: { planId: plan.id }, select: { userId: true } });
      if (history.some(row => row.userId !== owner.id)) throw new Error('Contrato não pertence apenas à fixture.');
      await prisma.$transaction(async tx => {
        await tx.systemLog.deleteMany({ where: { OR: [{ userId: admin.id }, { empresaId: company.id }] } });
        await tx.empresa.delete({ where: { id: company.id } });
        await tx.user.delete({ where: { id: admin.id } });
        await tx.planHistory.deleteMany({ where: { userId: owner.id, planId: plan.id } });
        await tx.plan.delete({ where: { id: plan.id } });
      });
      console.log('Administrador, empresa vazia e contrato sintéticos removidos apenas do QA.'); return;
    }
    if (!owner || owner.role !== 'COMUM' || admin || company || plan || await prisma.user.count() !== 1) throw new Error('Use apenas o banco contendo a fixture qa-report-ui, sem sobrescrever contas.');
    const password = randomBytes(18).toString('base64url');
    const recovery = createRecoveryCodes(); const secret = createTotpSecret();
    const encryptedSecret = encrypt(secret);
    if (!encryptedSecret) throw new Error('Criptografia de QA indisponível.');
    const hash = await bcrypt.hash(password, 12);
    await prisma.$transaction(async tx => {
      await tx.user.create({ data: { email, nome: 'QA Administrador', role: 'ADMIN', senha: hash,
        mfaEnabledAt: new Date(), mfaSecret: encryptedSecret, mfaRecoveryCodes: JSON.stringify(recovery.hashes) } });
      await tx.user.update({ where: { id: owner.id }, data: { limiteEmpresas: 5 } });
      await tx.empresa.create({ data: { documento: companyDocument, razaoSocial: companyName,
        proprietarioUserId: owner.id, donoFaturamentoId: owner.id, ambiente: 'HOMOLOGACAO' } });
      const product = await tx.plan.create({ data: { slug, name: 'QA - CONTRATO SINTETICO', tipo: 'PLANO', features: '[]', priceMonthly: 1, priceYearly: 12, maxClientes: 100, maxNotasMensal: 20 } });
      await tx.planHistory.create({ data: { userId: owner.id, planId: product.id, dataInicio: new Date(Date.now() - 86400000), cicloInicio: new Date(Date.now() - 86400000),
        dataFim: new Date(Date.now() + 7 * 86400000), tipoContratado: 'PLANO', nomeContratado: product.name, limiteClientesContratado: 100, limiteNotasContratado: 20 } });
    });
    console.log(JSON.stringify({ database, login: email, password, recoveryCodes: recovery.codes, fixture: 'synthetic-only' }));
  } finally { await prisma.$disconnect(); }
}
main().catch(error => { console.error(error.code || error.message); process.exitCode = 1; });
