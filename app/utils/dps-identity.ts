export type DpsAmbiente = 'HOMOLOGACAO' | 'PRODUCAO';

// The current persistence uses PostgreSQL INTEGER. Never truncate a larger DPS
// number, wrap it, or start again at one when the storage range is exhausted.
export const MAX_STORED_DPS_NUMBER = 2_147_483_647;
export const MAX_DPS_SERIES = 89_999;

function invalid(message: string): never {
  throw Object.assign(new Error(message), { status: 400 });
}

export function normalizeDpsEnvironment(value: unknown): DpsAmbiente {
  const environment = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (environment !== 'PRODUCAO' && environment !== 'HOMOLOGACAO') {
    return invalid('Ambiente fiscal inválido. Selecione produção ou homologação.');
  }
  return environment;
}

/** Leading zeros are presentation, not a new fiscal series or sequence. */
export function normalizeDpsSeries(value: unknown): string {
  const series = typeof value === 'string' ? value.trim() : '';
  if (!/^[0-9]{1,5}$/.test(series) || Number(series) > MAX_DPS_SERIES) {
    return invalid('A série da DPS deve ser numérica e estar entre 0 e 89999.');
  }
  return String(Number(series));
}

/** All historic spellings of the same numeric series (at most five). */
export function dpsSeriesAliases(value: unknown): string[] {
  const series = normalizeDpsSeries(value);
  return Array.from({ length: 6 - series.length }, (_, i) => series.padStart(series.length + i, '0'));
}

export function normalizeDpsNumber(value: unknown, allowZero = false): number {
  const input = typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : '';
  if (!/^[0-9]{1,15}$/.test(input)) return invalid('Número de DPS inválido. Informe um número inteiro, sem sinais ou decimais.');
  const number = Number(input);
  if (!Number.isSafeInteger(number) || number < (allowZero ? 0 : 1) || number > MAX_STORED_DPS_NUMBER) {
    return invalid(`Número de DPS fora do intervalo suportado (${allowZero ? 0 : 1} a ${MAX_STORED_DPS_NUMBER}). Solicite análise; não reinicie a sequência.`);
  }
  return number;
}

/** Advisory only: a worker still reserves under the database lock. */
export function nextDpsCandidate(confirmed: number, reserved: number): number | null {
  const last = Math.max(normalizeDpsNumber(confirmed, true), normalizeDpsNumber(reserved, true));
  return last < MAX_STORED_DPS_NUMBER ? last + 1 : null;
}
