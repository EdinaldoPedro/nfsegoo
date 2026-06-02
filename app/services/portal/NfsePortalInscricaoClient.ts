import { chromium } from 'playwright';
import { openEmpresaCertificate } from '@/app/services/certificateVault';

const URL_LOGIN = 'https://www.nfse.gov.br/EmissorNacional/Login?ReturnUrl=%2fEmissorNacional';

interface PortalInscricaoResponse {
  inscricao?: string;
  nomerazaosocial?: string;
  codigopais?: number;
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

    console.log(`[BOT CPF] Iniciando consulta oficial da inscricao: ${cpfLimpo}`);

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

      console.log('[BOT CPF] 1. Acessando pagina de login...');
      await page.goto(URL_LOGIN, { timeout: navigationTimeoutMs, waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(500);

      console.log("[BOT CPF] Clicando na opcao 'Certificado Digital'...");
      try {
        await page.click("img[src*='ertificado'], a[href*='Certificado']", { timeout: actionTimeoutMs });
      } catch {
        await page.getByText('ACESSO COM CERTIFICADO DIGITAL').first().click();
      }

      console.log('[BOT CPF] Aguardando autenticacao...');
      await page.waitForTimeout(1000);

      try {
        await page.waitForURL((url) => !url.toString().includes('Login'), { timeout: authTimeoutMs });
        console.log('[BOT CPF] Login detectado.');
      } catch {
        if (page.url().includes('Login')) {
          throw new Error('Falha no Login: o sistema nao saiu da tela de autenticacao.');
        }
      }

      console.log(`[BOT CPF] 2. Consultando inscricao: ${urlConsulta}`);
      const retorno = await page.evaluate(async (url) => {
        const response = await fetch(url, {
          credentials: 'include',
          headers: { Accept: 'application/json' },
        });
        return {
          ok: response.ok,
          status: response.status,
          text: await response.text(),
        };
      }, urlConsulta);

      if (!retorno.ok) {
        throw new Error(`Portal Nacional retornou HTTP ${retorno.status}.`);
      }

      let dados: PortalInscricaoResponse;
      try {
        dados = JSON.parse(retorno.text);
      } catch {
        throw new Error('Portal Nacional retornou uma resposta invalida para inscricao.');
      }

      const nomeRazaoSocial = dados.nomerazaosocial?.trim();
      if (!nomeRazaoSocial) {
        throw new Error('Portal Nacional nao retornou o nome/razao social para este CPF.');
      }

      return {
        cpf: cpfLimpo,
        inscricao: dados.inscricao || cpfLimpo,
        nomeRazaoSocial,
        codigoPais: typeof dados.codigopais === 'number' ? dados.codigopais : null,
        dataConsulta,
      };
    } catch (error: any) {
      console.error('[BOT CPF CRITICAL]', error.message);
      throw new Error(`Erro no robo de consulta CPF: ${error.message}`);
    } finally {
      await browser.close();
    }
  }
}
