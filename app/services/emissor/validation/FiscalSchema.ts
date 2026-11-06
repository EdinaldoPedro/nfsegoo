import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { XMLSerializer } from '@xmldom/xmldom';
import { directElement, directElements, fiscalRoot, fiscalXml, parseFiscalXml } from './FiscalXml';

const SCHEMAS = { DPS: 'DPS_v1.01.xsd', NFSe: 'NFSe_v1.01.xsd', pedRegEvento: 'pedRegEvento_v1.01.xsd', evento: 'evento_v1.01.xsd' } as const;
type SchemaRoot = keyof typeof SCHEMAS;
type Runtime = Awaited<ReturnType<typeof initialize>>;
let initialization: Promise<Runtime> | undefined;

/** The pinned 2026-07-27 package fixed the former series regex. Keep this
 * explicit sentinel so a silent government-package change requires review. */
export function compatibleFiscalSchema(filename: string, content: string): string {
  if (filename !== 'tiposSimples_v1.01.xsd') return content;
  const official = '<xs:pattern value="[0-9]{1,4}|[0-8][0-9]{4}"/>';
  if (content.split(official).length !== 2) throw new Error('Esquema de série mudou; revisão fiscal obrigatória.');
  return content;
}

export class FiscalSchemaError extends Error {
  constructor(public readonly fields: string[]) {
    super(`Documento fora do esquema fiscal homologado${fields.length ? ': ' + fields.join(', ') : ''}. Revise os dados antes do envio.`);
    this.name = 'FiscalSchemaError';
  }
}

async function initialize() {
  const runtime = await import('libxml2-wasm');
  const folder = path.join(process.cwd(), 'resources', 'fiscal', 'xsd');
  const manifest = JSON.parse(await readFile(path.join(folder, 'manifest.json'), 'utf8')) as { files: Record<string, string> };
  const buffers: Record<string, Uint8Array> = {};
  for (const [filename, expectedHash] of Object.entries(manifest.files)) {
    if (!/^[A-Za-z0-9_.-]+\.xsd$/.test(filename)) throw new Error('Manifesto fiscal inválido.');
    // Normalization is recorded in the manifest, independent of Git's CRLF mode.
    const content = (await readFile(path.join(folder, '1.01', filename), 'utf8')).replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
    if (createHash('sha256').update(content).digest('hex') !== expectedHash) throw new Error('Integridade do esquema fiscal não confere.');
    buffers[filename] = Buffer.from(compatibleFiscalSchema(filename, content));
  }
  // Never enable filesystem/network input providers. Only pinned local schemas
  // can satisfy an include/import; instance XML does not choose its validator.
  runtime.xmlCleanupInputProvider();
  if (!runtime.xmlRegisterInputProvider(new runtime.XmlBufferInputProvider(buffers))) throw new Error('Validador fiscal indisponível.');
  const validators = new Map<SchemaRoot, InstanceType<typeof runtime.XsdValidator>>();
  try {
    for (const [root, filename] of Object.entries(SCHEMAS)) {
      const schema = runtime.XmlDocument.fromBuffer(buffers[filename], { url: filename });
      try { validators.set(root as SchemaRoot, runtime.XsdValidator.fromDoc(schema)); }
      finally { schema.dispose(); }
    }
  } catch (error) {
    for (const validator of validators.values()) validator.dispose();
    throw error;
  }
  return { runtime, validators };
}

/** Throws if schemas are missing/changed; never silently disables validation. */
export async function ensureFiscalSchemas(): Promise<void> {
  initialization ??= initialize().catch((error) => { initialization = undefined; throw error; });
  await initialization;
}

export async function validateFiscalSchema(value: unknown, root: SchemaRoot): Promise<void> {
  const xml = fiscalXml(value);
  const documentRoot = fiscalRoot(parseFiscalXml(xml), root);
  if (!['1.00', '1.01'].includes(documentRoot.getAttribute('versao') || '')) throw new FiscalSchemaError(['versao']);
  await ensureFiscalSchemas();
  const { runtime, validators } = await initialization!;
  const document = runtime.XmlDocument.fromString(xml, { option: runtime.ParseOption.XML_PARSE_NONET | runtime.ParseOption.XML_PARSE_NO_XXE | runtime.ParseOption.XML_PARSE_NO_SYS_CATALOG });
  try { validators.get(root)!.validate(document); }
  catch (error) {
    // libxml error messages can contain tax IDs/addresses/description values.
    // Expose schema field names only; never return/log the raw exception.
    const message = error instanceof Error ? error.message : '';
    const fields = [...new Set(Array.from(message.matchAll(/Element '\{http:\/\/www\.sped\.fazenda\.gov\.br\/nfse\}([A-Za-z0-9_]+)'/g), (match) => match[1]))].slice(0, 8);
    throw new FiscalSchemaError(fields);
  } finally { document.dispose(); }
}

/** The National Portal has emitted cryptographically valid NFS-e documents with
 * two narrow lexical defects in portal-generated fields: trailing whitespace in
 * xNBS and a dropped leading zero in the issuer CEP. Validate a normalized copy
 * only for XSD compatibility; callers must verify the signature and persist the
 * original XML unchanged. DPS/customer content is never normalized here. */
export async function validateOfficialNfseSchema(value: unknown): Promise<void> {
  const xml = fiscalXml(value);
  try {
    await validateFiscalSchema(xml, 'NFSe');
    return;
  } catch (error) {
    if (!(error instanceof FiscalSchemaError) || !error.fields.length
      || error.fields.some((field) => !['xNBS', 'CEP'].includes(field))) throw error;
  }

  const document = parseFiscalXml(xml);
  const inf = directElement(fiscalRoot(document, 'NFSe'), 'infNFSe');
  let normalized = 0;

  for (const node of directElements(inf, 'xNBS')) {
    const original = node.textContent || '';
    const trimmed = original.trim();
    if (trimmed && original !== trimmed) {
      node.textContent = trimmed;
      normalized += 1;
    }
  }

  const emit = directElement(inf, 'emit');
  const issuerAddress = directElements(emit, 'enderNac')[0];
  if (issuerAddress) {
    const issuerCep = directElements(issuerAddress, 'CEP')[0];
    if (issuerCep && /^\d{7}$/.test(issuerCep.textContent || '')) {
      issuerCep.textContent = '0' + issuerCep.textContent;
      normalized += 1;
    }
  }

  if (!normalized) throw new FiscalSchemaError(['NFSe']);
  await validateFiscalSchema(new XMLSerializer().serializeToString(document), 'NFSe');
}
