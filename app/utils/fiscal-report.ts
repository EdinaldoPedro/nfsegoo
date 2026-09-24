export type FiscalReportEnvironment = 'PRODUCAO' | 'HOMOLOGACAO' | 'LEGADO';
export const FISCAL_REPORT_ENVIRONMENTS: Record<FiscalReportEnvironment, { label: string; notice: string }> = {
  PRODUCAO: { label: 'Produção', notice: 'Somente notas com ambiente de produção registrado. Canceladas não compõem o total autorizado.' },
  HOMOLOGACAO: { label: 'Homologação', notice: 'AMBIENTE DE TESTES - SEM VALOR FISCAL DE PRODUÇÃO. Valores não representam receita.' },
  LEGADO: { label: 'Legado sem ambiente confirmado', notice: 'AMBIENTE NÃO CONFIRMADO - NÃO INCLUIR EM RECEITA. Conferir os documentos oficiais antes do fechamento.' },
};
export const MAX_FISCAL_REPORT_ROWS = 1000;
export const MAX_FISCAL_EXPORT_NOTES = 50;

export function fiscalReportError(message: string, status = 400): never {
  throw Object.assign(new Error(message), { status });
}

export function reportEnvironment(value: unknown): FiscalReportEnvironment {
  if (value === undefined || value === null) return 'PRODUCAO';
  if (typeof value !== 'string' || !Object.hasOwn(FISCAL_REPORT_ENVIRONMENTS, value)) return fiscalReportError('Ambiente de relatório inválido.');
  return value as FiscalReportEnvironment;
}

const brazilDateFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' });
export function fiscalDateInBrazil(value: Date): string { return brazilDateFormatter.format(value); }

/** First instant of a civil date, including historical DST midnight gaps.
 * The database stores UTC timestamps; a fixed -03:00 is not valid for all years. */
function brazilDayStart(date: string): Date {
  const utc = new Date(date + 'T00:00:00Z').getTime();
  let low = utc - 86_400_000;
  let high = utc + 86_400_000;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (fiscalDateInBrazil(new Date(mid)) < date) low = mid + 1;
    else high = mid;
  }
  return new Date(low);
}

export function currentFiscalMonth(now = new Date()) {
  const today = fiscalDateInBrazil(now);
  return { startDate: today.slice(0, 7) + '-01', endDate: today };
}

function dateInput(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value)) return fiscalReportError('Informe datas válidas no período.');
  const parsed = new Date(value + 'T00:00:00Z');
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value || value < '2000-01-01' || value > '2100-12-31') return fiscalReportError('Data inexistente ou fora do intervalo suportado.');
  return value;
}

export function reportPeriod(start: unknown, end: unknown, now = new Date()) {
  const defaults = currentFiscalMonth(now);
  const startDate = dateInput(start ?? defaults.startDate);
  const endDate = dateInput(end ?? defaults.endDate);
  const calendarDays = (Date.parse(endDate) - Date.parse(startDate)) / 86_400_000 + 1;
  if (calendarDays < 1 || calendarDays > 366) return fiscalReportError('Selecione um período de até 366 dias, com início anterior ou igual ao fim.');
  const startsAt = brazilDayStart(startDate);
  const nextDate = new Date(Date.parse(endDate) + 86_400_000).toISOString().slice(0, 10);
  const endsAt = brazilDayStart(nextDate);
  return { startDate, endDate, startsAt, endsAt };
}

function integerParam(value: string | null, fallback: number, max: number) {
  if (value === null) return fallback;
  if (!/^[1-9][0-9]*$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > max) return fiscalReportError('Paginação inválida.');
  return Number(value);
}

export function parseFiscalReportQuery(query: URLSearchParams, now = new Date()) {
  const search = (query.get('search') ?? '').trim();
  if (search.length > 200 || Array.from(search).some(char => char.charCodeAt(0) < 32)) return fiscalReportError('Busca inválida ou muito longa.');
  const cancelled = query.get('incluirCanceladas') ?? 'false';
  if (!['true', 'false'].includes(cancelled)) return fiscalReportError('Filtro de cancelamento inválido.');
  const output = query.get('output') ?? 'page';
  if (!['page', 'report'].includes(output)) return fiscalReportError('Formato de relatório inválido.');
  const page = integerParam(query.get('page'), 1, 10_000);
  const limit = integerParam(query.get('limit'), 20, 100);
  return { ...reportPeriod(query.get('startDate'), query.get('endDate'), now), ambiente: reportEnvironment(query.get('ambiente')),
    search, incluirCanceladas: cancelled === 'true', output, page: output === 'report' ? 1 : page, limit: output === 'report' ? MAX_FISCAL_REPORT_ROWS : limit };
}

export function formatReportMoney(value: string | number | null | undefined): string {
  // Preserve exact decimal totals; no floating point conversion for display.
  const text = String(value ?? '0');
  const match = /^(-?)([0-9]+)(?:\.([0-9]{1,2}))?$/.exec(text);
  if (!match) return 'Valor indisponível';
  return `${match[1]}R$ ${match[2].replace(/\B(?=([0-9]{3})+(?![0-9]))/g, '.')},${(match[3] ?? '').padEnd(2, '0')}`;
}
