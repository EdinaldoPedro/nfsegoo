const { test } = require('node:test');
const assert = require('node:assert/strict');
const forge = require('node-forge');
const { writeFileSync, unlinkSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { randomUUID } = require('node:crypto');
const { parsePkcs12, Pkcs12ValidationError, loadIcpTrustBundle } = require('../app/utils/pkcs12.ts');

const cnpj = '12ABC34501DE35';

function validity(cert) {
  cert.validity.notBefore = new Date(Date.now() - 24 * 60 * 60 * 1000);
  cert.validity.notAfter = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
}

function subjectAltNameCnpj(value) {
  const oid = forge.asn1.create(
    forge.asn1.Class.UNIVERSAL,
    forge.asn1.Type.OID,
    false,
    forge.asn1.oidToDer('2.16.76.1.3.3').getBytes(),
  );
  const text = forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.PRINTABLESTRING, false, value);
  const explicitValue = forge.asn1.create(forge.asn1.Class.CONTEXT_SPECIFIC, 0, true, [text]);
  const otherName = forge.asn1.create(forge.asn1.Class.CONTEXT_SPECIFIC, 0, true, [oid, explicitValue]);
  const sequence = forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [otherName]);
  return { id: '2.5.29.17', critical: false, value: forge.asn1.toDer(sequence).getBytes() };
}

function fixture() {
  const rootKeys = forge.pki.rsa.generateKeyPair(2048);
  const root = forge.pki.createCertificate();
  root.publicKey = rootKeys.publicKey; root.serialNumber = '01'; validity(root);
  const rootName = [{ name: 'commonName', value: 'QA synthetic root - never trust' }];
  root.setSubject(rootName); root.setIssuer(rootName);
  root.setExtensions([
    { name: 'basicConstraints', cA: true, critical: true },
    { name: 'keyUsage', keyCertSign: true, cRLSign: true, critical: true },
  ]);
  root.sign(rootKeys.privateKey, forge.md.sha256.create());

  const leafKeys = forge.pki.rsa.generateKeyPair(2048);
  const leaf = forge.pki.createCertificate();
  leaf.publicKey = leafKeys.publicKey; leaf.serialNumber = '02'; validity(leaf);
  leaf.setSubject([{ name: 'commonName', value: `Empresa QA:${cnpj}` }]);
  leaf.setIssuer(root.subject.attributes);
  leaf.setExtensions([
    { name: 'basicConstraints', cA: false, critical: true },
    { name: 'keyUsage', digitalSignature: true, nonRepudiation: true, critical: true },
    { name: 'extKeyUsage', clientAuth: true },
    subjectAltNameCnpj(cnpj),
  ]);
  leaf.sign(rootKeys.privateKey, forge.md.sha256.create());
  return { rootKeys, root, leafKeys, leaf };
}

function pfxBase64(key, certs, password = 'qa-pfx-password') {
  const pfx = forge.pkcs12.toPkcs12Asn1(key, certs, password, { algorithm: '3des' });
  return Buffer.from(forge.asn1.toDer(pfx).getBytes(), 'binary').toString('base64');
}

test('bundle oficial versionado carrega somente raízes compatíveis', () => {
  const previousPem = process.env.ICP_BRASIL_TRUST_BUNDLE_PEM;
  const previousFile = process.env.ICP_BRASIL_TRUST_BUNDLE_FILE;
  delete process.env.ICP_BRASIL_TRUST_BUNDLE_PEM;
  delete process.env.ICP_BRASIL_TRUST_BUNDLE_FILE;
  try { assert.equal(loadIcpTrustBundle().length, 2); }
  finally {
    if (previousPem !== undefined) process.env.ICP_BRASIL_TRUST_BUNDLE_PEM = previousPem;
    if (previousFile !== undefined) process.env.ICP_BRASIL_TRUST_BUNDLE_FILE = previousFile;
  }
});

test('PFX: CNPJ alfanumerico vem do OID ICP-Brasil e cadeia configurada e validada', () => {
  const { root, leafKeys, leaf } = fixture();
  const base64 = pfxBase64(leafKeys.privateKey, [leaf, root]);
  const previous = process.env.ICP_BRASIL_TRUST_BUNDLE_PEM;
  process.env.ICP_BRASIL_TRUST_BUNDLE_PEM = forge.pki.certificateToPem(root);
  try {
    const result = parsePkcs12({ base64, password: 'qa-pfx-password', expectedCnpj: cnpj, requireCnpj: true, requireTrustedChain: true });
    assert.equal(result.cnpj, cnpj);
    assert.equal(result.cnpjSource, 'ICP_BRASIL_OTHER_NAME');
    assert.equal(result.chainStatus, 'TRUSTED_CONFIGURED_BUNDLE');
    assert.match(result.fingerprintSha256, /^[a-f0-9]{64}$/);
  } finally {
    if (previous === undefined) delete process.env.ICP_BRASIL_TRUST_BUNDLE_PEM;
    else process.env.ICP_BRASIL_TRUST_BUNDLE_PEM = previous;
  }
});

