import https from 'https';
import { openEmpresaCertificate } from '@/app/services/certificateVault';
import { normalizeNfseAccessKey } from '@/app/utils/fiscal-identifiers';

export interface PdfDownloadOptions {
  requestTimeoutMs?: number;
  expectedCnpj?: string;
}

export interface PdfDownloadRetryOptions extends PdfDownloadOptions {
  attempts?: number;
  retryDelayMs?: number;
}

interface PdfApiResult {
  statusCode: number;
  contentType: string;
  body: Buffer;
}

const ADN_DANFSE_BASE_URL = 'https://adn.nfse.gov.br/danfse';
const RETRYABLE_STATUS = new Set([429, 502, 503, 504]);
const MAX_PDF_BYTES = 15 * 1024 * 1024;

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sleepWithJitter(tentativa: number, baseDelayMs: number) {
  const linearDelay = Math.min(baseDelayMs + tentativa * 1500, 15000);
  const jitter = Math.floor(Math.random() * 1000);
  return delay(linearDelay + jitter);
}

function isPdf(buffer: Buffer) {
  return buffer.subarray(0, 4).toString('utf8') === '%PDF';
}

function requestPdfViaAdn(url: string, cert: string, key: string, timeoutMs: number): Promise<PdfApiResult> {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        cert,
        key,
        timeout: timeoutMs,
        rejectUnauthorized: true,
        minVersion: 'TLSv1.2',
        headers: {
          Accept: 'application/pdf',
          Connection: 'close',
          'User-Agent': 'nfsegoo-danfse/1.0',
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        let totalBytes = 0;
        const declaredLength = Number(res.headers['content-length'] || 0);
        if (Number.isFinite(declaredLength) && declaredLength > MAX_PDF_BYTES) {
          res.destroy(Object.assign(new Error('Resposta DANFSe excedeu o limite permitido.'), { retryable: false }));
          return;
        }

        res.on('data', (chunk) => {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          totalBytes += buffer.length;
          if (totalBytes > MAX_PDF_BYTES) {
            res.destroy(Object.assign(new Error('Resposta DANFSe excedeu o limite permitido.'), { retryable: false }));
            return;
          }
          chunks.push(buffer);
        });
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode || 0,
            contentType: String(res.headers['content-type'] || ''),
            body: Buffer.concat(chunks),
          });
        });
        res.on('error', reject);
      },
    );

    req.on('timeout', () => {
      req.destroy(Object.assign(new Error('Tempo limite excedido na API DANFSe.'), { retryable: true }));
    });

    req.on('error', reject);
  });
}

export class NfsePortalDownloader {
  async downloadPdfOficialComRetry(
    chaveAcesso: string,
    pfxBase64: string,
    senhaCertificado: string,
    empresaId?: string,
    options: PdfDownloadRetryOptions = {},
  ): Promise<Buffer> {
    const attempts = Math.max(1, Math.min(5, Math.trunc(options.attempts ?? 5)));
    const retryDelayMs = Math.max(100, Math.min(15_000, Math.trunc(options.retryDelayMs ?? 2000)));
    let ultimoErro: any = null;

    for (let tentativa = 1; tentativa <= attempts; tentativa += 1) {
      try {
        return await this.downloadPdfOficial(chaveAcesso, pfxBase64, senhaCertificado, empresaId, options);
      } catch (error: any) {
        ultimoErro = error;
        if (tentativa < attempts && error?.retryable !== false) {
          await sleepWithJitter(tentativa, retryDelayMs);
        } else {
          break;
        }
      }
    }

    throw Object.assign(new Error('Nao foi possivel baixar o DANFSe oficial neste momento.'), {
      retryable: ultimoErro?.retryable !== false,
    });
  }

  async downloadPdfOficial(
    chaveAcesso: string,
    pfxBase64: string,
    senhaCertificado: string,
    empresaId?: string,
    options: PdfDownloadOptions = {},
  ): Promise<Buffer> {
    const chaveLimpa = normalizeNfseAccessKey(chaveAcesso);
    if (!chaveLimpa) {
      throw Object.assign(new Error('Chave de acesso invalida para download do DANFSe.'), { retryable: false });
    }

    const credenciais = openEmpresaCertificate({
      empresaId,
      certificadoA1: pfxBase64,
      senhaCertificado,
      expectedCnpj: options.expectedCnpj,
      requireTrustedChain: true,
      purpose: 'DOWNLOAD_PDF',
    });

    const url = `${ADN_DANFSE_BASE_URL}/${chaveLimpa}`;
    const timeoutMs = Math.max(3_000, Math.min(60_000, Math.trunc(options.requestTimeoutMs ?? 40_000)));

    const resposta = await requestPdfViaAdn(url, credenciais.cert, credenciais.key, timeoutMs);

    if (resposta.statusCode === 200) {
      if (!isPdf(resposta.body)) {
        throw Object.assign(new Error('A API DANFSe nao retornou um PDF valido.'), { retryable: false });
      }
      return resposta.body;
    }

    if (RETRYABLE_STATUS.has(resposta.statusCode)) {
      throw Object.assign(new Error('A API DANFSe esta temporariamente indisponivel.'), { retryable: true });
    }

    throw Object.assign(new Error('A API DANFSe recusou a solicitacao.'), { retryable: false });
  }
}
