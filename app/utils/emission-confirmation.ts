export type EmissionConfirmation = { empresaConfirmadaId: string; ambienteConfirmado: 'PRODUCAO' | 'HOMOLOGACAO' };

/** A confirmation describes the screen reviewed by the operator, not an instruction
 * to change the company's environment. Never infer it from today's configuration. */
export function readEmissionConfirmation(input: unknown): EmissionConfirmation {
  const value = input as Partial<EmissionConfirmation> | null;
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      typeof value.empresaConfirmadaId !== 'string' || !/^[a-z0-9_-]{1,100}$/i.test(value.empresaConfirmadaId) ||
      !['PRODUCAO', 'HOMOLOGACAO'].includes(value.ambienteConfirmado as string)) {
    throw Object.assign(new Error('Confirme a empresa e o ambiente na tela de revisão atualizada.'), { status: 400, code: 'EMISSION_CONFIRMATION_REQUIRED' });
  }
  return { empresaConfirmadaId: value.empresaConfirmadaId, ambienteConfirmado: value.ambienteConfirmado! };
}

export function assertEmissionConfirmation(confirmation: EmissionConfirmation, company: { id: string; ambiente: string }) {
  if (confirmation.empresaConfirmadaId !== company.id || confirmation.ambienteConfirmado !== company.ambiente) {
    throw Object.assign(new Error('A empresa ou o ambiente mudou desde a revisão. Nenhuma nova emissão foi registrada. Atualize a tela e revise os dados novamente.'), {
      status: 409, code: 'EMISSION_CONTEXT_CHANGED',
    });
  }
}
