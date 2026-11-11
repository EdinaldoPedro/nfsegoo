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

  protected portalDoubleCheckDelayMs() { return 1200; }

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
      await validateFiscalSchema(xmlAssinado, 'DPS', prestador.ambiente);
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
      const portalErrors = safePortalErrors(data?.erros ?? data?.erro);
      if (response.status >= 200 && response.status < 300 && !portalErrors.length) {
        const notaGov = await validateAuthorizedNfse(data?.nfseXmlGZipB64 || data?.xmlProcessado, xmlAssinado, prestador.ambiente, data?.chaveAcesso);
        return { sucesso: true, notaGov };
      }
      return { sucesso: false, failureKind: classifyPortalRejection(response.status, portalErrors),
        motivo: 'Resposta do Portal Nacional requer verificação.', erros: portalErrors };
    } catch {
      // Never serialize Axios errors: config contains certificate/private key.
      return { sucesso: false, failureKind: 'UNKNOWN', motivo: 'Não foi possível confirmar o resultado do envio.' };
    }
  }

  async conciliarDps(xmlAssinado: string, prestador: any): Promise<IResultadoEmissao> {
    try {
      const id = preparedDpsId(xmlAssinado);
      const dpsCheck = await this.portalGetWithDoubleCheck(prestador, '/dps/' + id, 'DPS_LOOKUP');
      if (!dpsCheck.response) return { sucesso: false, failureKind: 'UNKNOWN',
        motivo: dpsCheck.diagnostic?.category === 'PORTAL_INSTABILITY'
          ? 'Instabilidade do Portal Nacional confirmada por uma segunda verificação segura.'
          : 'Não foi possível consultar a DPS original.',
        erros: [{ portalDiagnostic: dpsCheck.diagnostic }] };
      const dpsResponse = dpsCheck.response;
      const chave = dpsResponse.data?.chaveAcesso;
      if (dpsResponse.status !== 200 || !isNfseAccessKey(chave)) {
        const category = dpsResponse.status === 404 ? 'DPS_NOT_FOUND'
          : [401, 403].includes(dpsResponse.status) ? 'PORTAL_AUTHENTICATION'
          : dpsResponse.status === 200 ? 'INVALID_PORTAL_RESPONSE' : 'PORTAL_REQUEST_REJECTED';
        return { sucesso: false, failureKind: 'UNKNOWN', motivo: 'DPS ainda não conciliada no Portal Nacional.',
          erros: [{ portalDiagnostic: { stage: 'DPS_LOOKUP', category, httpStatus: dpsResponse.status, doubleChecked: false } }] };
      }
      const nfseCheck = await this.portalGetWithDoubleCheck(prestador, '/nfse/' + chave, 'NFSE_DOWNLOAD');
      if (!nfseCheck.response) return { sucesso: false, failureKind: 'UNKNOWN',
        motivo: nfseCheck.diagnostic?.category === 'PORTAL_INSTABILITY'
          ? 'Instabilidade do Portal Nacional confirmada por uma segunda verificação segura.'
          : 'Não foi possível recuperar o XML oficial.',
        erros: [{ portalDiagnostic: nfseCheck.diagnostic }] };
      const response = nfseCheck.response;
      if (response.status !== 200) return { sucesso: false, failureKind: 'UNKNOWN', motivo: 'XML oficial ainda não recuperado.',
        erros: [{ portalDiagnostic: { stage: 'NFSE_DOWNLOAD', category: [401, 403].includes(response.status) ? 'PORTAL_AUTHENTICATION' : 'PORTAL_REQUEST_REJECTED', httpStatus: response.status, doubleChecked: false } }] };
      const notaGov = await validateAuthorizedNfse(response.data?.nfseXmlGZipB64 || response.data?.xmlProcessado || response.data, xmlAssinado, prestador.ambiente, chave);
      return { sucesso: true, notaGov };
    } catch {
      return { sucesso: false, failureKind: 'UNKNOWN', motivo: 'Não foi possível confirmar a DPS original. Não reenvie a venda.' };
    }
  }

  private async portalGetWithDoubleCheck(empresa: any, path: string, stage: 'DPS_LOOKUP' | 'NFSE_DOWNLOAD') {
    let firstDiagnostic: Record<string, unknown> | null = null;
    for (let check = 1; check <= 2; check += 1) {
      try {
        const response = await this.portalRequest(empresa, 'GET', path);
        const transient = response.status === 408 || response.status === 429 || response.status >= 500;
        if (!transient) return { response, diagnostic: null };
        firstDiagnostic = { stage, category: 'PORTAL_INSTABILITY', httpStatus: response.status, doubleChecked: false };
      } catch (error: any) {
        const code = String(error?.code || '').toUpperCase().slice(0, 40);
        const authentication = [400, 401, 403].includes(Number(error?.status)) || /CERT|TLS|SSL/.test(code);
        if (authentication) return { response: null, diagnostic: { stage, category: 'PORTAL_AUTHENTICATION', transportCode: code, doubleChecked: false } };
        firstDiagnostic = { stage, category: 'PORTAL_INSTABILITY', transportCode: code || 'NETWORK_ERROR', doubleChecked: false };
      }
      if (check === 1) await new Promise((resolve) => setTimeout(resolve, this.portalDoubleCheckDelayMs()));
    }
    return { response: null, diagnostic: { ...firstDiagnostic, doubleChecked: true, checks: 2 } };
  }

  private async cancellationEvents(chave: string, empresa: any) {
    if (!isNfseAccessKey(chave)) throw new Error('Chave inválida.');
    const results = await Promise.all(['101101', '105102', '105104', '305101'].map(async (type) => {
      try {
        const response = await this.portalRequest(empresa, 'GET', `/nfse/${chave}/eventos/${type}/1`);
        if (response.status === 404) return { type, status: 404, absent: true };
        if (response.status !== 200) return { type, status: Number(response.status) || null, absent: false };
        const event = await validatePortalCancellationEvent(response.data, { key: chave, ambiente: empresa.ambiente });
        if (event.type !== type) return { type, status: 200, absent: false };
        return { type, status: 200, absent: false, event };
      } catch { return { type, status: null, absent: false }; }
    }));
    return { event: results.find((result) => result.event)?.event, complete: results.every((result) => result.absent || result.event),
      checks: results.map(({ type, status }) => ({ type, status })) };
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
      await validateFiscalSchema(xml, 'pedRegEvento', empresa.ambiente);
      const request = verifiedFiscalReference(xml, 'pedRegEvento');
      if (!isNfseAccessKey(chave) || directElement(request, 'chNFSe').textContent !== chave) throw new Error('Chave divergente.');
      if (directElement(request, 'tpAmb').textContent !== fiscalEnvironment(empresa.ambiente)
        || directElement(request, 'CNPJAutor').textContent !== normalizeCnpj(empresa.documento)
        || request.getAttribute('Id') !== `PRE${chave}101101`) throw new Error('Autor, ambiente ou tipo de evento divergente.');
      directElement(request, 'e101101');
    } catch { return { sucesso: false, failureKind: 'LOCAL_REJECTION', motivo: 'Pedido de cancelamento inválido; nenhum envio realizado.' }; }
    let response;
    try {
      response = await this.portalRequest(empresa, 'POST', `/nfse/${chave}/eventos`, { pedidoRegistroEventoXmlGZipB64: zlib.gzipSync(Buffer.from(xml)).toString('base64') });
    } catch (error: any) {
      const code = String(error?.code || '').toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 40);
      const localTlsRejection = [
        'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
        'SELF_SIGNED_CERT_IN_CHAIN', 'DEPTH_ZERO_SELF_SIGNED_CERT',
        'CERT_HAS_EXPIRED', 'ERR_TLS_CERT_ALTNAME_INVALID',
      ].includes(code);
      if (localTlsRejection) {
        return { sucesso: false, failureKind: 'LOCAL_REJECTION', motivo: 'A conexão segura local recusou o certificado TLS antes do envio do pedido.',
          portalDiagnostic: { stage: 'CANCEL_POST', category: 'LOCAL_TLS_TRUST', ...(code ? { transportCode: code } : {}) } };
      }
      return { sucesso: false, failureKind: 'UNKNOWN', motivo: 'Não foi possível confirmar o pedido. A retomada fará somente consultas.',
        portalDiagnostic: { stage: 'CANCEL_POST', category: 'PORTAL_TRANSPORT', ...(code ? { transportCode: code } : {}) } };
    }
    // O endpoint de eventos usa `erro` (singular) no ResponseErro atual,
    // enquanto outras respostas do Portal ainda usam `erros`.
    const errors = safePortalErrors(response.data?.erros ?? response.data?.erro);
    if (response.status >= 200 && response.status < 300) {
      try {
        // Never accept an echoed pedRegEvento as an authorized evento.
        const event = await validatePortalCancellationEvent(response.data, { key: chave, ambiente: empresa.ambiente, preparedRequest: xml });
        return { sucesso: true, xmlEvento: event.xmlEvento, dataCancelamento: event.dataCancelamento, requestMatched: true };
      } catch {
        return { sucesso: false, failureKind: 'UNKNOWN', motivo: 'O Portal recebeu o pedido, mas não devolveu um evento conclusivo válido.',
          portalDiagnostic: { stage: 'CANCEL_POST', category: 'INVALID_PORTAL_EVENT', httpStatus: response.status } };
      }
    }
    const alreadyCancelled = errors.some((error) => error.codigo === 'E0840');
    const failureKind = alreadyCancelled ? 'UNKNOWN' : classifyPortalRejection(response.status, errors);
    return { sucesso: false, failureKind, motivo: failureKind === 'PORTAL_REJECTION' ? 'O Portal recusou o pedido de cancelamento.' : 'O resultado do pedido de cancelamento requer conferência.',
      portalDiagnostic: { stage: 'CANCEL_POST', category: 'PORTAL_REJECTION', httpStatus: response.status, ...(errors.length ? { errors } : {}) } };
  }

  async conciliarCancelamento(xml: string, chave: string, empresa: any): Promise<IResultadoCancelamento> {
    try {
      const { event, complete, checks } = await this.cancellationEvents(chave, empresa);
      if (!event) return { sucesso: false, failureKind: 'UNKNOWN', motivo: 'Evento conclusivo ainda não recuperado. Não reenviar o pedido.',
        portalDiagnostic: { stage: 'CANCEL_EVENT_LOOKUP', category: complete ? 'CANCELLATION_EVENT_ABSENT' : 'CANCELLATION_EVENT_LOOKUP_INCOMPLETE', eventChecks: checks } };
      let requestMatched = false;
      try { await validateCancellationEvent(event.xmlEvento, { key: chave, ambiente: empresa.ambiente, preparedRequest: xml }); requestMatched = true; }
      catch { /* A different official cancellation still establishes the note's state. */ }
      return { sucesso: true, xmlEvento: event.xmlEvento, dataCancelamento: event.dataCancelamento, requestMatched };
    } catch { return { sucesso: false, failureKind: 'UNKNOWN', motivo: 'Conciliação do cancelamento pendente.',
      portalDiagnostic: { stage: 'CANCEL_EVENT_LOOKUP', category: 'CANCELLATION_EVENT_LOOKUP_INCOMPLETE' } }; }
  }
}

