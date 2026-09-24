/** Receita Federal / Serpro, Manual de cálculo do DV (ASCII - 48, módulo 11).
 * https://www.gov.br/receitafederal/pt-br/centrais-de-conteudo/publicacoes/documentos-tecnicos/cnpj/manual-dv-cnpj.pdf
 * Preserve letters: removing every non-digit can silently change a legal entity. */
export function normalizeCnpj(value: unknown): string {
  if (typeof value !== 'string' || value.length > 32) return '';
  const trimmed = value.trim().toUpperCase();
  if (!/^(?:[A-Z0-9]{12}[0-9]{2}|[A-Z0-9]{2}\.[A-Z0-9]{3}\.[A-Z0-9]{3}\/[A-Z0-9]{4}-[0-9]{2})$/.test(trimmed)) return '';
  return trimmed.replace(/[./-]/g, '');
}

export function validarCNPJ(value: unknown): boolean {
  const doc = normalizeCnpj(value);
  if (!doc || /^(\d)\1{13}$/.test(doc)) return false;
  const digit = (base: string) => {
    let weight = 2; let sum = 0;
    for (let index = base.length - 1; index >= 0; index--) {
      sum += (base.charCodeAt(index) - 48) * weight;
      weight = weight === 9 ? 2 : weight + 1;
    }
    const remainder = sum % 11;
    return String(remainder < 2 ? 0 : 11 - remainder);
  };
  const first = digit(doc.slice(0, 12));
  return doc.slice(-2) === first + digit(doc.slice(0, 12) + first);
}

export function formatCnpj(value: unknown): string {
  if (typeof value !== 'string') return '';
  const raw = value.trim().toUpperCase().replace(/[./-]/g, '');
  if (!/^[A-Z0-9]{12}[0-9]{2}$/.test(raw)) return value;
  return `${raw.slice(0, 2)}.${raw.slice(2, 5)}.${raw.slice(5, 8)}/${raw.slice(8, 12)}-${raw.slice(12)}`;
}

/** Keeps the first 12 CNPJ positions alphanumeric and the two check digits numeric. */
export function formatCnpjInput(value: unknown): string {
  if (typeof value !== 'string') return '';
  const sanitized = value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const raw = (sanitized.slice(0, 12) + sanitized.slice(12).replace(/\D/g, '').slice(0, 2)).slice(0, 14);
  if (raw.length <= 2) return raw;
  let formatted = `${raw.slice(0, 2)}.${raw.slice(2, 5)}`;
  if (raw.length > 5) formatted += `.${raw.slice(5, 8)}`;
  if (raw.length > 8) formatted += `/${raw.slice(8, 12)}`;
  if (raw.length > 12) formatted += `-${raw.slice(12, 14)}`;
  return formatted;
}
