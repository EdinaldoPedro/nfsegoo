const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const forge = require('node-forge');
const { extrairCredenciais } = require('../app/utils/certHelper.ts');
process.env.ENCRYPTION_KEY = '12345678901234567890123456789012';
const { encrypt, decrypt } = require('../app/utils/crypto.ts');

test('PFX sintetico continua extraindo chave/certificado e assinando com SHA256', () => {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date('2026-01-01T00:00:00Z');
  cert.validity.notAfter = new Date('2027-01-01T00:00:00Z');
  const attributes = [{ name: 'commonName', value: 'QA only - not an ICP-Brasil certificate' }];
  cert.setSubject(attributes);
  cert.setIssuer(attributes);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const pfx = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], 'qa-only-password', { algorithm: '3des' });
  const base64 = Buffer.from(forge.asn1.toDer(pfx).getBytes(), 'binary').toString('base64');
  const credentials = extrairCredenciais(base64, 'qa-only-password');
  const content = Buffer.from('regressao assinatura fiscal');
  const signature = crypto.sign('RSA-SHA256', content, credentials.key);
  assert.equal(crypto.verify('RSA-SHA256', content, credentials.cert, signature), true);
  assert.equal(crypto.verify('RSA-SHA256', Buffer.from('alterado'), credentials.cert, signature), false);
  assert.throws(() => extrairCredenciais(base64, 'senha-incorreta'));
  assert.throws(() => extrairCredenciais('arquivo-invalido', 'senha'));
});

test('Cofre usa IV aleatorio e rejeita adulteracao de ciphertext ou autenticador', () => {
  const secret = 'segredo-sintetico-de-teste';
  const first = encrypt(secret);
  assert.notEqual(first, encrypt(secret));
  assert.equal(decrypt(first), secret);
  for (const part of [2, 3]) {
    const pieces = first.split(':');
    pieces[part] = (pieces[part][0] === 'a' ? 'b' : 'a') + pieces[part].slice(1);
    assert.equal(decrypt(pieces.join(':')), null);
  }
});
