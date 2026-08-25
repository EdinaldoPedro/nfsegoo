import zlib from 'node:zlib';

function decodeStoredXml(value?: string | null) {
  if (!value) return '';
  try {
    let buffer = Buffer.from(value, 'base64');
    try { buffer = zlib.gunzipSync(buffer); } catch { /* XML não compactado */ }
    return buffer.toString('utf8');
  } catch {
    return '';
  }
}

function tagValue(xml: string, tag: string) {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return xml.match(new RegExp(`<(?:[\\w-]+:)?${escaped}(?:\\s[^>]*)?>([^<]*)<\\/(?:[\\w-]+:)?${escaped}>`, 'i'))?.[1]?.trim() || '';
}

export function extractFiscalServiceFromStoredXml(value?: string | null) {
  const xml = decodeStoredXml(value);
  return {
    codigoTributacaoNacional: tagValue(xml, 'cTribNac').replace(/\D/g, ''),
    codigoNbs: tagValue(xml, 'cNBS').replace(/\D/g, ''),
    descricaoInformada: tagValue(xml, 'xDescServ'),
  };
}

export function formatTributacaoNacional(code?: string | null) {
  const digits = String(code || '').replace(/\D/g, '');
  return digits.length === 6 ? digits.replace(/^(\d{2})(\d{2})(\d{2})$/, '$1.$2.$3') : digits;
}
