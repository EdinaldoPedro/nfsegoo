import { C14nCanonicalization } from 'xml-crypto';
import { directElement, directElements, FISCAL_NS, fiscalEnvironment, fiscalRoot, fiscalXml, parseFiscalXml } from './FiscalXml';
import { verifiedFiscalReference } from './FiscalSignature';
import { validateFiscalSchema } from './FiscalSchema';
import { fiscalCnpj, isDpsId, isNfseId } from '@/app/utils/fiscal-identifiers';

export { fiscalXml } from './FiscalXml';

function canonical(node: Element) {
  return new C14nCanonicalization().process(node, { ancestorNamespaces: [{ prefix: '', namespaceURI: FISCAL_NS }] });
}

export function preparedDpsId(signedXml: string) {
  const root = fiscalRoot(parseFiscalXml(signedXml), 'DPS');
  const id = directElement(root, 'infDPS').getAttribute('Id') || '';
  if (!isDpsId(id)) throw new Error('Identificador de DPS inválido para o esquema vigente.');
  return id;
}

/** Requires the original frozen DPS, the official schema and a cryptographically
 * valid portal signature. Government provenance comes from the TLS portal client,
 * not from trusting an arbitrary embedded certificate or customer-uploaded XML. */
export function originalNfseEnvironment(value: unknown): 'PRODUCAO' | 'HOMOLOGACAO' {
  const root = fiscalRoot(parseFiscalXml(value), 'NFSe');
  const dps = directElement(directElement(directElement(root, 'infNFSe'), 'DPS'), 'infDPS');
  const environment = directElement(dps, 'tpAmb').textContent;
  if (environment === '1') return 'PRODUCAO';
  if (environment === '2') return 'HOMOLOGACAO';
  throw new Error('Ambiente original da nota desconhecido.');
}

async function authenticatedNfse(value: unknown, ambiente: string, expectedKey?: string, issuer?: string) {
  const xml = fiscalXml(value);
  await validateFiscalSchema(xml, 'NFSe');
  const inf = verifiedFiscalReference(xml, 'NFSe');
  const id = inf.getAttribute('Id') || '';
  if (!isNfseId(id)) throw new Error('Identificador da NFS-e não confere.');
  const chave = id.slice(3);
  if (expectedKey && expectedKey !== chave) throw new Error('Chave da NFS-e não confere.');
  const returned = directElement(directElement(inf, 'DPS'), 'infDPS');
  if (directElement(returned, 'tpAmb').textContent !== fiscalEnvironment(ambiente)) throw new Error('Ambiente do documento não confere.');
  const issuerDocument = fiscalCnpj(directElement(directElement(inf, 'emit'), 'CNPJ').textContent || '');
  if (!issuerDocument || (issuer && fiscalCnpj(issuer) !== issuerDocument)
    || fiscalCnpj(directElement(directElement(returned, 'prest'), 'CNPJ').textContent || '') !== issuerDocument) throw new Error('Identidade do prestador não confere.');
  const numero = directElement(inf, 'nNFSe').textContent || '';
  if (!/^[1-9][0-9]{0,12}$/.test(numero)) throw new Error('Número oficial da NFS-e inválido.');
  const dataEmissao = new Date(directElement(inf, 'dhProc').textContent || '');
  if (!Number.isFinite(dataEmissao.getTime())) throw new Error('Data oficial da NFS-e inválida.');
  const service = directElement(directElement(returned, 'serv'), 'cServ');
  const customer = directElements(returned, 'toma')[0];
  const customerValue = (name: string) => customer ? directElements(customer, name)[0]?.textContent || '' : '';
  return { inf, returned, data: { numero, chave, issuerDocument, ambiente,
    codigoServico: directElement(service, 'cTribNac').textContent || '', descricao: directElement(service, 'xDescServ').textContent || '',
    valor: directElement(directElement(directElement(returned, 'valores'), 'vServPrest'), 'vServ').textContent || '',
    tomadorNome: customerValue('xNome') || null, tomadorDocumento: customerValue('CNPJ') || customerValue('CPF') || customerValue('NIF'),
    protocolo: directElement(inf, 'nDFSe').textContent || '', xml: Buffer.from(xml, 'utf8').toString('base64'), dataEmissao } };
}

export async function validateNfseDocument(value: unknown, ambiente: string, expectedKey: string, issuer?: string) {
  return (await authenticatedNfse(value, ambiente, expectedKey, issuer)).data;
}

export async function validateAuthorizedNfse(value: unknown, signedXml: string, ambiente: string, expectedKey?: string) {
  const { returned, data } = await authenticatedNfse(value, ambiente, expectedKey);
  const original = verifiedFiscalReference(fiscalXml(signedXml), 'DPS');
  if (original.getAttribute('Id') !== returned.getAttribute('Id') || canonical(original) !== canonical(returned)) throw new Error('NFS-e corresponde a outra DPS. Conciliação manual necessária.');
  return data;
}
