import { createPrivateKey, X509Certificate } from 'crypto';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import forge from 'node-forge';
import { normalizeCnpj, validarCNPJ } from '@/app/utils/cnpj';

const MAX_PFX_BYTES = 1024 * 1024;
const MAX_PASSWORD_BYTES = 256;
const MAX_ASN1_DEPTH = 32;
const MAX_ASN1_NODES = 25_000;
const MAX_KDF_ITERATIONS = 1_000_000;
const ICP_BRASIL_CNPJ_OID = '2.16.76.1.3.3';
const KDF_OIDS = new Set([
  '1.2.840.113549.1.5.12',
  '1.2.840.113549.1.12.1.1',
  '1.2.840.113549.1.12.1.2',
  '1.2.840.113549.1.12.1.3',
  '1.2.840.113549.1.12.1.4',
  '1.2.840.113549.1.12.1.5',
  '1.2.840.113549.1.12.1.6',
]);

export type CertificateChainStatus = 'TRUSTED_CONFIGURED_BUNDLE' | 'UNVERIFIED_DEVELOPMENT';
export type CertificateCnpjSource = 'ICP_BRASIL_OTHER_NAME' | 'COMMON_NAME_LEGACY' | 'NOT_PRESENT';

export interface ParsedPkcs12 {
  cert: forge.pki.Certificate;
  certPem: string;
  keyPem: string;
  vencimento: Date;
  cnpj: string | null;
  cnpjSource: CertificateCnpjSource;
  fingerprintSha256: string;
  chainStatus: CertificateChainStatus;
}

export class Pkcs12ValidationError extends Error {
  readonly status = 400;
}

function certificateError(message: string) {
  return new Pkcs12ValidationError(message);
}

function decodeCanonicalBase64(value: unknown): Buffer {
  if (typeof value !== 'string' || !value || value.length > 1_398_104 || value.length % 4 !== 0
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw certificateError('Arquivo PFX/P12 inválido ou maior que 1 MiB.');
  }
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length < 16 || bytes.length > MAX_PFX_BYTES || bytes.toString('base64') !== value) {
    throw certificateError('Arquivo PFX/P12 inválido ou maior que 1 MiB.');
  }
  return bytes;
}

function validatePassword(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !value || Buffer.byteLength(value, 'utf8') > MAX_PASSWORD_BYTES || value.includes('\u0000')) {
    throw certificateError('Informe a senha do certificado com até 256 bytes.');
  }
}

/** Iterative DER envelope validation avoids handing deeply nested or unbounded data to forge. */
function preflightDer(bytes: Buffer) {
  const stack: Array<{ end: number; depth: number }> = [{ end: bytes.length, depth: 0 }];
  let cursor = 0;
  let nodes = 0;
  let roots = 0;

  while (stack.length) {
    const parent = stack[stack.length - 1];
    if (cursor === parent.end) { stack.pop(); continue; }
    if (cursor > parent.end || cursor >= bytes.length) throw certificateError('Estrutura ASN.1 inválida no PFX/P12.');
    if (parent.depth === 0) roots += 1;
    nodes += 1;
    if (nodes > MAX_ASN1_NODES) throw certificateError('Estrutura ASN.1 excessivamente complexa.');

    const firstTag = bytes[cursor++];
    const constructed = (firstTag & 0x20) !== 0;
    if ((firstTag & 0x1f) === 0x1f) {
      let tagOctets = 0;
      while (true) {
        if (cursor >= parent.end || ++tagOctets > 5) throw certificateError('Tag ASN.1 inválida.');
        if ((bytes[cursor++] & 0x80) === 0) break;
      }
    }
    if (cursor >= parent.end) throw certificateError('Comprimento ASN.1 ausente.');
    const firstLength = bytes[cursor++];
    if (firstLength === 0x80) throw certificateError('Comprimento ASN.1 indefinido não é aceito.');
    let length = firstLength;
    if ((firstLength & 0x80) !== 0) {
      const octets = firstLength & 0x7f;
      if (octets < 1 || octets > 4 || cursor + octets > parent.end || bytes[cursor] === 0) throw certificateError('Comprimento ASN.1 inválido.');
      length = 0;
      for (let index = 0; index < octets; index += 1) length = length * 256 + bytes[cursor++];
      if (length < 128) throw certificateError('Codificação DER não canônica.');
    }
    const end = cursor + length;
    if (!Number.isSafeInteger(end) || end > parent.end || end > bytes.length) throw certificateError('Estrutura ASN.1 truncada.');
    if (constructed && length > 0) {
      const depth = parent.depth + 1;
      if (depth > MAX_ASN1_DEPTH) throw certificateError('Estrutura ASN.1 excessivamente profunda.');
      stack.push({ end, depth });
    } else {
      cursor = end;
    }
  }
  if (cursor !== bytes.length || roots !== 1 || bytes[0] !== 0x30) throw certificateError('PFX/P12 não possui um contêiner DER válido.');
}

