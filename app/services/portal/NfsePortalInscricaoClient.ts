import { existsSync } from 'fs';
import puppeteer from 'puppeteer';
import { chromium, type Browser } from 'playwright';
import { openEmpresaCertificate } from '@/app/services/certificateVault';

const URL_LOGIN = 'https://www.nfse.gov.br/EmissorNacional/Login?ReturnUrl=%2fEmissorNacional';
const URL_CERTIFICADO = 'https://certificado.nfse.gov.br/EmissorNacional/Certificado';
const PORTAL_ORIGIN = 'https://www.nfse.gov.br';
const CERTIFICADO_ORIGIN = 'https://certificado.nfse.gov.br';

interface PortalInscricaoResponse {
  inscricao?: string;
  nomerazaosocial?: string;
  nomeRazaoSocial?: string;
  codigopais?: number;
  codigoPais?: number;
}

export interface PortalInscricaoInfo {
  cpf: string;
  inscricao: string;
  nomeRazaoSocial: string;
  codigoPais: number | null;
  dataConsulta: string;
}

export interface PortalInscricaoOptions {
  navigationTimeoutMs?: number;
  authTimeoutMs?: number;
  actionTimeoutMs?: number;
}

function hojeSaoPaulo() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function maskCpf(cpf: string) {
  return `***.***.***-${cpf.slice(-2)}`;
}

function resolveChromiumExecutable() {
  const candidates: Array<string | undefined> = [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    process.env.PUPPETEER_EXECUTABLE_PATH,
  ];

  try {
    candidates.push(chromium.executablePath());
  } catch {
    // O Playwright pode estar instalado sem o navegador no servidor.
  }

  try {
    candidates.push(puppeteer.executablePath());
  } catch {
    // O Puppeteer tambem pode estar instalado sem o Chrome baixado.
  }

  if (process.platform !== 'win32') {
    candidates.push(
      '/usr/bin/google-chrome-stable',
      '/usr/bin/google-chrome',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
    );
  }

  return candidates.find((candidate) => !!candidate && existsSync(candidate));
}

function isPortalAuthenticated(urlValue: URL) {
  const path = urlValue.pathname.toLowerCase();
  return urlValue.origin === PORTAL_ORIGIN
    && path.startsWith('/emissornacional')
    && !path.includes('/login')
    && !path.includes('/acesso/');
}

export class NfsePortalInscricaoClient {
  async recuperarInfoInscricao(
    cpf: string,
    pfxBase64: string,
    senhaCertificado: string,
    empresaId?: string,
    dataConsulta = hojeSaoPaulo(),
    options: PortalInscricaoOptions = {},
  ): Promise<PortalInscricaoInfo> {
    const cpfLimpo = cpf.replace(/\D/g, '');
    if (cpfLimpo.length !== 11) {
      throw new Error('CPF invalido para consulta no Portal Nacional.');
    }

    console.log(`[BOT CPF] Iniciando consulta oficial da inscricao: ${maskCpf(cpfLimpo)}`);

    const credenciais = openEmpresaCertificate({
      empresaId,
      certificadoA1: pfxBase64,
      senhaCertificado,
      purpose: 'CONSULT_CPF_INSCRICAO',
    });

    const urlConsulta = `https://www.nfse.gov.br/emissornacional/api/EmissaoDPS/RecuperarInfoInscricao/${cpfLimpo}?data=${dataConsulta}`;
    const navigationTimeoutMs = options.navigationTimeoutMs ?? 30000;
    const authTimeoutMs = options.authTimeoutMs ?? 20000;
    const actionTimeoutMs = options.actionTimeoutMs ?? 5000;

    let browser: Browser | null = null;

    try {
      const executablePath = resolveChromiumExecutable();
      if (!executablePath) {
        throw new Error('Navegador automatizado indisponivel no servidor. Instale o Chromium do Playwright ou configure PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH.');
      }

      browser = await chromium.launch({
        executablePath,
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      });

      const cert = Buffer.from(credenciais.cert);
      const key = Buffer.from(credenciais.key);
      const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        ignoreHTTPSErrors: false,
        clientCertificates: [
          {
            origin: PORTAL_ORIGIN,
            cert,
            key,
          },
          {
            // O botao de certificado do Portal Nacional autentica neste subdominio.
            // O Playwright exige correspondencia exata da origem para enviar o A1.
            origin: CERTIFICADO_ORIGIN,
            cert,
            key,
          },
        ],
      });

      const page = await context.newPage();
      page.setDefaultTimeout(actionTimeoutMs);

      console.log('[BOT CPF] 1. Acessando pagina de login...');
      await page.goto(URL_LOGIN, { timeout: navigationTimeoutMs, waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(500);

      console.log("[BOT CPF] Clicando na opcao 'Certificado Digital'...");
      const acessoCertificado = page.locator(`a[href="${URL_CERTIFICADO}"]`).first();
      if (await acessoCertificado.count() === 0) {
        throw new Error('O Portal Nacional alterou o link de acesso por certificado digital.');
      }
      await acessoCertificado.click({ timeout: actionTimeoutMs });

      console.log('[BOT CPF] Aguardando autenticacao...');
      try {
        await page.waitForURL(isPortalAuthenticated, {
          timeout: authTimeoutMs,
          waitUntil: 'domcontentloaded',
        });
        console.log('[BOT CPF] Login detectado.');
      } catch {
        const currentUrl = new URL(page.url());
        throw new Error(`Falha no login por certificado digital. O portal permaneceu em ${currentUrl.origin}${currentUrl.pathname}.`);
      }

      console.log(`[BOT CPF] 2. Consultando inscricao: ${maskCpf(cpfLimpo)}`);
      // A API interna valida a sessao do navegador. O cliente HTTP isolado do
      // Playwright recebe 403 mesmo compartilhando os cookies do contexto.
      const retorno = await page.evaluate(async (url) => {
        const response = await fetch(url, {
          credentials: 'include',
          cache: 'no-store',
          headers: { Accept: 'application/json' },
        });
        return {
          ok: response.ok,
          status: response.status,
          text: await response.text(),
        };
      }, urlConsulta);

      if (!retorno.ok) {
        if (retorno.status === 401) {
          throw new Error('A sessao autenticada no Portal Nacional nao foi reconhecida pela API de inscricao.');
        }
        if (retorno.status === 403) {
          throw new Error('O Portal Nacional recusou a consulta. Confirme o CPF e a permissao do certificado digital.');
        }
        throw new Error(`Portal Nacional retornou HTTP ${retorno.status}.`);
      }

      let dados: PortalInscricaoResponse;
      try {
        dados = JSON.parse(retorno.text);
      } catch {
        throw new Error('Portal Nacional retornou uma resposta invalida para inscricao.');
      }

      const nomeRazaoSocial = String(dados.nomerazaosocial || dados.nomeRazaoSocial || '').trim();
      if (!nomeRazaoSocial) {
        throw new Error('Portal Nacional nao retornou o nome/razao social para este CPF.');
      }

      const codigoPais = dados.codigopais ?? dados.codigoPais;

      return {
        cpf: cpfLimpo,
        inscricao: String(dados.inscricao || cpfLimpo),
        nomeRazaoSocial,
        codigoPais: typeof codigoPais === 'number' ? codigoPais : null,
        dataConsulta,
      };
    } catch (error: any) {
      console.error('[BOT CPF CRITICAL]', error.message);
      throw new Error(`Erro no robo de consulta CPF: ${error.message}`);
    } finally {
      await browser?.close();
    }
  }
}
