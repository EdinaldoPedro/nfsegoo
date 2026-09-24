import { CommercialError } from './commercial-pricing';

export type AccountantBenefit = {
  action: 'GRANT' | 'SUSPEND' | 'REACTIVATE';
  kind: 'DEFAULT' | 'CUSTOM';
  cycle: 'MENSAL' | 'ANUAL';
  notes: number;
  customers: number;
};

/** Editing a role is not a renewal; every benefit is a separate, explicit operation. */
export function parseAccountantBenefit(input: Record<string, unknown>): AccountantBenefit {
  if (input.renovacaoAutomatica !== undefined) throw new CommercialError('Renovação automática não está disponível. Escolha uma concessão com prazo definido.');
  if (!['GRANT', 'SUSPEND', 'REACTIVATE'].includes(String(input.action))) throw new CommercialError('Operação de contrato inválida.');
  if (input.action !== 'GRANT') return { action: input.action as 'SUSPEND' | 'REACTIVATE', kind: 'DEFAULT', cycle: 'MENSAL', notes: 0, customers: 0 };
  if (!['DEFAULT', 'CUSTOM'].includes(String(input.kind)) || !['MENSAL', 'ANUAL'].includes(String(input.cycle))) throw new CommercialError('Modelo e prazo do benefício são obrigatórios.');
  const limit = (value: unknown, field: string) => {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 1_000_000) throw new CommercialError(`${field} deve ser um inteiro entre 0 e 1.000.000. Zero não significa ilimitado.`);
    return value;
  };
  return { action: 'GRANT', kind: input.kind as 'DEFAULT' | 'CUSTOM', cycle: input.cycle as 'MENSAL' | 'ANUAL',
    notes: input.kind === 'DEFAULT' ? 60 : limit(input.notes, 'Limite de notas'),
    customers: input.kind === 'DEFAULT' ? 25 : limit(input.customers, 'Limite de clientes') };
}
