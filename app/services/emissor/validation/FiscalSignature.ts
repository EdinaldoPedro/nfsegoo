import { createPrivateKey, X509Certificate } from 'node:crypto';
import { SignedXml } from 'xml-crypto';
import { directElement, directElements, fiscalRoot, parseFiscalXml, SIGNATURE_NS } from './FiscalXml';

const C14N = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315';
const EXCLUSIVE_C14N_WITH_COMMENTS = 'http://www.w3.org/2001/10/xml-exc-c14n#WithComments';
const ENVELOPED = 'http://www.w3.org/2000/09/xmldsig#enveloped-signature';
const RSA_SHA256 = 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256';
const SHA256 = 'http://www.w3.org/2001/04/xmlenc#sha256';
const ROOTS = { DPS: 'infDPS', pedRegEvento: 'infPedReg', NFSe: 'infNFSe', evento: 'infEvento' } as const;
type FiscalRoot = keyof typeof ROOTS;

function signatureTarget(xml: string, rootName: FiscalRoot) {
  const root = fiscalRoot(parseFiscalXml(xml), rootName);
  const inf = directElement(root, ROOTS[rootName]);
  const id = inf.getAttribute('Id') || '';
  if (!/^[A-Z]{3}[0-9A-Z]{42,59}$/.test(id)) throw new Error('Identificador fiscal inválido para assinatura.');
  return { root, inf, id };
}

/** Validates cryptographic integrity, NOT ICP-Brasil/government chain trust.
 * Government documents must originate in the fixed, TLS-verified portal client.
 * Read only the returned authenticated reference, never unsigned wrapper data. */
export function verifiedFiscalReference(xml: string, rootName: FiscalRoot, expectedCertificate?: string): Element {
  const { root, id } = signatureTarget(xml, rootName);
  const signature = directElement(root, 'Signature', SIGNATURE_NS);
  const info = directElement(signature, 'SignedInfo', SIGNATURE_NS);
  const method = (name: string) => directElement(info, name, SIGNATURE_NS).getAttribute('Algorithm');
  // The national portal signs the outer NFSe with exclusive canonicalization
  // (including comments), while the taxpayer-signed requests use canonical XML
  // 1.0. Both variants remain RSA/SHA-256 and are verified cryptographically.
  // Keep the portal-only variant out of DPS/event signing to prevent algorithm
  // substitution in documents produced by this application.
  const canonicalization = method('CanonicalizationMethod');
  const allowedCanonicalization = canonicalization === C14N
    || rootName === 'NFSe' && canonicalization === EXCLUSIVE_C14N_WITH_COMMENTS;
  if (!allowedCanonicalization || method('SignatureMethod') !== RSA_SHA256) throw new Error('Algoritmo de assinatura fiscal não permitido.');
  const reference = directElement(info, 'Reference', SIGNATURE_NS);
  if (reference.getAttribute('URI') !== '#' + id) throw new Error('Assinatura não referencia o documento fiscal esperado.');
  if (directElement(reference, 'DigestMethod', SIGNATURE_NS).getAttribute('Algorithm') !== SHA256) throw new Error('Resumo criptográfico não permitido.');
  const transforms = directElements(directElement(reference, 'Transforms', SIGNATURE_NS), 'Transform', SIGNATURE_NS).map((node) => node.getAttribute('Algorithm'));
  if (transforms.length !== 2 || transforms[0] !== ENVELOPED || transforms[1] !== canonicalization) throw new Error('Transformações de assinatura não permitidas.');
  const keyInfo = directElement(signature, 'KeyInfo', SIGNATURE_NS);
  const certificateValue = directElement(directElement(keyInfo, 'X509Data', SIGNATURE_NS), 'X509Certificate', SIGNATURE_NS).textContent?.replace(/\s/g, '') || '';
  if (!/^[A-Za-z0-9+/]+=*$/.test(certificateValue) || certificateValue.length > 32_768) throw new Error('Certificado de assinatura inválido.');
  const certificate = new X509Certificate(Buffer.from(certificateValue, 'base64'));
  if (expectedCertificate && !certificate.raw.equals(new X509Certificate(expectedCertificate).raw)) throw new Error('Certificado de assinatura diferente do esperado.');
  if (certificate.publicKey.asymmetricKeyType !== 'rsa' || (certificate.publicKey.asymmetricKeyDetails?.modulusLength || 0) < 2048) throw new Error('Chave de assinatura fiscal inadequada.');
  const verifier = new SignedXml({ publicCert: certificate.toString(), getCertFromKeyInfo: () => null });
  verifier.loadSignature(signature);
  if (!verifier.checkSignature(xml)) throw new Error('Assinatura fiscal inválida.');
  const references = verifier.getSignedReferences();
  if (references.length !== 1) throw new Error('Assinatura fiscal com referências ambíguas.');
  const authenticated = fiscalRoot(parseFiscalXml(references[0]), ROOTS[rootName]);
  if (authenticated.getAttribute('Id') !== id) throw new Error('Referência autenticada não confere.');
  return authenticated;
}

export function signFiscalXml(xml: string, rootName: FiscalRoot, credentials: { cert: string; key: string }): string {
  const { root, id } = signatureTarget(xml, rootName);
  if (directElements(root, 'Signature', SIGNATURE_NS).length) throw new Error('Documento já possui assinatura.');
  const certificate = new X509Certificate(credentials.cert);
  const privateKey = createPrivateKey(credentials.key);
  if (!certificate.checkPrivateKey(privateKey)) throw new Error('Chave privada não corresponde ao certificado.');
  const signer = new SignedXml({ privateKey: credentials.key, publicCert: credentials.cert, signatureAlgorithm: RSA_SHA256, canonicalizationAlgorithm: C14N });
  signer.addReference({ xpath: `/*/*[@Id='${id}']`, digestAlgorithm: SHA256, transforms: [ENVELOPED, C14N] });
  signer.computeSignature(xml, { location: { reference: '/*', action: 'append' } });
  const signed = signer.getSignedXml();
  verifiedFiscalReference(signed, rootName, credentials.cert);
  return signed;
}
