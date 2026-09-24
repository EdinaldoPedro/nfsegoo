import { C14nCanonicalization } from 'xml-crypto';
import { directElement, FISCAL_NS, fiscalEnvironment, fiscalXml } from './FiscalXml';
import { signFiscalXml, verifiedFiscalReference } from './FiscalSignature';
import { validateFiscalSchema } from './FiscalSchema';
import { fiscalCnpj, isNfseAccessKey } from '@/app/utils/fiscal-identifiers';

export type CancellationReason = { code: '1' | '2' | '9'; justification: string };
const CONCLUSIVE_EVENTS = ['101101', '105102', '105104', '305101'];

export function cancellationReason(code: unknown, justification: unknown): CancellationReason {
  if (!['1', '2', '9'].includes(String(code)) || typeof justification !== 'string') throw Object.assign(new Error('Selecione um motivo de cancelamento válido.'), { status: 400 });
  const text = justification.trim();
  if (text.length < 15 || text.length > 255 || !/^[\x20-\xFF]+$/.test(text) || /[\x7F-\x9F]/.test(text)) throw Object.assign(new Error('Justifique o cancelamento com 15 a 255 caracteres, sem controles ou emojis.'), { status: 400 });
  return { code: String(code) as CancellationReason['code'], justification: text };
}

function escapeXml(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

export async function prepareCancellationRequest(input: { key: string; ambiente: string; authorDocument: string; reason: CancellationReason; timestamp: Date }, credentials: { key: string; cert: string }): Promise<string> {
  if (!isNfseAccessKey(input.key)) throw new Error('Chave de acesso inválida.');
  const authorDocument = fiscalCnpj(input.authorDocument);
  if (!authorDocument) throw new Error('Documento do autor incompatível com o esquema fiscal vigente.');
  const reason = cancellationReason(input.reason.code, input.reason.justification);
  if (!Number.isFinite(input.timestamp.getTime())) throw new Error('Data do pedido inválida.');
  const timestamp = input.timestamp.toISOString().replace(/\.\d{3}Z$/, '+00:00');
  const xml = `<pedRegEvento xmlns="${FISCAL_NS}" versao="1.01"><infPedReg Id="PRE${input.key}101101"><tpAmb>${fiscalEnvironment(input.ambiente)}</tpAmb><verAplic>NFSeGoo-1</verAplic><dhEvento>${timestamp}</dhEvento><CNPJAutor>${authorDocument}</CNPJAutor><chNFSe>${input.key}</chNFSe><e101101><xDesc>Cancelamento de NFS-e</xDesc><cMotivo>${reason.code}</cMotivo><xMotivo>${escapeXml(reason.justification)}</xMotivo></e101101></infPedReg></pedRegEvento>`;
  const signed = signFiscalXml(xml, 'pedRegEvento', credentials);
  await validateFiscalSchema(signed, 'pedRegEvento');
  return signed;
}

/** A submitted request, E0840 or text saying "cancelada" is never evidence of
 * cancellation. Only a signed, schema-valid conclusive EVENT for this key/env. */
export async function validateCancellationEvent(value: unknown, expected: { key: string; ambiente: string; preparedRequest?: string }) {
  if (!isNfseAccessKey(expected.key)) throw new Error('Chave esperada inválida.');
  const xml = fiscalXml(value);
  await validateFiscalSchema(xml, 'evento');
  const event = verifiedFiscalReference(xml, 'evento');
  const request = directElement(directElement(event, 'pedRegEvento'), 'infPedReg');
  if (directElement(request, 'chNFSe').textContent !== expected.key || directElement(request, 'tpAmb').textContent !== fiscalEnvironment(expected.ambiente)) throw new Error('Evento pertence a outra nota ou ambiente.');
  const types = Array.from(request.childNodes).filter((node): node is Element => node.nodeType === 1 && (node as Element).namespaceURI === FISCAL_NS && /^e[0-9]{6}$/.test((node as Element).localName));
  if (types.length !== 1 || !CONCLUSIVE_EVENTS.includes(types[0].localName.slice(1))) throw new Error('Evento não comprova cancelamento.');
  const type = types[0].localName.slice(1);
  const sequence = directElement(event, 'nSeqEvento').textContent || '';
  if (!/^[0-9]{1,3}$/.test(sequence) || Number(sequence) !== 1) throw new Error('Sequência de cancelamento inválida.');
  const eventId = `EVT${expected.key}${type}001`;
  if (event.getAttribute('Id') !== eventId || request.getAttribute('Id') !== `PRE${expected.key}${type}`) throw new Error('Identificador do evento não confere com a chave/tipo/sequência.');
  if (expected.preparedRequest) {
    const original = verifiedFiscalReference(fiscalXml(expected.preparedRequest), 'pedRegEvento');
    const canonical = (node: Element) => new C14nCanonicalization().process(node, { ancestorNamespaces: [{ prefix: '', namespaceURI: FISCAL_NS }] });
    if (type !== '101101' || canonical(original) !== canonical(request)) throw new Error('Evento não corresponde ao pedido de cancelamento preparado.');
  }
  const dataCancelamento = new Date(directElement(event, 'dhProc').textContent || '');
  if (!Number.isFinite(dataCancelamento.getTime())) throw new Error('Data oficial do evento inválida.');
  return { eventId, type, sequence: 1, dataCancelamento, protocolo: directElement(event, 'nDFSe').textContent || '', xmlEvento: Buffer.from(xml).toString('base64') };
}
