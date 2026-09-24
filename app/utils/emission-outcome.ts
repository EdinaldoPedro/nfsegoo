/** A missing/ambiguous HTTP response is never proof that a fiscal POST failed. */
export type EmissionFailureKind = 'LOCAL_REJECTION' | 'PORTAL_REJECTION' | 'UNKNOWN';

export function classifyPortalRejection(status: number, errors: unknown): EmissionFailureKind {
  if (status !== 400 && status !== 422) return 'UNKNOWN';
  if (!Array.isArray(errors) || !errors.length) return 'UNKNOWN';
  const codes = errors.map((item) => String(item?.Codigo || item?.codigo || item?.Code || ''));
  // Duplicity and internal/temporary faults require querying the original DPS.
  if (codes.some((code) => !/^E\d{4}$/.test(code) || ['E0171', 'E0041', 'E0008', 'E0999', 'E9999'].includes(code))) return 'UNKNOWN';
  if (errors.some((item) => /duplic|j[aá].*(utiliz|existe)|instab|indispon|intern|tempor[aá]ri/i.test(JSON.stringify(item)))) return 'UNKNOWN';
  return 'PORTAL_REJECTION';
}

export function emissionFailureState(params: { transmitted: boolean; definitive: boolean; attempts: number; maxAttempts: number }) {
  if (params.definitive) return { status: 'ERRO_FINAL', releaseCredit: true, retry: false };
  if (params.attempts < params.maxAttempts) return { status: 'ERRO_TEMPORARIO', releaseCredit: false, retry: true };
  // Exhaustion is NOT a confirmed rejection, including operational failures
  // before transmission: an operator must diagnose instead of blind resubmission.
  return { status: 'RECONCILIACAO_MANUAL', releaseCredit: false, retry: false };
}

export function retryDelayMs(attempt: number) {
  return Math.min(15 * 60_000, 15_000 * 2 ** Math.min(Math.max(0, attempt - 1), 8));
}
