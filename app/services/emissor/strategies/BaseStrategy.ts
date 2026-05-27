import { IEmissorStrategy, IDadosEmissao, IResultadoEmissao, IResultadoConsulta, IResultadoCancelamento } from '../interfaces/IEmissorStrategy';
import crypto from 'crypto';
import axios from 'axios';
import https from 'https';
import zlib from 'zlib';
import { openEmpresaCertificate } from '@/app/services/certificateVault';

const URL_HOMOLOGACAO = 'https://sefin.producaorestrita.nfse.gov.br/SefinNacional/nfse';
const URL_PRODUCAO = 'https://sefin.nfse.gov.br/SefinNacional/nfse';

type CertificatePurpose = 'SIGN_XML' | 'TRANSMIT_XML' | 'CONSULT_NFSE' | 'CANCEL_NFSE' | 'SIGN_CANCEL' | 'DOWNLOAD_PDF' | 'VALIDATE_CERT';

export abstract class BaseStrategy {
  abstract executar(dados: IDadosEmissao): Promise<IResultadoEmissao>;
  abstract consultar(chave: string, empresa: any): Promise<IResultadoConsulta>;
  abstract cancelar(chave: string, protocolo: string, motivo: string, empresa: any): Promise<IResultadoCancelamento>;

  protected cleanString(str: string | null): string {
    return str ? str.replace(/\D/g, '') : '';
  }

