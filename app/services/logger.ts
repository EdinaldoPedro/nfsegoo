import { prisma } from '@/app/utils/prisma';

interface LogParams {
  level: 'INFO' | 'ERRO' | 'ALERTA' | 'DEBUG';
  action: string;
  message: string;
  details?: any;
  empresaId?: string;
  vendaId?: string;
}

const CHAVES_SENSIVEIS = [
  'senha',
  'password',
  'senhaCertificado',
  'certificadoA1',
  'Authorization',
  'token',
  'key',
  'pfx',
  'certificado',
  'xmlBase64',
  'pdfBase64',
  'qrCodePix',
  'xml',
  'xmlGerado',
  'xmlDistribuicao',
  'pdf',
  'payloadOriginal',
  'dpsXmlGZipB64',
  'nfseXmlGZipB64',
  'pedidoRegistroEventoXmlGZipB64',
  'privateKey',
  'SignatureValue',
  'X509Certificate',
];

function sanitizarString(valor: string) {
  let seguro = valor
    .replace(/-----BEGIN [\s\S]*?PRIVATE KEY-----[\s\S]*?-----END [\s\S]*?PRIVATE KEY-----/gi, '*** CHAVE PRIVADA OMITIDA ***')
    .replace(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/gi, '*** CERTIFICADO OMITIDO ***')
    .replace(/<X509Certificate>[\s\S]*?<\/X509Certificate>/gi, '<X509Certificate>*** OMITIDO ***</X509Certificate>')
    .replace(/<SignatureValue>[\s\S]*?<\/SignatureValue>/gi, '<SignatureValue>*** OMITIDO ***</SignatureValue>')
    .replace(/(Authorization["']?\s*[:=]\s*["']?Basic\s+)[A-Za-z0-9+/=]+/gi, '$1***');

  if (/^[A-Za-z0-9+/=\s]{1000,}$/.test(seguro)) {
    seguro = '*** CONTEUDO BASE64 OMITIDO ***';
  }

  return seguro;
}

function sanitizarObjeto(obj: any): any {
  if (!obj) return obj;
  if (typeof obj === 'string') return sanitizarString(obj);

  if (Array.isArray(obj)) {
    return obj.map((item) => sanitizarObjeto(item));
  }

  if (typeof obj === 'object') {
    const novoObj: any = {};
    for (const key in obj) {
      const ehSensivel = CHAVES_SENSIVEIS.some((k) => key.toLowerCase().includes(k.toLowerCase()));
      novoObj[key] = ehSensivel ? '*** DADO SENSIVEL OMITIDO ***' : sanitizarObjeto(obj[key]);
    }
    return novoObj;
  }

  return obj;
}

export function sanitizeLogValue(value: any): any {
  return sanitizarObjeto(value);
}

export async function createLog({ level, action, message, details, empresaId, vendaId }: LogParams) {
  try {
    let detailsStr = '';
    const dadosSeguros = sanitizarObjeto(details);

    if (dadosSeguros) {
      if (dadosSeguros instanceof Error) {
        detailsStr = JSON.stringify({ message: sanitizarString(dadosSeguros.message), stack: dadosSeguros.stack }, null, 2);
      } else {
        detailsStr = JSON.stringify(dadosSeguros, null, 2);
      }
    }

    await prisma.systemLog.create({
      data: {
        level,
        action,
        message: sanitizarString(message),
        details: detailsStr,
        empresaId,
        vendaId,
      },
    });

    const cor = level === 'ERRO' ? '\x1b[31m' : '\x1b[32m';
    console.log(`${cor}[${level}] ${action}:\x1b[0m ${sanitizarString(message)}`);
  } catch (e) {
    console.error('FALHA AO GRAVAR LOG:', e);
  }
}
