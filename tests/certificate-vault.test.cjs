const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const forge = require('node-forge');
process.env.ENCRYPTION_KEY = '12345678901234567890123456789012';
const { prisma } = require('../app/utils/prisma.ts');
const logger = require('../app/services/logger.ts');
const { openEmpresaCertificate } = require('../app/services/certificateVault.ts');
const { signingCredentials } = require('./fixtures/fiscal.cjs');

test('cofre: recriptografia tardia usa CAS e nao sobrescreve certificado trocado pelo titular', async () => {
  const credentials = signingCredentials();
  const password = 'synthetic-vault-password';
  const pfx = forge.pkcs12.toPkcs12Asn1(forge.pki.privateKeyFromPem(credentials.key), [forge.pki.certificateFromPem(credentials.cert)], password, { algorithm: '3des' });
  const base64 = Buffer.from(forge.asn1.toDer(pfx).getBytes(), 'binary').toString('base64');
  const legacyEncrypt = (text) => {
    const iv = crypto.randomBytes(16); const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(process.env.ENCRYPTION_KEY), iv);
    return iv.toString('hex') + ':' + Buffer.concat([cipher.update(text), cipher.final()]).toString('hex');
  };
  const source = { empresaId: 'qa-vault-no-database', certificadoA1: legacyEncrypt(base64), senhaCertificado: legacyEncrypt(password), purpose: 'SIGN_CANCEL' };
  const originalUpdate = prisma.empresa.updateMany; const originalLog = logger.createLog;
  let pending; let current = { ...source, certificadoA1: 'already-rotated-ciphertext', senhaCertificado: 'already-rotated-password' };
  prisma.empresa.updateMany = async (params) => {
    pending = params;
    if (current.certificadoA1 === params.where.certificadoA1 && current.senhaCertificado === params.where.senhaCertificado) current = { ...current, ...params.data };
    return { count: 0 };
  };
  logger.createLog = async () => {};
  try {
    const opened = openEmpresaCertificate(source);
    assert.equal(opened.senha, undefined);
    assert.match(opened.cert, /BEGIN CERTIFICATE/);
    assert.match(opened.key, /BEGIN RSA PRIVATE KEY/);
    assert.equal(pending.where.id, source.empresaId); assert.equal(pending.where.certificadoA1, source.certificadoA1); assert.equal(pending.where.senhaCertificado, source.senhaCertificado);
    assert.ok(pending.data.certificadoA1.startsWith('v2:'));
    assert.equal(current.certificadoA1, 'already-rotated-ciphertext'); assert.equal(current.senhaCertificado, 'already-rotated-password');
  } finally { prisma.empresa.updateMany = originalUpdate; logger.createLog = originalLog; }
});
