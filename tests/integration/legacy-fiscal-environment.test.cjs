const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, createHash } = require('node:crypto');

test('PostgreSQL: conciliação legada atualiza só ambiente e grava evidência atômica', { skip: process.env.ALLOW_TEST_DATABASE_WRITES !== 'true' }, async () => {
  require('./require-test-database.cjs')();
  const { prisma } = require('../../app/utils/prisma.ts');
  const { confirmLegacyFiscalEnvironments } = require('../../app/services/legacyFiscalEnvironmentService.ts');
  const { makeDps, makeNfse, key } = require('../fixtures/fiscal.cjs');
  const prefix = 'qa-legacy-environment-' + randomUUID();
  let admin, support, company, customer, note;
  try {
    admin = await prisma.user.create({ data: { nome: prefix, email: `${prefix}-admin@example.invalid`, senha: 'unused', role: 'ADMIN' } });
    support = await prisma.user.create({ data: { nome: prefix, email: `${prefix}-support@example.invalid`, senha: 'unused', role: 'SUPORTE' } });
    company = await prisma.empresa.create({ data: { documento: '11222333000181', razaoSocial: prefix, ambiente: 'HOMOLOGACAO' } });
    customer = await prisma.cliente.create({ data: { empresaId: company.id, documento: '12345678909', nome: prefix, tipo: 'PF' } });
    const xml = Buffer.from(makeNfse(makeDps())).toString('base64');
    note = await prisma.notaFiscal.create({ data: { empresaId: company.id, clienteId: customer.id, descricao: prefix,
      valor: '123.45', status: 'AUTORIZADA', ambiente: null, prestadorCnpj: company.documento, tomadorCnpj: customer.documento,
      numeroOficial: '123', chaveAcesso: key, xmlAutorizadoBase64: xml, xmlBase64: xml } });
    await assert.rejects(confirmLegacyFiscalEnvironments(support.id, [note.id], 'Conciliação fiscal de teste'), { status: 403 });
    assert.equal((await prisma.notaFiscal.findUniqueOrThrow({ where: { id: note.id } })).ambiente, null);
    const [result] = await confirmLegacyFiscalEnvironments(admin.id, [note.id], 'Conciliação fiscal de teste');
    assert.deepEqual({ status: result.status, ambiente: result.ambiente }, { status: 'CONFIRMADA', ambiente: 'PRODUCAO' });
    const after = await prisma.notaFiscal.findUniqueOrThrow({ where: { id: note.id } });
    assert.equal(after.ambiente, 'PRODUCAO'); assert.equal(after.status, note.status);
    assert.equal(after.valor.toFixed(2), note.valor.toFixed(2)); assert.equal(after.dataEmissao, note.dataEmissao);
    assert.equal(after.xmlAutorizadoBase64, note.xmlAutorizadoBase64); assert.equal(after.xmlBase64, note.xmlBase64);
    const logs = await prisma.systemLog.findMany({ where: { action: 'LEGACY_FISCAL_ENVIRONMENT_CONFIRMED', userId: admin.id, empresaId: company.id } });
    assert.equal(logs.length, 1);
    const evidence = JSON.parse(logs[0].details);
    assert.equal(evidence.notaId, note.id); assert.equal(evidence.environment, 'PRODUCAO');
    assert.equal(evidence.originalXmlSha256, createHash('sha256').update(Buffer.from(xml, 'base64')).digest('hex'));
    assert.equal((await confirmLegacyFiscalEnvironments(admin.id, [note.id], 'Repetição de teste'))[0].status, 'ALTERADA');
    assert.equal(await prisma.systemLog.count({ where: { action: 'LEGACY_FISCAL_ENVIRONMENT_CONFIRMED', userId: admin.id } }), 1);
  } finally {
    if (admin) await prisma.systemLog.deleteMany({ where: { userId: admin.id, action: 'LEGACY_FISCAL_ENVIRONMENT_CONFIRMED' } });
    if (note) await prisma.notaFiscal.delete({ where: { id: note.id } });
    if (customer) await prisma.cliente.delete({ where: { id: customer.id } });
    if (company) await prisma.empresa.delete({ where: { id: company.id } });
    if (support) await prisma.user.delete({ where: { id: support.id } });
    if (admin) await prisma.user.delete({ where: { id: admin.id } });
  }
});
