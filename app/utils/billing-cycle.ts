import { addCalendarMonths } from './commercial-pricing';

export type ContractPeriod = {
  status: string; arquivadoEm?: Date | null; dataInicio: Date; dataFim: Date | null;
  cicloInicio: Date | null; tipoContratado: string | null;
};
export function isBaseContract(type: string | null | undefined) { return type === 'PLANO' || type === 'CUSTOM'; }

export function contractIsActive(contract: ContractPeriod, now: Date) {
  return contract.status === 'ATIVO' && !contract.arquivadoEm && contract.dataInicio <= now && (!contract.dataFim || now < contract.dataFim);
}

/** No writes: a new month is a new ledger row, never resetting an older row. */
export function currentUsageCycle(contract: ContractPeriod, now: Date) {
  if (!contractIsActive(contract, now)) return null;
  const anchor = contract.cicloInicio || contract.dataInicio;
  if (!isBaseContract(contract.tipoContratado)) return { startsAt: anchor, endsAt: contract.dataFim };
  if (now < anchor) return null;
  let months = (now.getUTCFullYear() - anchor.getUTCFullYear()) * 12 + now.getUTCMonth() - anchor.getUTCMonth();
  if (addCalendarMonths(anchor, months) > now) months--;
  const startsAt = addCalendarMonths(anchor, Math.max(0, months));
  const next = addCalendarMonths(anchor, Math.max(0, months) + 1);
  return { startsAt, endsAt: contract.dataFim && contract.dataFim < next ? contract.dataFim : next };
}