function integerValue(node: any): number | null {
  if (!node || node.tagClass !== forge.asn1.Class.UNIVERSAL || node.type !== forge.asn1.Type.INTEGER || typeof node.value !== 'string') return null;
  if (!node.value.length || node.value.length > 6 || (node.value.charCodeAt(0) & 0x80) !== 0) return null;
  let result = 0;
  for (let index = 0; index < node.value.length; index += 1) result = result * 256 + node.value.charCodeAt(index);
  return result;
}

function assertKdfBounds(root: any) {
  const stack: any[] = [root];
  while (stack.length) {
    const node = stack.pop();
    const children = Array.isArray(node?.value) ? node.value : [];
    for (let index = 0; index < children.length; index += 1) {
      const child = children[index];
      if (child?.tagClass === forge.asn1.Class.UNIVERSAL && child.type === forge.asn1.Type.OID && typeof child.value === 'string') {
        let oid = '';
        try { oid = forge.asn1.derToOid(child.value); } catch { /* parsed below as invalid PFX */ }
        if (KDF_OIDS.has(oid)) {
          const params = children[index + 1];
          const paramChildren = Array.isArray(params?.value) ? params.value : [];
          const iteration = paramChildren.map(integerValue).find((value: number | null): value is number => value !== null);
          if (iteration !== undefined && (iteration < 1 || iteration > MAX_KDF_ITERATIONS)) {
            throw certificateError('Parâmetros criptográficos do PFX/P12 excedem o limite seguro.');
          }
        }
      }
      stack.push(child);
    }
  }
  const rootChildren = Array.isArray(root?.value) ? root.value : [];
  const macChildren = Array.isArray(rootChildren[2]?.value) ? rootChildren[2].value : [];
  const macIteration = integerValue(macChildren[2]);
  if (macIteration !== null && (macIteration < 1 || macIteration > MAX_KDF_ITERATIONS)) {
    throw certificateError('Parâmetros criptográficos do PFX/P12 excedem o limite seguro.');
  }
}

function uniqueByPem<T>(items: T[], serialize: (item: T) => string) {
  const values = new Map<string, T>();
  for (const item of items) values.set(serialize(item), item);
  return [...values.values()];
}

function printableOtherName(value: any, depth = 0): string | null {
  if (!value || depth > 4) return null;
  if (Array.isArray(value)) {
    for (const child of value) {
      const result = printableOtherName(child, depth + 1);
      if (result) return result;
    }
    return null;
  }
  if (value.tagClass === forge.asn1.Class.UNIVERSAL
    && [forge.asn1.Type.OCTETSTRING, forge.asn1.Type.PRINTABLESTRING].includes(value.type)
    && typeof value.value === 'string') {
    return value.value;
  }
  return printableOtherName(value.value, depth + 1);
}

function extractCnpj(cert: forge.pki.Certificate): { cnpj: string | null; source: CertificateCnpjSource } {
  const san = cert.getExtension('subjectAltName') as any;
  for (const altName of san?.altNames || []) {
    if (altName?.type !== 0 || !Array.isArray(altName.value)) continue;
    const oidNode = altName.value[0];
    if (!oidNode || oidNode.type !== forge.asn1.Type.OID || typeof oidNode.value !== 'string') continue;
    let oid: string;
    try { oid = forge.asn1.derToOid(oidNode.value); } catch { continue; }
    if (oid !== ICP_BRASIL_CNPJ_OID) continue;
    const raw = printableOtherName(altName.value.slice(1));
    const cnpj = normalizeCnpj(raw);
    if (!cnpj || !validarCNPJ(cnpj)) throw certificateError('O CNPJ no campo ICP-Brasil do certificado é inválido.');
    return { cnpj, source: 'ICP_BRASIL_OTHER_NAME' };
  }

  for (const attribute of cert.subject?.attributes || []) {
    if (attribute.shortName !== 'CN' && attribute.name !== 'commonName') continue;
    const suffix = String(attribute.value || '').trim().split(':').pop()?.trim() || '';
    const cnpj = normalizeCnpj(suffix);
    if (cnpj && validarCNPJ(cnpj)) return { cnpj, source: 'COMMON_NAME_LEGACY' };
  }
  return { cnpj: null, source: 'NOT_PRESENT' };
}

