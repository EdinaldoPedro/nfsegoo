export class FiscalRuleGovernanceError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

function hasForbiddenControl(value: string) {
  // eslint-disable-next-line no-control-regex -- justificativas fiscais aceitam quebras de linha, mas não bytes de controle.
  return /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
}

export function parseFiscalRuleGovernance(input: unknown, requireVersion: boolean) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new FiscalRuleGovernanceError('Operação fiscal inválida.');
  }
  const body = input as Record<string, unknown>;
  const adminPassword = typeof body.adminPassword === 'string' ? body.adminPassword : '';
  const justification = typeof body.justification === 'string' ? body.justification.trim() : '';
  if (!adminPassword || Buffer.byteLength(adminPassword, 'utf8') > 72) {
    throw new FiscalRuleGovernanceError('Informe sua senha administrativa atual.');
  }
  if (justification.length < 10 || justification.length > 2000 || hasForbiddenControl(justification)) {
    throw new FiscalRuleGovernanceError('Informe uma justificativa entre 10 e 2.000 caracteres.');
  }
  let expectedUpdatedAt: Date | undefined;
  if (requireVersion) {
    if (typeof body.expectedUpdatedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(body.expectedUpdatedAt)) {
      throw new FiscalRuleGovernanceError('A versão da regra é obrigatória. Recarregue a tela.', 409);
    }
    expectedUpdatedAt = new Date(body.expectedUpdatedAt);
    if (!Number.isFinite(expectedUpdatedAt.getTime())) {
      throw new FiscalRuleGovernanceError('A versão da regra é inválida. Recarregue a tela.', 409);
    }
  }
  return { adminPassword, justification, expectedUpdatedAt };
}

export function validateNormativeSource(value: unknown) {
  const source = typeof value === 'string' ? value.trim() : '';
  if (source.length < 3 || source.length > 500 || hasForbiddenControl(source)) {
    throw new FiscalRuleGovernanceError('Informe a fonte normativa da regra, entre 3 e 500 caracteres.');
  }
  return source;
}

export function fiscalRuleSnapshot(value: Record<string, unknown> | null | undefined) {
  if (!value) return null;
  return JSON.parse(JSON.stringify(value));
}

export function changedFiscalRuleFields(before: Record<string, unknown> | null, after: Record<string, unknown> | null) {
  const ignored = new Set(['createdAt', 'updatedAt']);
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  return [...keys].filter(key => !ignored.has(key)
    && JSON.stringify(before?.[key] ?? null) !== JSON.stringify(after?.[key] ?? null));
}

export function assertFiscalRuleVersion(actual: Date, expected?: Date) {
  if (!expected || actual.getTime() !== expected.getTime()) {
    throw new FiscalRuleGovernanceError('Esta regra foi alterada por outra operação. Recarregue antes de salvar.', 409);
  }
}