type ExpectedCancellationEvent = Parameters<typeof validateCancellationEvent>[1];

/** The current Portal envelope returns `eventos[].arquivoXml` double-wrapped
 * (base64(base64(gzip(xml)))); older installations return eventoXmlGZipB64.
 * Only unwrap the extra textual base64 layer and leave XML/gzip parsing and
 * all authenticity checks to validateCancellationEvent. */
function portalCancellationEventPayloads(data: any): string[] {
  const values = [
    typeof data === 'string' ? data : undefined,
    data?.eventoXmlGZipB64,
    data?.arquivoXml,
    ...(Array.isArray(data?.eventos) ? data.eventos.flatMap((item: any) => [item?.eventoXmlGZipB64, item?.arquivoXml]) : []),
  ].filter((value): value is string => typeof value === 'string' && value.length > 0 && value.length <= 6 * 1024 * 1024);
  return values.map((value) => {
    const compact = value.trim().replace(/\s/g, '');
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(compact) || compact.length % 4 !== 0) return value;
    const decoded = Buffer.from(compact, 'base64');
    if (decoded.length > 6 * 1024 * 1024
      || (decoded[0] === 0x1f && decoded[1] === 0x8b)
      || decoded.toString('utf8', 0, 20).trimStart().startsWith('<')) return value;
    const inner = decoded.toString('utf8').replace(/\s/g, '');
    return /^[A-Za-z0-9+/]+={0,2}$/.test(inner) && inner.length % 4 === 0 ? inner : value;
  });
}

async function validatePortalCancellationEvent(data: unknown, expected: ExpectedCancellationEvent) {
  const payloads = portalCancellationEventPayloads(data);
  for (const payload of payloads) {
    try { return await validateCancellationEvent(payload, expected); }
    catch { /* Try another event in the authenticated Portal envelope. */ }
  }
  throw new Error('Resposta do Portal sem evento de cancelamento válido.');
}

function safePortalErrors(value: unknown) {
  const values = Array.isArray(value) ? value : value && typeof value === 'object' ? [value] : [];
  return values.slice(0, 10).map((item: any) => {
    const description = String(item?.Descricao || item?.descricao || item?.mensagem || '').trim();
    const complement = String(item?.Complemento || item?.complemento || '').trim();
    return {
    codigo: String(item?.Codigo || item?.codigo || '').slice(0, 20),
    mensagem: [description, complement].filter(Boolean).join(' ').slice(0, 500),
    };
  }).filter((item) => item.codigo || item.mensagem);
}