function orderedChain(leaf: forge.pki.Certificate, certificates: forge.pki.Certificate[]) {
  const leafPem = forge.pki.certificateToPem(leaf);
  const remaining = certificates.filter(cert => forge.pki.certificateToPem(cert) !== leafPem);
  const chain = [leaf];
  while (remaining.length && chain.length <= 10) {
    const current = chain[chain.length - 1];
    const index = remaining.findIndex(parent => {
      try { return current.isIssuer(parent) && parent.verify(current); } catch { return false; }
    });
    if (index < 0) break;
    chain.push(remaining[index]);
    remaining.splice(index, 1);
  }
  return chain;
}

export function loadIcpTrustBundle(): forge.pki.Certificate[] {
  let pem = process.env.ICP_BRASIL_TRUST_BUNDLE_PEM;
  const bundleFile = process.env.ICP_BRASIL_TRUST_BUNDLE_FILE || (!pem ? join(process.cwd(), 'resources', 'fiscal', 'icp-brasil-roots-20260826.pem') : undefined);
  if (!pem && bundleFile) {
    try {
      const file = statSync(bundleFile);
      if (!file.isFile() || file.size > 2 * 1024 * 1024) throw new Error('Invalid trust file');
      pem = readFileSync(bundleFile, 'utf8');
    }
    catch { throw certificateError('O arquivo da cadeia de confiança ICP-Brasil configurado no servidor não pôde ser lido.'); }
  }
  if (!pem) return [];
  if (Buffer.byteLength(pem, 'utf8') > 2 * 1024 * 1024) throw certificateError('A cadeia de confiança ICP-Brasil configurada excede o limite permitido.');
  const blocks = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) || [];
  if (!blocks.length || blocks.length > 100) throw certificateError('A cadeia de confiança ICP-Brasil configurada é inválida.');
  try {
    return blocks.map(block => {
      const cert = forge.pki.certificateFromPem(block);
      const root = new X509Certificate(block);
      if (!root.ca || !root.checkIssued(root) || !root.verify(root.publicKey)) {
        throw new Error('Not a verified root CA');
      }
      return cert;
    });
  }
  catch { throw certificateError('A cadeia de confiança ICP-Brasil configurada contém um certificado inválido.'); }
}

function verifyChain(leaf: forge.pki.Certificate, certificates: forge.pki.Certificate[], required: boolean): CertificateChainStatus {
  if (!required) return 'UNVERIFIED_DEVELOPMENT';
  const trusted = loadIcpTrustBundle();
  if (!trusted.length) {
    if (required) throw certificateError('A cadeia de confiança ICP-Brasil não está configurada no ambiente de produção.');
    return 'UNVERIFIED_DEVELOPMENT';
  }
  try {
    forge.pki.verifyCertificateChain(forge.pki.createCaStore(trusted), orderedChain(leaf, certificates), { validityCheckDate: new Date() });
    return 'TRUSTED_CONFIGURED_BUNDLE';
  } catch {
    throw certificateError('A cadeia do certificado não foi validada pelas raízes ICP-Brasil configuradas.');
  }
}

