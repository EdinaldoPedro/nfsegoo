import forge from 'node-forge';
import { parsePkcs12, type CertificateChainStatus, type CertificateCnpjSource } from '@/app/utils/pkcs12';

export interface CertificadoA1Validado {
  cert: forge.pki.Certificate;
  vencimento: Date;
  cnpj: string;
  fingerprintSha256: string;
  chainStatus: CertificateChainStatus;
  cnpjSource: CertificateCnpjSource;
}

export function validarCertificadoA1(
  certificadoBase64: string,
  senha: string,
  cnpjEmpresa?: string | null,
  options: { requireTrustedChain?: boolean } = {},
): CertificadoA1Validado {
  const parsed = parsePkcs12({
    base64: certificadoBase64,
    password: senha,
    expectedCnpj: cnpjEmpresa,
    requireCnpj: true,
    requireTrustedChain: options.requireTrustedChain,
  });
  return {
    cert: parsed.cert,
    vencimento: parsed.vencimento,
    cnpj: parsed.cnpj!,
    fingerprintSha256: parsed.fingerprintSha256,
    chainStatus: parsed.chainStatus,
    cnpjSource: parsed.cnpjSource,
  };
}
