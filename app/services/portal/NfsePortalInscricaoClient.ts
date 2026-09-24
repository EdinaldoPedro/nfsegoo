import { existsSync } from 'fs';
import path from 'node:path';
import { chromium, type Browser } from 'playwright';
import { openEmpresaCertificate } from '@/app/services/certificateVault';
import { validarCPF } from '@/app/utils/cpf';

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
  expectedCnpj?: string;
}

function hojeSaoPaulo() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function resolveChromiumLaunchOptions(): { executablePath?: string } | null {
  const candidates: Array<string | undefined> = [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    process.env.PUPPETEER_EXECUTABLE_PATH,
  ];

  const configured = candidates.find((candidate) => !!candidate && existsSync(candidate));
  if (configured) return { executablePath: configured };

  try {
    // Let Playwright launch its own bundled Chromium by default. Passing that
    // same path explicitly causes spawn UNKNOWN on some Windows installations.
    if (existsSync(chromium.executablePath())) return {};
  } catch {
    // O Playwright pode estar instalado sem o navegador no servidor.
  }

  if (process.platform === 'win32') {
    const programFiles = process.env.PROGRAMFILES;
    const programFilesX86 = process.env['PROGRAMFILES(X86)'];
    const localAppData = process.env.LOCALAPPDATA;
    candidates.push(
      programFiles && path.join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      programFilesX86 && path.join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      localAppData && path.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      programFiles && path.join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      programFilesX86 && path.join(programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    );
  } else {
    candidates.push(
      '/usr/bin/google-chrome-stable',
      '/usr/bin/google-chrome',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
    );
  }

  const fallback = candidates.find((candidate) => !!candidate && existsSync(candidate));
  return fallback ? { executablePath: fallback } : null;
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
    if (!validarCPF(cpfLimpo)) {
      throw new Error('CPF invalido para consulta no Portal Nacional.');
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dataConsulta) || !Number.isFinite(new Date(`${dataConsulta}T12:00:00Z`).getTime())) {
      throw new Error('Data de consulta invalida.');
    }

    const credenciais = openEmpresaCertificate({
      empresaId,
      certificadoA1: pfxBase64,
      senhaCertificado,
      expectedCnpj: options.expectedCnpj,
      requireTrustedChain: true,
      purpose: 'CONSULT_CPF_INSCRICAO',
    });

    const urlConsulta = `https://www.nfse.gov.br/emissornacional/api/EmissaoDPS/RecuperarInfoInscricao/${cpfLimpo}?data=${dataConsulta}`;
    const bounded = (value: number | undefined, fallback: number, min: number, max: number) => Math.max(min, Math.min(max, Math.trunc(value ?? fallback)));
    const navigationTimeoutMs = bounded(options.navigationTimeoutMs, 30_000, 5_000, 35_000);
    const authTimeoutMs = bounded(options.authTimeoutMs, 20_000, 5_000, 25_000);
    const actionTimeoutMs = bounded(options.actionTimeoutMs, 5_000, 1_000, 8_000);

    let browser: Browser | null = null;

    try {
      const launchOptions = resolveChromiumLaunchOptions();
      if (!launchOptions) {
        throw new Error('Navegador automatizado indisponivel no servidor. Instale o Chromium do Playwright ou configure PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH.');
      }

      browser = await chromium.launch({
        ...launchOptions,
        headless: true,
        args: ['--disable-dev-shm-usage'],
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

      await page.goto(URL_LOGIN, { timeout: navigationTimeoutMs, waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(500);

      const acessoCertificado = page.locator(`a[href="${URL_CERTIFICADO}"]`).first();
      if (await acessoCertificado.count() === 0) {
        throw new Error('O Portal Nacional alterou o link de acesso por certificado digital.');
      }
      await acessoCertificado.click({ timeout: actionTimeoutMs });

      try {
        await page.waitForURL(isPortalAuthenticated, {
          timeout: authTimeoutMs,
          waitUntil: 'domcontentloaded',
        });
      } catch {
        throw new Error('Falha no login por certificado digital no Portal Nacional.');
      }

      // A API interna valida a sessao do navegador. O cliente HTTP isolado do
      // Playwright recebe 403 mesmo compartilhando os cookies do contexto.
      const retorno = await page.evaluate(async (url) => {
        const response = await fetch(url, {
          credentials: 'include',
          cache: 'no-store',
          headers: { Accept: 'application/json' },
        });
        const declaredLength = Number(response.headers.get('content-length') || 0);
        if (Number.isFinite(declaredLength) && declaredLength > 256 * 1024) return { ok: false, status: 502, text: '' };
        const text = await response.text();
        return {
          ok: response.ok,
          status: response.status,
          text: text.length <= 256 * 1024 ? text : '',
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
      // eslint-disable-next-line no-control-regex -- dados cadastrais remotos não podem conter bytes de controle.
      if (!nomeRazaoSocial || nomeRazaoSocial.length > 200 || /[\u0000-\u001f\u007f]/.test(nomeRazaoSocial)) {
        throw new Error('Portal Nacional nao retornou o nome/razao social para este CPF.');
      }

      const codigoPais = dados.codigopais ?? dados.codigoPais;

      return {
        cpf: cpfLimpo,
        inscricao: String(dados.inscricao || cpfLimpo).slice(0, 40),
        nomeRazaoSocial,
        codigoPais: typeof codigoPais === 'number' && Number.isSafeInteger(codigoPais) ? codigoPais : null,
        dataConsulta,
      };
    } catch (error) {
      throw new Error('Nao foi possivel concluir a consulta de CPF no Portal Nacional.', { cause: error });
    } finally {
      await browser?.close();
    }
  }
}