export function parsePkcs12(input: {
  base64: unknown;
  password: unknown;
  expectedCnpj?: unknown;
  requireCnpj?: boolean;
  requireTrustedChain?: boolean;
}): ParsedPkcs12 {
  const bytes = decodeCanonicalBase64(input.base64);
  validatePassword(input.password);
  preflightDer(bytes);

  let root: any;
  let p12: forge.pkcs12.Pkcs12Pfx;
  try {
    root = forge.asn1.fromDer(bytes.toString('binary'), true);
    assertKdfBounds(root);
    p12 = forge.pkcs12.pkcs12FromAsn1(root, true, input.password);
  } catch (error: any) {
    if (error?.status === 400) throw error;
    throw certificateError('Senha incorreta ou arquivo PFX/P12 inválido.');
  }

  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
  const encryptedKeyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag });
  const plainKeyBags = p12.getBags({ bagType: forge.pki.oids.keyBag });
  const certificates = uniqueByPem(
    (certBags[forge.pki.oids.certBag] || []).map(bag => bag.cert).filter((cert): cert is forge.pki.Certificate => Boolean(cert)),
    cert => forge.pki.certificateToPem(cert),
  );
  const keys = uniqueByPem(
    [...(encryptedKeyBags[forge.pki.oids.pkcs8ShroudedKeyBag] || []), ...(plainKeyBags[forge.pki.oids.keyBag] || [])]
      .map(bag => bag.key).filter((key): key is forge.pki.rsa.PrivateKey => Boolean(key)),
    key => forge.pki.privateKeyToPem(key),
  );
  if (!certificates.length || !keys.length) throw certificateError('Certificado A1 sem certificado e chave privada utilizáveis.');

  const pairs: Array<{ cert: forge.pki.Certificate; certPem: string; keyPem: string; x509: X509Certificate }> = [];
  for (const cert of certificates) {
    const certPem = forge.pki.certificateToPem(cert);
    let x509: X509Certificate;
    try { x509 = new X509Certificate(certPem); } catch { continue; }
    for (const key of keys) {
      const keyPem = forge.pki.privateKeyToPem(key);
      try {
        const privateKey = createPrivateKey(keyPem);
        if (x509.checkPrivateKey(privateKey)) pairs.push({ cert, certPem, keyPem, x509 });
      } catch { /* incompatible key candidate */ }
    }
  }
  if (pairs.length !== 1) throw certificateError('O PFX/P12 deve conter exatamente um par de certificado e chave privada correspondente.');
  const pair = pairs[0];
  const privateKey = createPrivateKey(pair.keyPem);
  if (privateKey.asymmetricKeyType !== 'rsa' || Number(privateKey.asymmetricKeyDetails?.modulusLength || 0) < 2048) {
    throw certificateError('O certificado fiscal deve usar chave RSA de no mínimo 2.048 bits.');
  }
  if (pair.x509.ca) throw certificateError('O certificado selecionado é de autoridade certificadora, não de pessoa jurídica.');
  const keyUsage = pair.cert.getExtension('keyUsage') as any;
  if (keyUsage && !keyUsage.digitalSignature && !keyUsage.nonRepudiation) throw certificateError('O certificado não permite assinatura digital.');
  const extendedKeyUsage = pair.cert.getExtension('extKeyUsage') as any;
  if (extendedKeyUsage && !extendedKeyUsage.clientAuth && !extendedKeyUsage['1.3.6.1.5.5.7.3.2']) {
    throw certificateError('O certificado não permite autenticação de cliente.');
  }

  const now = Date.now();
  if (now + 5 * 60_000 < pair.cert.validity.notBefore.getTime()) throw certificateError('O certificado ainda não está válido.');
  if (now - 5 * 60_000 > pair.cert.validity.notAfter.getTime()) throw certificateError('O certificado está vencido.');

  const identity = extractCnpj(pair.cert);
  const expectedCnpj = input.expectedCnpj == null || input.expectedCnpj === '' ? '' : normalizeCnpj(input.expectedCnpj);
  if (input.expectedCnpj != null && input.expectedCnpj !== '' && (!expectedCnpj || !validarCNPJ(expectedCnpj))) throw certificateError('CNPJ esperado inválido.');
  if ((input.requireCnpj || expectedCnpj) && !identity.cnpj) throw certificateError('O certificado não possui CNPJ empresarial identificável.');
  if (expectedCnpj && identity.cnpj !== expectedCnpj) throw certificateError('O certificado pertence a outro CNPJ.');
  const requireTrustedChain = input.requireTrustedChain ?? process.env.NODE_ENV === 'production';
  if (requireTrustedChain && identity.source !== 'ICP_BRASIL_OTHER_NAME') {
    throw certificateError('O certificado de produção não possui o identificador oficial de CNPJ da ICP-Brasil.');
  }
  const chainStatus = verifyChain(pair.cert, certificates, requireTrustedChain);

  return {
    cert: pair.cert,
    certPem: pair.certPem,
    keyPem: pair.keyPem,
    vencimento: pair.cert.validity.notAfter,
    cnpj: identity.cnpj,
    cnpjSource: identity.source,
    fingerprintSha256: pair.x509.fingerprint256.replace(/:/g, '').toLowerCase(),
    chainStatus,
  };
}
