import https from 'https';
import { openEmpresaCertificate } from '@/app/services/certificateVault';

export interface PdfDownloadOptions {
  requestTimeoutMs?: number;
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

function resumirResposta(buffer: Buffer) {
  return buffer
    .subarray(0, 500)
    .toString('utf8')
    .replace(/\s+/g, ' ')
    .trim();
}

function requestPdfViaAdn(url: string, cert: string, key: string, timeoutMs: number): Promise<PdfApiResult> {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        cert,
        key,
        timeout: timeoutMs,
        headers: {
          Accept: 'application/pdf',
          Connection: 'close',
          'User-Agent': 'nfsegoo-danfse/1.0',
        },
      },
      (res) => {
        const chunks: Buffer[] = [];

        res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode || 0,
            contentType: String(res.headers['content-type'] || ''),
            body: Buffer.concat(chunks),
          });
        });
      },
    );

    req.on('timeout', () => {
      req.destroy(new Error(`Timeout ${timeoutMs}ms ao chamar API ADN DANFSe.`));
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
    const attempts = Math.max(1, options.attempts ?? 5);
    const retryDelayMs = options.retryDelayMs ?? 2000;
    let ultimoErro: any = null;

    for (let tentativa = 1; tentativa <= attempts; tentativa += 1) {
      try {
        console.log(`[PDF ADN] Tentativa ${tentativa}/${attempts} para chave ${chaveAcesso}.`);
        return await this.downloadPdfOficial(chaveAcesso, pfxBase64, senhaCertificado, empresaId, options);
      } catch (error: any) {
        ultimoErro = error;
        console.warn(`[PDF ADN] Tentativa ${tentativa}/${attempts} falhou: ${error.message}`);
        if (tentativa < attempts) {
          await sleepWithJitter(tentativa, retryDelayMs);
        }
      }
    }

    throw new Error(`API ADN instavel: nao foi possivel baixar o PDF apos ${attempts} tentativas. ${ultimoErro?.message || ''}`.trim());
  }

  async downloadPdfOficial(
    chaveAcesso: string,
    pfxBase64: string,
    senhaCertificado: string,
    empresaId?: string,
    options: PdfDownloadOptions = {},
  ): Promise<Buffer> {
    const chaveLimpa = String(chaveAcesso || '').replace(/\D/g, '');
    if (!chaveLimpa) {
      throw new Error('Chave de acesso ausente para download do DANFSe.');
    }

    const credenciais = openEmpresaCertificate({
      empresaId,
      certificadoA1: pfxBase64,
      senhaCertificado,
      purpose: 'DOWNLOAD_PDF',
    });

    const url = `${ADN_DANFSE_BASE_URL}/${chaveLimpa}`;
    const timeoutMs = options.requestTimeoutMs ?? 40000;

    console.log(`[PDF ADN] Baixando DANFSe via API: ${url}`);
    const resposta = await requestPdfViaAdn(url, credenciais.cert, credenciais.key, timeoutMs);
    console.log(`[PDF ADN] HTTP ${resposta.statusCode} | content-type: ${resposta.contentType} | bytes: ${resposta.body.length}`);

    if (resposta.statusCode === 200) {
      if (!isPdf(resposta.body)) {
        throw new Error(`API ADN retornou HTTP 200, mas o conteudo nao parece PDF. content-type=${resposta.contentType}; inicio=${resumirResposta(resposta.body)}`);
      }
      return resposta.body;
    }

    if (RETRYABLE_STATUS.has(resposta.statusCode)) {
      throw new Error(`API ADN retornou status temporario ${resposta.statusCode}. content-type=${resposta.contentType}; inicio=${resumirResposta(resposta.body)}`);
    }

    throw new Error(`API ADN retornou status ${resposta.statusCode}. content-type=${resposta.contentType}; inicio=${resumirResposta(resposta.body)}`);
  }
}
