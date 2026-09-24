export type FiscalOperationView = {
  id?: string; tipo: string; status: string; statusMessage?: string | null; resultStatus?: string | null;
  createdAt?: string | Date | null; nextAttemptAt?: string | Date | null;
};
export const FISCAL_CONSULTATION_DELAY_MS = 5 * 60_000;
function time(value?: string | Date | null) { const parsed = value ? new Date(value).getTime() : NaN; return Number.isFinite(parsed) ? parsed : null; }
export function isFiscalOperationDelayed(operation?: FiscalOperationView | null, now = Date.now()) {
  if (!operation || operation.tipo !== 'CONSULTAR') return false;
  if (operation.status === 'PENDENTE') { const created = time(operation.createdAt); return created !== null && now - created > FISCAL_CONSULTATION_DELAY_MS; }
  if (operation.status === 'ERRO_TEMPORARIO') { const due = time(operation.nextAttemptAt); return due !== null && now - due > FISCAL_CONSULTATION_DELAY_MS; }
  return false;
}
export function isFiscalOperationActive(operation?: FiscalOperationView | null) {
  return !!operation && ['PENDENTE', 'PROCESSANDO', 'ERRO_TEMPORARIO', 'RECONCILIACAO_MANUAL'].includes(operation.status);
}
export function isFiscalOperationPolling(operation?: FiscalOperationView | null) {
  return !!operation && ['PENDENTE', 'PROCESSANDO', 'ERRO_TEMPORARIO'].includes(operation.status);
}
export function fiscalOperationLabel(operation: FiscalOperationView, options: { workerOnline?: boolean | null; now?: number } = {}) {
  if (operation.status === 'RECONCILIACAO_MANUAL') return 'Resultado não confirmado — solicitar conciliação';
  if (operation.status === 'ERRO_FINAL') return 'Solicitação não concluída — nota preservada';
  if (operation.status === 'CONCLUIDA') return operation.resultStatus === 'CANCELADA' ? 'Cancelamento confirmado' : 'Consulta concluída';
  if (operation.tipo === 'CANCELAR') return operation.status === 'PROCESSANDO' ? 'Cancelamento em processamento — aguardando confirmação' : 'Cancelamento solicitado — aguardando confirmação';
  if (operation.status === 'PROCESSANDO') return 'Consultando o portal fiscal';
  if (operation.status === 'ERRO_TEMPORARIO') return isFiscalOperationDelayed(operation, options.now) ? 'Nova tentativa atrasada — suporte acompanhar' : 'Consulta não confirmada — nova tentativa agendada';
  if (isFiscalOperationDelayed(operation, options.now)) return options.workerOnline === false
    ? 'Consulta atrasada — processador indisponível' : 'Consulta atrasada — suporte acompanhar';
  return options.workerOnline === false ? 'Aguardando processador fiscal' : 'Aguardando consulta ao portal';
}
