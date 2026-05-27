import crypto from 'crypto';
import forge from 'node-forge';
import { decrypt, encrypt } from '@/app/utils/crypto';
import { createLog } from '@/app/services/logger';
import { prisma } from '@/app/utils/prisma';

type CertificatePurpose =
  | 'SIGN_XML'
  | 'TRANSMIT_XML'
  | 'CONSULT_NFSE'
  | 'CANCEL_NFSE'
  | 'SIGN_CANCEL'
  | 'DOWNLOAD_PDF'
  | 'VALIDATE_CERT';

interface CertificateSource {
  empresaId?: string | null;
  certificadoA1?: string | null;
  senhaCertificado?: string | null;
  purpose: CertificatePurpose;
}

export interface CertificateCredentials {
  cert: string;
  key: string;
  senha: string;
  fingerprintSha256: string;
}

function decryptRequired(value: string | null | undefined, label: string) {
  const decrypted = decrypt(value || null);
  if (!decrypted) {
    throw new Error(`${label} ausente, corrompido ou em formato inseguro.`);
  }
  return decrypted;
}

function isV2Encrypted(value: string | null | undefined) {
  return typeof value === 'string' && value.startsWith('v2:');
}

function scheduleLegacyReencrypt(source: CertificateSource, pfxBase64: string, senha: string) {
  if (!source.empresaId || (isV2Encrypted(source.certificadoA1) && isV2Encrypted(source.senhaCertificado))) {
    return;
  }

  const certificadoA1 = encrypt(pfxBase64);
  const senhaCertificado = encrypt(senha);
  if (!certificadoA1 || !senhaCertificado) return;

  void prisma.empresa
    .update({
      where: { id: source.empresaId },
      data: { certificadoA1, senhaCertificado },
    })
    .catch(() => {});
}

export function openEmpresaCertificate(source: CertificateSource): CertificateCredentials {
  const pfxBase64 = decryptRequired(source.certificadoA1, 'Certificado digital');
  const senha = decryptRequired(source.senhaCertificado, 'Senha do certificado digital');

  try {
    const pfxBuffer = Buffer.from(pfxBase64, 'base64');
    const p12Asn1 = forge.asn1.fromDer(pfxBuffer.toString('binary'));
    const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, senha);

    const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
    // @ts-ignore node-forge types do not expose indexed OID bags cleanly.
    const cert = certBags[forge.pki.oids.certBag]?.[0]?.cert;

    const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag });
    // @ts-ignore node-forge types do not expose indexed OID bags cleanly.
    let key = keyBags[forge.pki.oids.pkcs8ShroudedKeyBag]?.[0]?.key;
    if (!key) {
      const keyBags2 = p12.getBags({ bagType: forge.pki.oids.keyBag });
      // @ts-ignore node-forge types do not expose indexed OID bags cleanly.
      key = keyBags2[forge.pki.oids.keyBag]?.[0]?.key;
    }

    if (!cert || !key) {
      throw new Error('Chaves nao encontradas no PFX.');
    }

    const certPem = forge.pki.certificateToPem(cert);
    const keyPem = forge.pki.privateKeyToPem(key);
    const fingerprintSha256 = crypto.createHash('sha256').update(certPem).digest('hex');

    scheduleLegacyReencrypt(source, pfxBase64, senha);

    void createLog({
      level: 'INFO',
      action: 'CERTIFICATE_ACCESS',
      message: 'Certificado digital usado pelo motor fiscal.',
      empresaId: source.empresaId || undefined,
      details: {
        purpose: source.purpose,
        fingerprintSha256,
      },
    });

    return {
      cert: certPem,
      key: keyPem,
      senha,
      fingerprintSha256,
    };
  } catch (error: any) {
    throw new Error(`Erro ao abrir certificado digital: ${error.message}`);
  }
}