  protected formatarDataSefaz(date: Date): string {
    const timestamp = date.getTime();
    const offsetBrasilia = -3 * 60 * 60 * 1000;
    const dateBR = new Date(timestamp + offsetBrasilia);

    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${dateBR.getUTCFullYear()}-${pad(dateBR.getUTCMonth() + 1)}-${pad(dateBR.getUTCDate())}T${pad(dateBR.getUTCHours())}:${pad(dateBR.getUTCMinutes())}:${pad(dateBR.getUTCSeconds())}-03:00`;
  }

  protected validarCertificado(prestador: any) {
    if (!prestador.certificadoA1 || !prestador.senhaCertificado) {
      throw new Error('Certificado Digital A1 nao configurado para esta empresa.');
    }
  }

  protected validarTomador(tomador: any) {
    if (tomador.tipo !== 'EXT' && !tomador.documento) {
      throw new Error('CPF/CNPJ do tomador e obrigatorio para clientes no Brasil.');
    }
    if (!tomador.razaoSocial) throw new Error('Nome/Razao Social do tomador e obrigatorio.');
  }

  protected extrairCredenciais(empresa: any, purpose: CertificatePurpose) {
    return openEmpresaCertificate({
      empresaId: empresa?.id,
      certificadoA1: empresa?.certificadoA1,
      senhaCertificado: empresa?.senhaCertificado,
      purpose,
    });
  }

  protected assinarXML(xml: string, tagId: string, empresa: any): string {
    try {
      const credenciais = this.extrairCredenciais(empresa, 'SIGN_XML');

      const certClean = credenciais.cert
        .replace('-----BEGIN CERTIFICATE-----', '')
        .replace('-----END CERTIFICATE-----', '')
        .replace(/[\r\n]/g, '');

      let nodeToSign = '';
      const matchDPS = xml.match(/<infDPS[\s\S]*?<\/infDPS>/);
      const matchEvento = xml.match(/<infPedReg[\s\S]*?<\/infPedReg>/);

      if (matchDPS) {
        nodeToSign = matchDPS[0];
      } else if (matchEvento) {
        nodeToSign = matchEvento[0];
      } else {
        throw new Error('Nenhum bloco assinavel encontrado no XML.');
      }

      if (!nodeToSign.includes('xmlns="http://www.sped.fazenda.gov.br/nfse"')) {
        nodeToSign = nodeToSign.replace(/<(\w+)/, '<$1 xmlns="http://www.sped.fazenda.gov.br/nfse"');
      }

      const shasum = crypto.createHash('sha256');
      shasum.update(nodeToSign, 'utf8');
      const digestValue = shasum.digest('base64');

      const signedInfoContent =
        `<CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"></CanonicalizationMethod>` +
        `<SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#rsa-sha256"></SignatureMethod>` +
        `<Reference URI="#${tagId}">` +
        `<Transforms>` +
        `<Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"></Transform>` +
        `<Transform Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"></Transform>` +
        `</Transforms>` +
        `<DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"></DigestMethod>` +
        `<DigestValue>${digestValue}</DigestValue>` +
        `</Reference>`;

      const signedInfoToSign = `<SignedInfo xmlns="http://www.w3.org/2000/09/xmldsig#">${signedInfoContent}</SignedInfo>`;

      const signer = crypto.createSign('RSA-SHA256');
      signer.update(signedInfoToSign);
      const signatureValue = signer.sign(credenciais.key, 'base64');

      const signatureXML = `<Signature xmlns="http://www.w3.org/2000/09/xmldsig#"><SignedInfo>${signedInfoContent}</SignedInfo><SignatureValue>${signatureValue}</SignatureValue><KeyInfo><X509Data><X509Certificate>${certClean}</X509Certificate></X509Data></KeyInfo></Signature>`;

      if (xml.includes('</DPS>')) {
        return xml.replace('</DPS>', `${signatureXML}</DPS>`);
      }
      if (xml.includes('</pedRegEvento>')) {
        return xml.replace('</pedRegEvento>', `${signatureXML}</pedRegEvento>`);
      }
      return xml + signatureXML;
    } catch (e: any) {
      throw new Error(`Erro assinatura: ${e.message}`);
    }
  }

  protected async transmitirXML(xmlAssinado: string, prestador: any): Promise<IResultadoEmissao> {
    try {
      const credenciais = this.extrairCredenciais(prestador, 'TRANSMIT_XML');

      const httpsAgent = new https.Agent({
        cert: credenciais.cert,
        key: credenciais.key,
        rejectUnauthorized: true,
        keepAlive: true,
        family: 4,
      });

      const url = prestador.ambiente === 'PRODUCAO' ? URL_PRODUCAO : URL_HOMOLOGACAO;
      console.log(`[STRATEGY] Enviando para: ${url}`);

      const xmlBuffer = Buffer.from(xmlAssinado, 'utf-8');
      const xmlGzip = zlib.gzipSync(xmlBuffer);
      const arquivoBase64 = xmlGzip.toString('base64');
      const auth = Buffer.from(`${this.cleanString(prestador.documento)}:${credenciais.senha}`).toString('base64');

      const response = await axios.post(
        url,
        { dpsXmlGZipB64: arquivoBase64 },
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Basic ${auth}`,
          },
          httpsAgent,
          timeout: 60000,
        },
      );

      const data = response.data;

      if (data.erros && data.erros.length > 0) {
        return {
          sucesso: false,
          xmlGerado: xmlAssinado,
          erros: data.erros,
          motivo: 'Rejeicao pelo Portal Nacional',
        };
      }

      return {
        sucesso: true,
        xmlGerado: xmlAssinado,
        numeroNota: data.numeroNfse || 'PENDENTE',
        protocolo: data.protocolo || 'SEM_PROTOCOLO',
        xmlDistribuicao: data.nfseXmlGZipB64 || arquivoBase64,
        notaGov: {
          numero: data.numeroNfse || 'PENDENTE',
          chave: data.chaveAcesso,
          protocolo: data.protocolo,
          xml: data.nfseXmlGZipB64 || data.xmlProcessado,
        },
      } as any;
    } catch (error: any) {
      let erroMsg = error.message;
      let detalhes = {};

      if (error.response) {
        erroMsg = `Erro HTTP ${error.response.status}: ${error.response.statusText}`;
        detalhes = error.response.data || {};
      }

      return {
        sucesso: false,
        motivo: erroMsg,
        xmlGerado: xmlAssinado,
        erros: [{ codigo: 'API_ERR', mensagem: detalhes }],
      };
    }
  }
}
