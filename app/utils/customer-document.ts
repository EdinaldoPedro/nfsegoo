import { normalizeCnpj, validarCNPJ } from '@/app/utils/cnpj';
import { validarCPF } from '@/app/utils/cpf';

export type CustomerDocumentType = 'PF' | 'PJ' | 'EXT';

export interface NormalizedCustomerDocument {
  tipo: CustomerDocumentType;
  documento: string | null;
}

function normalizedType(value: unknown): CustomerDocumentType | '' {
  const type = String(value || '').trim().toUpperCase();
  if (type === 'PF' || type === 'F') return 'PF';
  if (type === 'PJ' || type === 'J') return 'PJ';
  if (type === 'EXT') return 'EXT';
  return '';
}

export function inferCustomerDocumentType(type: unknown, value: unknown): CustomerDocumentType | '' {
  const explicit = normalizedType(type);
  if (explicit) return explicit;
  const raw = typeof value === 'string' ? value.trim() : '';
  const cpf = raw.replace(/\D/g, '');
  if (cpf.length === 11 && validarCPF(cpf)) return 'PF';
  const cnpj = normalizeCnpj(raw);
  if (cnpj && validarCNPJ(cnpj)) return 'PJ';
  return '';
}

export function normalizeCustomerDocument(type: unknown, value: unknown): NormalizedCustomerDocument {
  const tipo = inferCustomerDocumentType(type, value);
  if (!tipo) throw Object.assign(new Error('Tipo ou documento do cliente invalido.'), { status: 400 });

  if (tipo === 'EXT') {
    if (value == null || value === '') return { tipo, documento: null };
    if (typeof value !== 'string') throw Object.assign(new Error('Documento exterior invalido.'), { status: 400 });
    const documento = value.trim();
    // eslint-disable-next-line no-control-regex -- identificadores estrangeiros devem rejeitar bytes de controle.
    if (!documento || documento.length > 40 || /[\u0000-\u001f\u007f]/.test(documento)) {
      throw Object.assign(new Error('Documento exterior invalido.'), { status: 400 });
    }
    return { tipo, documento };
  }

  if (typeof value !== 'string') throw Object.assign(new Error(`${tipo === 'PF' ? 'CPF' : 'CNPJ'} invalido.`), { status: 400 });
  if (tipo === 'PF') {
    const documento = value.replace(/\D/g, '');
    if (!validarCPF(documento)) throw Object.assign(new Error('CPF invalido.'), { status: 400 });
    return { tipo, documento };
  }

  const documento = normalizeCnpj(value);
  if (!documento || !validarCNPJ(documento)) throw Object.assign(new Error('CNPJ invalido.'), { status: 400 });
  return { tipo, documento };
}
