import { DOMParser } from '@xmldom/xmldom';
import { gunzipSync } from 'node:zlib';

export const FISCAL_NS = 'http://www.sped.fazenda.gov.br/nfse';
export const SIGNATURE_NS = 'http://www.w3.org/2000/09/xmldsig#';
const MAX_XML_BYTES = 4 * 1024 * 1024;

export function fiscalXml(value: unknown): string {
  if (typeof value !== 'string' || value.length > 6 * 1024 * 1024) throw new Error('Retorno fiscal inválido ou excessivo.');
  let buffer = value.trim().startsWith('<') ? Buffer.from(value, 'utf8') : Buffer.from(value, 'base64');
  if (buffer[0] === 0x1f && buffer[1] === 0x8b) buffer = gunzipSync(buffer, { maxOutputLength: MAX_XML_BYTES });
  if (buffer.length > MAX_XML_BYTES) throw new Error('XML fiscal excede o limite permitido.');
  const xml = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  if (!xml.trim().startsWith('<') || /<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('XML fiscal inseguro ou inválido.');
  return xml;
}

export function parseFiscalXml(value: unknown): Document {
  const fail = () => { throw new Error('Estrutura XML inválida no documento fiscal.'); };
  const document = new DOMParser({ errorHandler: { warning: fail, error: fail, fatalError: fail } }).parseFromString(fiscalXml(value), 'application/xml');
  const elements = document.getElementsByTagName('*');
  if (elements.length > 30_000) throw new Error('XML fiscal excessivamente complexo.');
  const ids = new Set<string>();
  for (let i = 0; i < elements.length; i++) {
    const element = elements[i];
    let depth = 0;
    for (let parent: Node | null = element; parent; parent = parent.parentNode) if (++depth > 100) throw new Error('XML fiscal excessivamente profundo.');
    for (let a = 0; a < element.attributes.length; a++) {
      const attribute = element.attributes[a];
      if (attribute.localName.toLowerCase() === 'id') {
        if (attribute.name !== 'Id' || !attribute.value || ids.has(attribute.value)) throw new Error('Identificador XML ambíguo ou duplicado.');
        ids.add(attribute.value);
      }
    }
  }
  return document;
}

export function directElements(root: Element, name: string, namespace = FISCAL_NS): Element[] {
  return Array.from(root.childNodes).filter((node): node is Element => node.nodeType === 1 && (node as Element).namespaceURI === namespace && (node as Element).localName === name);
}

export function directElement(root: Element, name: string, namespace = FISCAL_NS): Element {
  const nodes = directElements(root, name, namespace);
  if (nodes.length !== 1) throw new Error(`Documento fiscal sem ${name} único na posição esperada.`);
  return nodes[0];
}

export function fiscalRoot(document: Document, name: string): Element {
  const root = document.documentElement;
  if (!root || root.localName !== name || root.namespaceURI !== FISCAL_NS) throw new Error(`Documento não é ${name} no namespace oficial.`);
  return root;
}

export function fiscalEnvironment(ambiente: string): '1' | '2' {
  if (ambiente === 'PRODUCAO') return '1';
  if (ambiente === 'HOMOLOGACAO') return '2';
  throw new Error('Ambiente fiscal inválido.');
}
