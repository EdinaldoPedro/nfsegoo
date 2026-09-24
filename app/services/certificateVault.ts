import { decrypt, encrypt } from '@/app/utils/crypto';
import { createLog } from '@/app/services/logger';
import { prisma } from '@/app/utils/prisma';
import { parsePkcs12, type CertificateChainStatus } from '@/app/utils/pkcs12';

type CertificatePurpose =
  | 'SIGN_XML'
  | 'TRANSMIT_XML'
  | 'CONSULT_NFSE'
  | 'CANCEL_NFSE'
  | 'SIGN_CANCEL'
  | 'DOWNLOAD_PDF'
  | 'CONSULT_CPF_INSCRICAO'
  | 'CONSULT_DPS'
  | 'VALIDATE_CERT';

interface CertificateSource {
  empresaId?: string | null;
  certificadoA1?: string | null;
  senhaCertificado?: string | null;
  expectedCnpj?: string | null;
  requireTrustedChain?: boolean;
  purpose: CertificatePurpose;
}

export interface CertificateCredentials {
  cert: string;
  key: string;
  fingerprintSha256: string;
  chainStatus: CertificateChainStatus;
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
    .updateMany({
      // A lazy re-encryption must not overwrite a certificate rotated meanwhile.
      where: { id: source.empresaId, certificadoA1: source.certificadoA1, senhaCertificado: source.senhaCertificado },
      data: { certificadoA1, senhaCertificado },
    })
    .catch(() => {});
}

export function openEmpresaCertificate(source: CertificateSource): CertificateCredentials {
  const pfxBase64 = decryptRequired(source.certificadoA1, 'Certificado digital');
  const senha = decryptRequired(source.senhaCertificado, 'Senha do certificado digital');

  try {
    const parsed = parsePkcs12({
      base64: pfxBase64,
      password: senha,
      expectedCnpj: source.expectedCnpj,
      requireTrustedChain: source.requireTrustedChain,
    });
    const fingerprintSha256 = parsed.fingerprintSha256;

    scheduleLegacyReencrypt(source, pfxBase64, senha);

    void createLog({
      level: 'INFO',
      action: 'CERTIFICATE_ACCESS',
      message: 'Certificado digital usado pelo motor fiscal.',
      empresaId: source.empresaId || undefined,
      details: {
        purpose: source.purpose,
        fingerprintSha256,
        chainStatus: parsed.chainStatus,
      },
    }).catch(() => {});

    return {
      cert: parsed.certPem,
      key: parsed.keyPem,
      fingerprintSha256,
      chainStatus: parsed.chainStatus,
    };
  } catch (error) {
    throw new Error('Não foi possível abrir e validar o certificado digital.', { cause: error });
  }
}
