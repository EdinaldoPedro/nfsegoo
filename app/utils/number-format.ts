export function parseDecimalInput(value: any, fallback = 0) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;

  let text = String(value).trim().replace(/[^\d,.-]/g, '');
  if (!text) return fallback;

  const negative = text.startsWith('-');
  text = text.replace(/-/g, '');

  const lastComma = text.lastIndexOf(',');
  const lastDot = text.lastIndexOf('.');

  if (lastComma >= 0 && lastDot >= 0) {
    const decimalSeparator = lastComma > lastDot ? ',' : '.';
    const thousandsSeparator = decimalSeparator === ',' ? '.' : ',';
    text = text.replace(new RegExp(`\\${thousandsSeparator}`, 'g'), '');
    if (decimalSeparator === ',') text = text.replace(',', '.');
  } else if (lastComma >= 0) {
    text = normalizeSingleSeparator(text, ',');
  } else if (lastDot >= 0) {
    text = normalizeSingleSeparator(text, '.');
  }

  const parsed = Number(`${negative ? '-' : ''}${text}`);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeSingleSeparator(value: string, separator: ',' | '.') {
  const escaped = separator === '.' ? '\\.' : ',';
  const thousandsPattern = new RegExp(`^\\d{1,3}(${escaped}\\d{3})+$`);

  if (thousandsPattern.test(value)) {
    return value.replace(new RegExp(escaped, 'g'), '');
  }

  return separator === ',' ? value.replace(',', '.') : value;
}

export function isPercentualFiscalValido(value: number, options: { allowZero?: boolean } = {}) {
  if (!Number.isFinite(value)) return false;
  const min = options.allowZero ? 0 : Number.MIN_VALUE;
  return value >= min && value <= 100;
}
