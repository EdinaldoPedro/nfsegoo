import { IEmissorStrategy, IDadosEmissao, IResultadoEmissao, IResultadoConsulta, IResultadoCancelamento } from '../interfaces/IEmissorStrategy';
import { signFiscalXml, verifiedFiscalReference } from '../validation/FiscalSignature';
import { validateFiscalSchema } from '../validation/FiscalSchema';
import axios from 'axios';
import https from 'https';
import zlib from 'zlib';
import { classifyPortalRejection } from '@/app/utils/emission-outcome';
import { preparedDpsId, validateAuthorizedNfse, validateNfseDocument } from '../validation/AuthorizedNfseValidator';
import { prepareCancellationRequest, validateCancellationEvent, type CancellationReason } from '../validation/CancellationEvent';
import { directElement, fiscalEnvironment } from '../validation/FiscalXml';
import { normalizeCnpj } from '@/app/utils/cnpj';
import { openEmpresaCertificate } from '@/app/services/certificateVault';
import { isNfseAccessKey } from '@/app/utils/fiscal-identifiers';

const URL_HOMOLOGACAO = 'https://sefin.producaorestrita.nfse.gov.br/SefinNacional/nfse';
const URL_PRODUCAO = 'https://sefin.nfse.gov.br/SefinNacional/nfse';

type CertificatePurpose = 'SIGN_XML' | 'TRANSMIT_XML' | 'CONSULT_NFSE' | 'CANCEL_NFSE' | 'SIGN_CANCEL' | 'DOWNLOAD_PDF' | 'VALIDATE_CERT' | 'CONSULT_DPS';

