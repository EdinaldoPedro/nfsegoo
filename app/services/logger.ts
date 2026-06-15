import { prisma } from '@/app/utils/prisma';

interface LogParams {
  level: 'INFO' | 'ERRO' | 'ALERTA' | 'DEBUG';
  action: string;
  message: string;
  details?: any;
  module?: string;
  traceId?: string;
  userId?: string;
  requestPath?: string;
  statusCode?: number;
  durationMs?: number;
  debugHint?: string;
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

export function createTraceId(prefix = 'trace') {
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}_${random}`;
}

export function getErrorDiagnostics(error: any) {
  const message = String(error?.message || error || 'Erro desconhecido');
  const response = error?.response;
  const code = error?.code || response?.status || response?.statusCode;

  return {
    code,
    message,
    responseStatus: response?.status,
    responseText: response?.data || response?.statusText,
    stack: error?.stack,
  };
}

export function inferDebugHint(error: any, fallback?: string) {
  const text = `${error?.code || ''} ${error?.message || error || ''} ${error?.response?.data || ''}`.toLowerCase();

  if (text.includes('quota') || text.includes('daily') || text.includes('limit') || text.includes('too many')) {
    return 'O provedor pode ter bloqueado por limite de envio. Aguarde o reset do limite ou altere a conta SMTP.';
  }

  if (text.includes('auth') || text.includes('invalid login') || text.includes('535')) {
    return 'Falha de autenticacao SMTP. Confira usuario, senha/app password e permissoes da conta remetente.';
  }

  if (text.includes('timeout') || text.includes('etimedout') || text.includes('econnreset') || text.includes('socket')) {
    return 'Falha temporaria de rede ou servico externo instavel. Tente novamente e verifique conectividade do servidor.';
  }

  if (text.includes('certificate') || text.includes('tls') || text.includes('ssl')) {
    return 'Falha TLS/SSL. Verifique porta, modo seguro e certificado do servidor SMTP.';
  }

  return fallback || undefined;
}

export async function createLog({
  level,
  action,
  message,
  details,
  module,
  traceId,
  userId,
  requestPath,
  statusCode,
  durationMs,
  debugHint,
  empresaId,
  vendaId,
}: LogParams) {
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
        module,
        traceId,
        userId,
        requestPath,
        statusCode,
        durationMs,
        debugHint: debugHint ? sanitizarString(debugHint) : undefined,
        empresaId,
        vendaId,
      } as any,
    });

    const cor = level === 'ERRO' ? '\x1b[31m' : '\x1b[32m';
    console.log(`${cor}[${level}] ${action}:\x1b[0m ${sanitizarString(message)}`);
  } catch (e) {
    console.error('FALHA AO GRAVAR LOG:', e);
  }
}