test('PFX: producao falha fechada com bundle indisponivel e nao aceita outro CNPJ', () => {
  const { root, leafKeys, leaf } = fixture();
  const base64 = pfxBase64(leafKeys.privateKey, [leaf, root]);
  const previous = process.env.ICP_BRASIL_TRUST_BUNDLE_PEM;
  const previousFile = process.env.ICP_BRASIL_TRUST_BUNDLE_FILE;
  delete process.env.ICP_BRASIL_TRUST_BUNDLE_PEM;
  process.env.ICP_BRASIL_TRUST_BUNDLE_FILE = join(tmpdir(), `nfsegoo-ausente-${randomUUID()}.pem`);
  try {
    assert.throws(() => parsePkcs12({ base64, password: 'qa-pfx-password', expectedCnpj: cnpj, requireTrustedChain: true }),
      error => error instanceof Pkcs12ValidationError && /cadeia de confiança/.test(error.message));
    assert.throws(() => parsePkcs12({ base64, password: 'qa-pfx-password', expectedCnpj: '11222333000181' }), /outro CNPJ/);
  } finally {
    if (previous !== undefined) process.env.ICP_BRASIL_TRUST_BUNDLE_PEM = previous;
    if (previousFile === undefined) delete process.env.ICP_BRASIL_TRUST_BUNDLE_FILE;
    else process.env.ICP_BRASIL_TRUST_BUNDLE_FILE = previousFile;
  }
});

test('bundle de confiança pode ser lido de arquivo PEM e rejeita certificado que não é raiz', () => {
  const { root, leaf } = fixture();
  const path = join(tmpdir(), `nfsegoo-icp-${randomUUID()}.pem`);
  const previousPem = process.env.ICP_BRASIL_TRUST_BUNDLE_PEM;
  const previousFile = process.env.ICP_BRASIL_TRUST_BUNDLE_FILE;
  delete process.env.ICP_BRASIL_TRUST_BUNDLE_PEM;
  process.env.ICP_BRASIL_TRUST_BUNDLE_FILE = path;
  try {
    writeFileSync(path, forge.pki.certificateToPem(root));
    assert.equal(loadIcpTrustBundle().length, 1);
    writeFileSync(path, forge.pki.certificateToPem(leaf));
    assert.throws(() => loadIcpTrustBundle(), Pkcs12ValidationError);
  } finally {
    unlinkSync(path);
    if (previousPem === undefined) delete process.env.ICP_BRASIL_TRUST_BUNDLE_PEM;
    else process.env.ICP_BRASIL_TRUST_BUNDLE_PEM = previousPem;
    if (previousFile === undefined) delete process.env.ICP_BRASIL_TRUST_BUNDLE_FILE;
    else process.env.ICP_BRASIL_TRUST_BUNDLE_FILE = previousFile;
  }
});

test('PFX: rejeita chave sem par, RSA fraco, certificado CA, base64 e ASN.1 hostis', () => {
  const { rootKeys, root, leafKeys, leaf } = fixture();
  assert.throws(() => parsePkcs12({ base64: pfxBase64(rootKeys.privateKey, [leaf]), password: 'qa-pfx-password' }), /exatamente um par/);
  assert.throws(() => parsePkcs12({ base64: pfxBase64(rootKeys.privateKey, [root]), password: 'qa-pfx-password' }), /autoridade certificadora/);

  const weakKeys = forge.pki.rsa.generateKeyPair(1024);
  const weak = forge.pki.createCertificate(); weak.publicKey = weakKeys.publicKey; weak.serialNumber = '03'; validity(weak);
  const name = [{ name: 'commonName', value: 'QA weak certificate' }]; weak.setSubject(name); weak.setIssuer(name);
  weak.sign(weakKeys.privateKey, forge.md.sha256.create());
  assert.throws(() => parsePkcs12({ base64: pfxBase64(weakKeys.privateKey, [weak]), password: 'qa-pfx-password' }), /2.048 bits/);

  assert.throws(() => parsePkcs12({ base64: 'arquivo-invalido', password: 'x' }), /PFX\/P12 inválido/);
  let nested = Buffer.from([0x02, 0x01, 0x01]);
  for (let index = 0; index < 35; index += 1) {
    const length = nested.length < 128 ? Buffer.from([nested.length]) : Buffer.from([0x81, nested.length]);
    nested = Buffer.concat([Buffer.from([0x30]), length, nested]);
  }
  assert.throws(() => parsePkcs12({ base64: nested.toString('base64'), password: 'x' }), /profunda/);
  assert.ok(leafKeys.privateKey); // documents that the mismatched fixture used a distinct leaf key.
});
