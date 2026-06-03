import { chromium } from 'playwright';
import { openEmpresaCertificate } from '@/app/services/certificateVault';

export interface PdfDownloadOptions {
  navigationTimeoutMs?: number;
  authTimeoutMs?: number;
  actionTimeoutMs?: number;
  downloadTimeoutMs?: number;
  downloadNavigationTimeoutMs?: number;
}

export interface PdfDownloadRetryOptions extends PdfDownloadOptions {
  attempts?: number;
  retryDelayMs?: number;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class NfsePortalDownloader {
  async downloadPdfOficialComRetry(
    chaveAcesso: string,
    pfxBase64: string,
    senhaCertificado: string,
    empresaId?: string,
    options: PdfDownloadRetryOptions = {},
  ): Promise<Buffer> {
    const attempts = Math.max(1, options.attempts ?? 3);
    const retryDelayMs = options.retryDelayMs ?? 1500;
    let ultimoErro: any = null;

    for (let tentativa = 1; tentativa <= attempts; tentativa += 1) {
      try {
        console.log(`[BOT PDF] Tentativa ${tentativa}/${attempts} para chave ${chaveAcesso}.`);
        return await this.downloadPdfOficial(chaveAcesso, pfxBase64, senhaCertificado, empresaId, options);
      } catch (error: any) {
        ultimoErro = error;
        console.warn(`[BOT PDF] Tentativa ${tentativa}/${attempts} falhou: ${error.message}`);
        if (tentativa < attempts) {
          await delay(retryDelayMs);
        }
      }
    }

    throw new Error(`Portal Nacional instavel: nao foi possivel baixar o PDF apos ${attempts} tentativas. ${ultimoErro?.message || ''}`.trim());
  }

  async downloadPdfOficial(
    chaveAcesso: string,
    pfxBase64: string,
    senhaCertificado: string,
    empresaId?: string,
    options: PdfDownloadOptions = {},
  ): Promise<Buffer> {
    console.log(`[BOT] Iniciando download oficial para chave: ${chaveAcesso}`);

    const credenciais = openEmpresaCertificate({
      empresaId,
      certificadoA1: pfxBase64,
      senhaCertificado,
      purpose: 'DOWNLOAD_PDF',
    });

    const URL_LOGIN = 'https://www.nfse.gov.br/EmissorNacional/Login?ReturnUrl=%2fEmissorNacional';
    const URL_DOWNLOAD = `https://www.nfse.gov.br/EmissorNacional/Notas/Download/DANFSe/${chaveAcesso}`;
    const navigationTimeoutMs = options.navigationTimeoutMs ?? 30000;
    const authTimeoutMs = options.authTimeoutMs ?? 20000;
    const actionTimeoutMs = options.actionTimeoutMs ?? 6000;
    const downloadTimeoutMs = options.downloadTimeoutMs ?? 30000;
    const downloadNavigationTimeoutMs = options.downloadNavigationTimeoutMs ?? 15000;

    const browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    try {
      const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        ignoreHTTPSErrors: false,
        clientCertificates: [
          {
            origin: 'https://www.nfse.gov.br',
            cert: Buffer.from(credenciais.cert),
            key: Buffer.from(credenciais.key),
          },
        ],
      });

      const page = await context.newPage();
      page.setDefaultTimeout(actionTimeoutMs);

      console.log('[BOT] 1. Acessando pagina de Login...');
      await page.goto(URL_LOGIN, { timeout: navigationTimeoutMs, waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(500);

      console.log("[BOT] Clicando na opcao 'Certificado Digital'...");
      try {
        await page.click("img[src*='ertificado'], a[href*='Certificado']", { timeout: actionTimeoutMs });
      } catch {
        await page.getByText('ACESSO COM CERTIFICADO DIGITAL').first().click();
      }

      console.log('[BOT] Aguardando autenticacao...');
      await page.waitForTimeout(1000);

      try {
        await page.waitForURL((url) => !url.toString().includes('Login'), { timeout: authTimeoutMs });
        console.log('[BOT] Login detectado.');
      } catch {
        if (page.url().includes('Login')) {
          throw new Error('Falha no Login: o sistema nao saiu da tela de autenticacao.');
        }
      }

      console.log(`[BOT] 2. Acessando link direto: ${URL_DOWNLOAD}`);

      const downloadPromise = page.waitForEvent('download', { timeout: downloadTimeoutMs });

      try {
        await page.goto(URL_DOWNLOAD, { timeout: downloadNavigationTimeoutMs, waitUntil: 'domcontentloaded' });
      } catch {
        console.log('[BOT] Navegacao interrompida pelo inicio do download.');
      }

      const download = await downloadPromise;
      const fileStream = await download.createReadStream();
      const chunks = [];

      for await (const chunk of fileStream) {
        chunks.push(chunk);
      }

      const pdfBuffer = Buffer.concat(chunks);
      console.log(`[BOT] PDF capturado (${pdfBuffer.length} bytes).`);

      return pdfBuffer;
    } catch (error: any) {
      console.error('[BOT CRITICAL]', error.message);
      throw new Error(`Erro no robo: ${error.message}`);
    } finally {
      await browser.close();
    }
  }
}
