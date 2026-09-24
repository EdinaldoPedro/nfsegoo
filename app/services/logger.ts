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

const TRECHOS_SENSIVEIS = [
  'senha',
  'password',
  'senhaCertificado',
  'certificadoA1',
  'authorization',
  'token',
  'pfx',
  'certificado',
  'secret',
  'cookie',
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
].map(key => key.toLowerCase());

const CHAVES_PESSOAIS = new Set([
  'email', 'to', 'from', 'accepted', 'rejected', 'nome', 'cpf', 'cnpj',
  'telefone', 'phone', 'documento', 'recipient', 'recipients',
]);
const HASHES_PESSOAIS_PERMITIDOS = new Set(['emailhash', 'previousemailhash', 'nextemailhash']);
const OMITIDO = '*** DADO SENSIVEL OMITIDO ***';
const MAX_STRING = 4_000;
const MAX_DEPTH = 8;
const MAX_NODES = 1_000;

function sanitizarString(valor: string) {
  let seguro = valor
    .replace(/-----BEGIN [\s\S]*?PRIVATE KEY-----[\s\S]*?-----END [\s\S]*?PRIVATE KEY-----/gi, '*** CHAVE PRIVADA OMITIDA ***')
    .replace(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/gi, '*** CERTIFICADO OMITIDO ***')
    .replace(/<X509Certificate>[\s\S]*?<\/X509Certificate>/gi, '<X509Certificate>*** OMITIDO ***</X509Certificate>')
    .replace(/<SignatureValue>[\s\S]*?<\/SignatureValue>/gi, '<SignatureValue>*** OMITIDO ***</SignatureValue>')
    .replace(/(Authorization["']?\s*[:=]\s*["']?(?:Basic|Bearer)\s+)[A-Za-z0-9._~+/=-]+/gi, '$1***')
    .replace(/([?#&](?:token|code|codigo|senha|password)=)[^&#\s]+/gi, '$1***')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '*** EMAIL OMITIDO ***')
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '*** CPF OMITIDO ***');

  if (/^[A-Za-z0-9+/=\s]{1000,}$/.test(seguro)) {
    seguro = '*** CONTEUDO BASE64 OMITIDO ***';
  }

  return seguro.length > MAX_STRING ? `${seguro.slice(0, MAX_STRING)}…[truncado]` : seguro;
}

function chaveSensivel(key: string) {
  const normalized = key.toLowerCase();
  if (HASHES_PESSOAIS_PERMITIDOS.has(normalized)) return false;
  return CHAVES_PESSOAIS.has(normalized) || TRECHOS_SENSIVEIS.some(fragment => normalized.includes(fragment));
}

function sanitizarObjeto(obj: any, state = { nodes: 0, seen: new WeakSet<object>() }, depth = 0): any {
  if (!obj) return obj;
  if (typeof obj === 'string') return sanitizarString(obj);
  if (typeof obj === 'bigint') return obj.toString();
  if (typeof obj !== 'object') return obj;
  if (++state.nodes > MAX_NODES) return '*** ESTRUTURA OMITIDA POR LIMITE ***';
  if (depth >= MAX_DEPTH) return '*** ESTRUTURA OMITIDA POR PROFUNDIDADE ***';
  if (state.seen.has(obj)) return '*** REFERENCIA CIRCULAR OMITIDA ***';
  if (obj instanceof Date) return obj.toISOString();
  state.seen.add(obj);
  if (Array.isArray(obj)) {
    return obj.slice(0, 200).map((item) => sanitizarObjeto(item, state, depth + 1));
  }

  if (obj instanceof Error) {
    return { name: obj.name, message: sanitizarString(obj.message) };
  }

  const novoObj: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj).slice(0, 200)) {
    novoObj[key] = chaveSensivel(key) ? OMITIDO : sanitizarObjeto(value, state, depth + 1);
  }
  return novoObj;
}

export function sanitizeLogValue(value: any): any {
  return sanitizarObjeto(value);
}

export function createTraceId(prefix = 'trace') {
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}_${random}`;
}

export function getErrorDiagnostics(error: any) {
  const message = sanitizarString(String(error?.message || error || 'Erro desconhecido'));
  const response = error?.response;
  const rawCode = error?.code || response?.status || response?.statusCode;
  const code = typeof rawCode === 'string' || typeof rawCode === 'number' ? rawCode : undefined;

  return {
    name: typeof error?.name === 'string' ? sanitizarString(error.name) : undefined,
    code,
    message,
    responseStatus: typeof response?.status === 'number' ? response.status : undefined,
    responseText: sanitizarObjeto(response?.data || response?.statusText),
    ...(process.env.NODE_ENV === 'development' && typeof error?.stack === 'string'
      ? { stack: sanitizarString(error.stack) } : {}),
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
      if (detailsStr.length > 32_000) detailsStr = `${detailsStr.slice(0, 32_000)}\n*** LOG TRUNCADO ***`;
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
