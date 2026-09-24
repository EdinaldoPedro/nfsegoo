import { parsePkcs12 } from '@/app/utils/pkcs12';

export function extrairCredenciais(pfxBase64: string, senha: string) {
  const parsed = parsePkcs12({ base64: pfxBase64, password: senha });
  return { cert: parsed.certPem, key: parsed.keyPem };
}