export abstract class BaseStrategy {
  abstract preparar(dados: IDadosEmissao): Promise<string>;

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
      throw Object.assign(new Error('Certificado Digital A1 nao configurado para esta empresa.'), { status: 400 });
    }
  }

  protected validarTomador(tomador: any) {
    if (tomador.tipo !== 'EXT' && !tomador.documento) {
      throw Object.assign(new Error('CPF/CNPJ do tomador e obrigatorio para clientes no Brasil.'), { status: 400 });
    }
    if (!tomador.razaoSocial) throw Object.assign(new Error('Nome/Razao Social do tomador e obrigatorio.'), { status: 400 });
  }

  protected extrairCredenciais(empresa: any, purpose: CertificatePurpose) {
    return openEmpresaCertificate({
      empresaId: empresa?.id,
      certificadoA1: empresa?.certificadoA1,
      senhaCertificado: empresa?.senhaCertificado,
      expectedCnpj: empresa?.documento,
      requireTrustedChain: empresa?.ambiente === 'PRODUCAO',
      purpose,
    });
  }

  protected assinarXML(xml: string, tagId: string, empresa: any): string {
    try {
      if (preparedDpsId(xml) !== tagId) throw new Error('DPS divergente.');
      return signFiscalXml(xml, 'DPS', this.extrairCredenciais(empresa, 'SIGN_XML'));
    } catch (error) {
      throw Object.assign(new Error('Não foi possível assinar a DPS. Revise o certificado e sua validade.', { cause: error }), { status: 400 });
    }
  }

  protected async portalRequest(empresa: any, method: 'GET' | 'POST', path: string, body?: unknown) {
    if (!['PRODUCAO', 'HOMOLOGACAO'].includes(empresa.ambiente)) throw new Error('Ambiente fiscal inválido.');
    const credentials = this.extrairCredenciais(empresa, method === 'POST' ? 'TRANSMIT_XML' : 'CONSULT_DPS');
    const agent = new https.Agent({ cert: credentials.cert, key: credentials.key, rejectUnauthorized: true, family: 4 });
    const base = (empresa.ambiente === 'PRODUCAO' ? URL_PRODUCAO : URL_HOMOLOGACAO).replace(/\/nfse$/, '');
    try {
      return await axios.request({
        method, url: base + path, data: body, httpsAgent: agent,
        headers: { 'Content-Type': 'application/json' },
        timeout: 30_000, maxRedirects: 0, maxContentLength: 6 * 1024 * 1024, maxBodyLength: 6 * 1024 * 1024,
        validateStatus: () => true,
      });
    } finally { agent.destroy(); }
  }

  async transmitirPreparado(xmlAssinado: string, prestador: any): Promise<IResultadoEmissao> {
    try {
      await validateFiscalSchema(xmlAssinado, 'DPS');
      verifiedFiscalReference(xmlAssinado, 'DPS');
    } catch {
      // No network request has happened in this invocation.
      return { sucesso: false, failureKind: 'LOCAL_REJECTION', motivo: 'DPS preparada inválida; nenhum envio realizado.' };
    }
    try {
      preparedDpsId(xmlAssinado);
      const response = await this.portalRequest(prestador, 'POST', '/nfse',
        { dpsXmlGZipB64: zlib.gzipSync(Buffer.from(xmlAssinado)).toString('base64') });
      const data = response.data;
      if (response.status >= 200 && response.status < 300 && !data?.erros?.length) {
        const notaGov = await validateAuthorizedNfse(data?.nfseXmlGZipB64 || data?.xmlProcessado, xmlAssinado, prestador.ambiente, data?.chaveAcesso);
        return { sucesso: true, notaGov };
      }
      return { sucesso: false, failureKind: classifyPortalRejection(response.status, data?.erros),
        motivo: 'Resposta do Portal Nacional requer verificação.', erros: safePortalErrors(data?.erros) };
    } catch {
      // Never serialize Axios errors: config contains certificate/private key.
      return { sucesso: false, failureKind: 'UNKNOWN', motivo: 'Não foi possível confirmar o resultado do envio.' };
    }
  }

  async conciliarDps(xmlAssinado: string, prestador: any): Promise<IResultadoEmissao> {
    try {
      const id = preparedDpsId(xmlAssinado);
      const dpsResponse = await this.portalRequest(prestador, 'GET', '/dps/' + id);
      const chave = dpsResponse.data?.chaveAcesso;
      if (dpsResponse.status !== 200 || !isNfseAccessKey(chave)) {
        return { sucesso: false, failureKind: 'UNKNOWN', motivo: 'DPS ainda não conciliada no Portal Nacional.' };
      }
      const response = await this.portalRequest(prestador, 'GET', '/nfse/' + chave);
      if (response.status !== 200) return { sucesso: false, failureKind: 'UNKNOWN', motivo: 'XML oficial ainda não recuperado.' };
      const notaGov = await validateAuthorizedNfse(response.data?.nfseXmlGZipB64 || response.data?.xmlProcessado || response.data, xmlAssinado, prestador.ambiente, chave);
      return { sucesso: true, notaGov };
    } catch {
      return { sucesso: false, failureKind: 'UNKNOWN', motivo: 'Não foi possível confirmar a DPS original. Não reenvie a venda.' };
    }
  }

  private async cancellationEvents(chave: string, empresa: any) {
    if (!isNfseAccessKey(chave)) throw new Error('Chave inválida.');
    const results = await Promise.all(['101101', '105102', '105104', '305101'].map(async (type) => {
      try {
        const response = await this.portalRequest(empresa, 'GET', `/nfse/${chave}/eventos/${type}/1`);
        if (response.status === 404) return { absent: true };
        if (response.status !== 200) return { absent: false };
        const event = await validateCancellationEvent(response.data?.eventoXmlGZipB64 || response.data, { key: chave, ambiente: empresa.ambiente });
        if (event.type !== type) return { absent: false };
        return { absent: false, event };
      } catch { return { absent: false }; }
    }));
    return { event: results.find((result) => result.event)?.event, complete: results.every((result) => result.absent || result.event) };
  }

  async consultar(chave: string, empresa: any): Promise<IResultadoConsulta> {
    try {
      if (!isNfseAccessKey(chave)) throw new Error('Chave inválida.');
      const response = await this.portalRequest(empresa, 'GET', `/nfse/${chave}`);
      if (response.status !== 200) throw new Error('Documento não recuperado.');
      const document = await validateNfseDocument(response.data?.nfseXmlGZipB64 || response.data, empresa.ambiente, chave, empresa.documento);
      const { event, complete } = await this.cancellationEvents(chave, empresa);
      if (!event && !complete) return { sucesso: false, situacao: 'ERRO', motivo: 'A consulta de eventos fiscais não foi concluída. Situação local preservada.' };
      return { sucesso: true, situacao: event ? 'CANCELADA' : 'AUTORIZADA', numeroNota: document.numero,
        protocolo: document.protocolo, xmlDistribuicao: document.xml, xmlEvento: event?.xmlEvento, dataCancelamento: event?.dataCancelamento };
    } catch { return { sucesso: false, situacao: 'ERRO', motivo: 'Não foi possível confirmar a situação fiscal. Nenhum documento local foi substituído.' }; }
  }

  async prepararCancelamento(chave: string, reason: CancellationReason, timestamp: Date, empresa: any) {
    this.validarCertificado(empresa);
    let credentials;
    try { credentials = this.extrairCredenciais(empresa, 'SIGN_CANCEL'); }
    catch { throw Object.assign(new Error('Certificado indisponível para assinatura. Revise o certificado antes de nova solicitação.'), { status: 400 }); }
    return prepareCancellationRequest({ key: chave, ambiente: empresa.ambiente, authorDocument: empresa.documento, reason, timestamp }, credentials);
  }

  async transmitirCancelamento(xml: string, chave: string, empresa: any): Promise<IResultadoCancelamento> {
    try {
      await validateFiscalSchema(xml, 'pedRegEvento');
      const request = verifiedFiscalReference(xml, 'pedRegEvento');
      if (!isNfseAccessKey(chave) || directElement(request, 'chNFSe').textContent !== chave) throw new Error('Chave divergente.');
      if (directElement(request, 'tpAmb').textContent !== fiscalEnvironment(empresa.ambiente)
        || directElement(request, 'CNPJAutor').textContent !== normalizeCnpj(empresa.documento)
        || request.getAttribute('Id') !== `PRE${chave}101101`) throw new Error('Autor, ambiente ou tipo de evento divergente.');
      directElement(request, 'e101101');
    } catch { return { sucesso: false, failureKind: 'LOCAL_REJECTION', motivo: 'Pedido de cancelamento inválido; nenhum envio realizado.' }; }
    try {
      const response = await this.portalRequest(empresa, 'POST', `/nfse/${chave}/eventos`, { pedidoRegistroEventoXmlGZipB64: zlib.gzipSync(Buffer.from(xml)).toString('base64') });
      if (response.status >= 200 && response.status < 300) {
        // Never accept an echoed pedRegEvento as an authorized evento.
        const event = await validateCancellationEvent(response.data?.eventoXmlGZipB64, { key: chave, ambiente: empresa.ambiente, preparedRequest: xml });
        return { sucesso: true, xmlEvento: event.xmlEvento, dataCancelamento: event.dataCancelamento, requestMatched: true };
      }
      const alreadyCancelled = safePortalErrors(response.data?.erros).some((error) => error.codigo === 'E0840');
      return { sucesso: false, failureKind: alreadyCancelled ? 'UNKNOWN' : classifyPortalRejection(response.status, response.data?.erros), motivo: 'O resultado do pedido de cancelamento requer conferência.' };
    } catch { return { sucesso: false, failureKind: 'UNKNOWN', motivo: 'Não foi possível confirmar o pedido. A retomada fará somente consultas.' }; }
  }

  async conciliarCancelamento(xml: string, chave: string, empresa: any): Promise<IResultadoCancelamento> {
    try {
      const { event } = await this.cancellationEvents(chave, empresa);
      if (!event) return { sucesso: false, failureKind: 'UNKNOWN', motivo: 'Evento conclusivo ainda não recuperado. Não reenviar o pedido.' };
      let requestMatched = false;
      try { await validateCancellationEvent(event.xmlEvento, { key: chave, ambiente: empresa.ambiente, preparedRequest: xml }); requestMatched = true; }
      catch { /* A different official cancellation still establishes the note's state. */ }
      return { sucesso: true, xmlEvento: event.xmlEvento, dataCancelamento: event.dataCancelamento, requestMatched };
    } catch { return { sucesso: false, failureKind: 'UNKNOWN', motivo: 'Conciliação do cancelamento pendente.' }; }
  }
}

function safePortalErrors(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 10).map((item) => ({
    codigo: String(item?.Codigo || item?.codigo || '').slice(0, 20),
    mensagem: String(item?.Descricao || item?.descricao || item?.mensagem || '').slice(0, 500),
  }));
}
